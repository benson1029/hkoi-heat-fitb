import type { JsonValue, Observation, ProgramCase, ProgramTarget } from '../../core/types';
import { CppFault, type Decl, type Expr, type FunctionDef, type Initializer, type Stmt, type TranslationUnit, type TypeName } from './syntax';

type VectorType = 'vector<int>' | 'vector<vector<int>>' | `array<int,${number}>`;
type ScalarType = 'int' | 'long long' | 'bool' | 'char' | 'size_t';
interface ScalarSlot { kind: 'scalar'; type: ScalarType; value: bigint; initialized: boolean; alive: boolean; stringChar?: boolean }
interface FloatSlot { kind: 'float'; value: number; initialized: boolean; alive: boolean }
interface ArraySlot { kind: 'array'; type: ScalarType | 'string'; cells: (ScalarSlot | StringSlot)[]; alive: boolean; owner: boolean }
interface StringSlot { kind: 'string'; cells: ScalarSlot[]; initialized: boolean; alive: boolean }
interface VectorSlot { kind: 'vector'; type: VectorType; cells: (ScalarSlot | VectorSlot)[]; alive: boolean; owner: boolean }
interface PointerSlot { kind: 'pointer'; type: string; target: StructSlot | null; initialized: boolean; alive: boolean }
interface StructSlot { kind: 'struct'; type: string; fields: Map<string, ScalarSlot | PointerSlot>; alive: boolean }
type Slot = ScalarSlot | FloatSlot | ArraySlot | StringSlot | VectorSlot | PointerSlot | StructSlot;
type Value = { kind: 'integer'; value: bigint; type: ScalarType } | { kind: 'floating'; value: number } | { kind: 'string'; value: string } | { kind: 'array'; slot: ArraySlot } | { kind: 'vector'; slot: VectorSlot } | { kind: 'iterator'; slot: VectorSlot; position: number } | { kind: 'stream'; direction: 'in' | 'out' } | { kind: 'void' } | { kind: 'address'; slot: ScalarSlot } | { kind: 'pointer'; type: string; target: StructSlot | null } | { kind: 'struct'; slot: StructSlot };
type Flow = { kind: 'normal' | 'break' | 'continue' } | { kind: 'return'; value: Value };
const normal: Flow = { kind: 'normal' };
const INT_MIN = -(1n << 31n), INT_MAX = (1n << 31n) - 1n;
const LONG_MIN = -(1n << 63n), LONG_MAX = (1n << 63n) - 1n;
const UINT_MOD = 1n << 64n;
const MAX_ARRAY = 16384, MAX_STRING = 65536, MAX_OUTPUT = 65536, MAX_CALL_DEPTH = 64;

function int(value: bigint, type: ScalarType = 'int'): Value { return { kind: 'integer', value, type }; }
function asInt(value: Value): { value: bigint; type: ScalarType } {
  if (value.kind !== 'integer') throw new CppFault('unsupported', 'Expected an integer expression');
  return value;
}
function integralConversion(value: Value, type: ScalarType): bigint {
  if (value.kind !== 'floating') return narrow(asInt(value).value, type);
  if (!Number.isFinite(value.value)) throw new CppFault('runtime-error', 'Non-finite floating-to-integer conversion');
  if (type === 'size_t' && (value.value <= -1 || value.value >= Number(UINT_MOD)))
    throw new CppFault('runtime-error', 'Out-of-range floating-to-integer conversion');
  return narrow(BigInt(Math.trunc(value.value)), type);
}
function narrow(value: bigint, type: ScalarType): bigint {
  if (type === 'bool') return value === 0n ? 0n : 1n;
  if (type === 'size_t') return BigInt.asUintN(64, value);
  const [min, max] = type === 'long long' ? [LONG_MIN, LONG_MAX] : type === 'char' ? [-128n, 127n] : [INT_MIN, INT_MAX];
  if (value < min || value > max) throw new CppFault('runtime-error', `Signed ${type} overflow or out-of-range conversion`);
  return value;
}
function promoted(t: ScalarType): ScalarType { return t === 'long long' || t === 'size_t' ? t : 'int'; }
function truth(v: Value): boolean { return v.kind === 'pointer' ? v.target !== null : v.kind === 'floating' ? v.value !== 0 : asInt(v).value !== 0n; }
function asDouble(v: Value): number {
  if (v.kind === 'floating') return v.value;
  if (v.kind === 'integer') return Number(v.value);
  throw new CppFault('compile-error', 'Expected a numeric expression');
}

interface Effects { reads: Set<string>; writes: Set<string>; calls: boolean }
const effectsCache = new WeakMap<Expr, Effects>();
function effects(expr: Expr): Effects {
  const cached = effectsCache.get(expr);
  if (cached) return cached;
  const e: Effects = { reads: new Set(), writes: new Set(), calls: false };
  const merge = (x: Effects) => { for (const v of x.reads) e.reads.add(v); for (const v of x.writes) e.writes.add(v); e.calls ||= x.calls; };
  switch (expr.kind) {
    case 'name': e.reads.add(expr.name); break;
    case 'index': merge(effects(expr.base)); merge(effects(expr.index)); break;
    case 'call': e.calls = true; for (const a of expr.args) merge(effects(a)); break;
    case 'method-call': e.calls = true; merge(effects(expr.base)); for (const a of expr.args) merge(effects(a)); break;
    case 'member': merge(effects(expr.base)); break;
    case 'field': merge(effects(expr.base)); break;
    case 'cast': merge(effects(expr.arg)); break;
    case 'unary': merge(effects(expr.arg)); if ((expr.op === '++' || expr.op === '--') && expr.arg.kind === 'name') e.writes.add(expr.arg.name); break;
    case 'binary': merge(effects(expr.left)); merge(effects(expr.right)); break;
    case 'conditional': merge(effects(expr.condition)); merge(effects(expr.yes)); merge(effects(expr.no)); break;
    case 'assign': merge(effects(expr.left)); merge(effects(expr.right)); if (expr.left.kind === 'name') e.writes.add(expr.left.name); break;
  }
  effectsCache.set(expr, e);
  return e;
}
function unsequenced(a: Expr, b: Expr): boolean {
  const x = effects(a), y = effects(b);
  for (const name of x.writes) if (y.reads.has(name) || y.writes.has(name)) return true;
  for (const name of y.writes) if (x.reads.has(name) || x.writes.has(name)) return true;
  return false;
}

export class CheckedRuntime {
  private globals = new Map<string, Slot>();
  private scopes: Map<string, Slot>[] = [];
  private callDepth = 0;
  private steps = 0;
  private stdout = '';
  private input: string[];
  private inputPos = 0;
  private readonly maxSteps: number;
  constructor(private readonly unit: TranslationUnit, private readonly target: ProgramTarget, private readonly testCase: ProgramCase) {
    this.maxSteps = Math.min(Math.max(1, testCase.maxSteps), 250000);
    this.input = (testCase.stdin ?? '').trim().split(/\s+/).filter(Boolean);
  }
  get stepCount(): number { return this.steps; }
  private tick(): void { if (++this.steps > this.maxSteps) throw new CppFault('step-limit', `Step limit ${this.maxSteps} exceeded`); }
  private charge(operations: number): void {
    this.steps += operations;
    if (this.steps > this.maxSteps) throw new CppFault('step-limit', `Step limit ${this.maxSteps} exceeded`);
  }
  private scope(): Map<string, Slot> { return this.scopes[this.scopes.length - 1] ?? this.globals; }
  private push(): void { this.scopes.push(new Map()); }
  private pop(): void {
    const scope = this.scopes.pop();
    if (!scope) throw new Error('Scope underflow');
    for (const slot of scope.values()) {
      this.expire(slot);
    }
  }
  private expire(slot: Slot): void {
    slot.alive = false;
    if (slot.kind === 'struct') for (const field of slot.fields.values()) this.expire(field);
    if (slot.kind === 'string' || slot.kind === 'array' && slot.owner || slot.kind === 'vector' && slot.owner)
      for (const cell of slot.cells) this.expire(cell);
  }
  private bind(name: string, slot: Slot): void {
    const scope = this.scope();
    if (scope.has(name)) throw new CppFault('compile-error', `Duplicate declaration ${name}`);
    scope.set(name, slot);
  }
  private find(name: string): Slot {
    for (let i = this.scopes.length - 1; i >= 0; i--) { const v = this.scopes[i].get(name); if (v) return v; }
    const v = this.globals.get(name);
    if (!v) throw new CppFault('compile-error', `Unknown identifier ${name}`);
    if (!v.alive) throw new CppFault('runtime-error', `Object ${name} is out of scope`);
    return v;
  }
  private read(slot: ScalarSlot): Value {
    if (!slot.alive) throw new CppFault('runtime-error', 'Read after object lifetime');
    if (!slot.initialized) throw new CppFault('runtime-error', 'Read of uninitialized variable or array element');
    return int(slot.value, slot.type);
  }
  private readPointer(slot: PointerSlot): Value {
    if (!slot.alive) throw new CppFault('runtime-error', 'Read after pointer lifetime');
    if (!slot.initialized) throw new CppFault('runtime-error', 'Read of uninitialized pointer');
    if (slot.target && !slot.target.alive) throw new CppFault('runtime-error', 'Use of pointer to expired struct');
    return { kind: 'pointer', type: slot.type, target: slot.target };
  }
  private writePointer(slot: PointerSlot, value: Value): Value {
    if (!slot.alive) throw new CppFault('runtime-error', 'Write after pointer lifetime');
    if (value.kind === 'pointer') {
      if (value.type !== slot.type) throw new CppFault('compile-error', 'Incompatible struct pointer types');
      if (value.target && !value.target.alive) throw new CppFault('runtime-error', 'Use of pointer to expired struct');
      slot.target = value.target;
    } else if (value.kind === 'integer' && value.value === 0n) slot.target = null;
    else throw new CppFault('compile-error', 'Struct pointer requires a compatible pointer or NULL');
    slot.initialized = true;
    return this.readPointer(slot);
  }
  private readFloat(slot: FloatSlot): Value {
    if (!slot.alive) throw new CppFault('runtime-error', 'Read after object lifetime');
    if (!slot.initialized) throw new CppFault('runtime-error', 'Read of uninitialized double');
    return { kind: 'floating', value: slot.value };
  }
  private writeFloat(slot: FloatSlot, value: Value): Value {
    if (!slot.alive) throw new CppFault('runtime-error', 'Write after object lifetime');
    slot.value = asDouble(value);
    slot.initialized = true;
    return this.readFloat(slot);
  }
  private write(slot: ScalarSlot, v: Value): Value {
    if (!slot.alive) throw new CppFault('runtime-error', 'Write after object lifetime');
    const number = integralConversion(v, slot.type);
    if (slot.stringChar && (number < 0n || number > 127n)) throw new CppFault('unsupported', 'Non-ASCII string character conversion is not modeled');
    slot.value = number;
    slot.initialized = true;
    return this.read(slot);
  }
  private stringValue(slot: StringSlot): string {
    if (!slot.alive) throw new CppFault('runtime-error', 'String read after object lifetime');
    if (!slot.initialized) throw new CppFault('runtime-error', 'Read of uninitialized string');
    this.charge(slot.cells.length);
    return slot.cells.map(cell => String.fromCharCode(Number(asInt(this.read(cell)).value))).join('');
  }
  private checkedString(value: Value): string {
    if (value.kind !== 'string') throw new CppFault('compile-error', 'Expected a string value');
    if (value.value.length > MAX_STRING) throw new CppFault('unsupported', 'String length limit exceeded');
    if (value.value.includes('\0')) throw new CppFault('unsupported', 'Embedded NUL string semantics are not modeled');
    if ([...value.value].some(ch => ch.charCodeAt(0) > 127))
      throw new CppFault('unsupported', 'Only ASCII string contents are modeled');
    return value.value;
  }
  private stringCells(text: string): ScalarSlot[] {
    this.charge(text.length);
    return [...text].map(ch => ({ kind: 'scalar', type: 'char', value: BigInt(ch.charCodeAt(0)), initialized: true, alive: true, stringChar: true }));
  }
  private writeString(slot: StringSlot, value: Value): Value {
    if (!slot.alive) throw new CppFault('runtime-error', 'String write after object lifetime');
    const text = this.checkedString(value);
    if (text.length > MAX_STRING) throw new CppFault('unsupported', 'String length limit exceeded');
    const cells = this.stringCells(text);
    for (const cell of slot.cells) cell.alive = false;
    slot.cells = cells;
    slot.initialized = true;
    return { kind: 'string', value: text };
  }
  private appendString(slot: StringSlot, value: Value): Value {
    if (!slot.alive || !slot.initialized) throw new CppFault('runtime-error', 'Append to unavailable string');
    let text: string;
    if (value.kind === 'string') text = this.checkedString(value);
    else {
      const number = asInt(value).value;
      if (number < 0n || number > 127n) throw new CppFault('unsupported', 'Non-ASCII char conversion is not modeled');
      text = String.fromCharCode(Number(number));
    }
    if (slot.cells.length + text.length > MAX_STRING) throw new CppFault('unsupported', 'String length limit exceeded');
    for (const cell of this.stringCells(text)) slot.cells.push(cell);
    return { kind: 'string', value: this.stringValue(slot) };
  }
  private indexedSlot(expr: Extract<Expr, {kind: 'index'}>): ScalarSlot | StringSlot | VectorSlot {
    const direct = expr.base.kind === 'name' ? this.find(expr.base.name)
      : expr.base.kind === 'index' ? this.indexedSlot(expr.base) : undefined;
    if (direct?.kind === 'string') {
      if (!direct.initialized) throw new CppFault('runtime-error', 'Indexing uninitialized string');
      const i = asInt(this.evaluate(expr.index)).value;
      if (i < 0n || i >= BigInt(direct.cells.length)) throw new CppFault('runtime-error', `String index out of bounds: ${i}`);
      return direct.cells[Number(i)];
    }
    const base: Value = direct?.kind === 'vector' ? { kind: 'vector', slot: direct }
      : direct?.kind === 'scalar' ? this.read(direct) : this.evaluate(expr.base);
    const i = asInt(this.evaluate(expr.index)).value;
    if (base.kind === 'array') {
      if (!base.slot.alive) throw new CppFault('runtime-error', 'Array use after lifetime');
      if (i < 0n || i >= BigInt(base.slot.cells.length)) throw new CppFault('runtime-error', `Array index out of bounds: ${i}`);
      return base.slot.cells[Number(i)];
    }
    if (base.kind === 'vector') {
      if (!base.slot.alive) throw new CppFault('runtime-error', 'Vector use after lifetime');
      if (i < 0n || i >= BigInt(base.slot.cells.length)) throw new CppFault('runtime-error', `Vector index out of bounds: ${i}`);
      return base.slot.cells[Number(i)];
    }
    throw new CppFault('unsupported', 'Indexing requires a modeled array or vector');
  }
  private fieldSlot(expr: Extract<Expr, { kind: 'field' }>): ScalarSlot | PointerSlot {
    const base = this.evaluate(expr.base);
    let object: StructSlot;
    if (expr.viaPointer) {
      if (base.kind !== 'pointer') throw new CppFault('compile-error', 'Arrow requires a struct pointer');
      if (base.target === null) throw new CppFault('runtime-error', 'Null struct pointer dereference');
      object = base.target;
    } else {
      if (base.kind !== 'struct') throw new CppFault('compile-error', 'Dot requires a struct object');
      object = base.slot;
    }
    if (!object.alive) throw new CppFault('runtime-error', 'Struct access after object lifetime');
    const field = object.fields.get(expr.name);
    if (!field) throw new CppFault('compile-error', `Unknown field ${expr.name}`);
    return field;
  }
  private addressable(expr: Expr): Slot {
    if (expr.kind === 'name') {
      return this.find(expr.name);
    }
    if (expr.kind === 'index') return this.indexedSlot(expr);
    if (expr.kind === 'field') return this.fieldSlot(expr);
    throw new CppFault('compile-error', 'Expression is not assignable');
  }
  private lvalue(expr: Expr): ScalarSlot {
    const slot = this.addressable(expr);
    if (slot.kind !== 'scalar') throw new CppFault('compile-error', 'Array, vector, or string is not a scalar lvalue');
    return slot;
  }
  private scalarInit(init: Initializer): Value {
    if (Array.isArray(init)) {
      if (init.length !== 1) throw new CppFault('compile-error', 'Scalar brace initializer requires one value');
      return this.scalarInit(init[0]);
    }
    return this.evaluate(init);
  }
  private vectorFromInit(type: VectorType, init: Initializer): VectorSlot {
    if (!Array.isArray(init)) throw new CppFault('unsupported', 'Vector initializer must be a brace list');
    if (init.length > MAX_ARRAY) throw new CppFault('unsupported', 'Vector size is outside the modeled limit');
    this.charge(init.length);
    const cells: (ScalarSlot | VectorSlot)[] = type === 'vector<int>' || type.startsWith('array<int,')
      ? init.map(item => ({ kind: 'scalar', type: 'int', value: narrow(asInt(this.scalarInit(item)).value, 'int'), initialized: true, alive: true }))
      : init.map(item => this.vectorFromInit('vector<int>', item));
    return { kind: 'vector', type, cells, alive: true, owner: true };
  }
  private cloneVector(type: VectorType, value: Value): VectorSlot {
    if (value.kind !== 'vector') throw new CppFault('compile-error', 'Vector argument requires a vector');
    if (value.slot.type !== type) throw new CppFault('compile-error', 'Vector argument element type mismatch');
    const source = value.slot.cells;
    if (source.length > MAX_ARRAY) throw new CppFault('unsupported', 'Vector size is outside the modeled limit');
    this.charge(source.length);
    const cells = source.map(cell => {
      if (cell.kind === 'vector') return this.cloneVector('vector<int>', { kind: 'vector', slot: cell });
      this.read(cell);
      return { kind: 'scalar', type: 'int', value: cell.value, initialized: true, alive: true } as ScalarSlot;
    });
    return { kind: 'vector', type, cells, alive: true, owner: true };
  }
  private declare(decl: Decl, global = false): void {
    this.tick();
    if (decl.type === 'void') throw new CppFault('compile-error', 'Void variable');
    const type = decl.type;
    if (type.startsWith('pointer:')) {
      if (decl.array || decl.arrayParameter || decl.constructArgs) throw new CppFault('unsupported', 'Arrays of struct pointers are not modeled');
      const slot: PointerSlot = { kind: 'pointer', type: type.slice('pointer:'.length), target: null, initialized: global, alive: true };
      this.bind(decl.name, slot);
      if (decl.init !== undefined) this.writePointer(slot, this.scalarInit(decl.init));
      return;
    }
    if (type.startsWith('struct ')) {
      if (decl.array || decl.arrayParameter || decl.constructArgs || decl.init !== undefined) throw new CppFault('unsupported', 'Only plain local struct objects are modeled');
      const name = type.slice('struct '.length);
      const definition = this.unit.structs.get(name);
      if (!definition) throw new CppFault('compile-error', `Unknown struct ${name}`);
      const fields = new Map<string, ScalarSlot | PointerSlot>();
      for (const field of definition) {
        if (field.type.startsWith('pointer:'))
          fields.set(field.name, { kind: 'pointer', type: field.type.slice('pointer:'.length), target: null, initialized: global, alive: true });
        else if (['int', 'long long', 'bool', 'char', 'size_t'].includes(field.type))
          fields.set(field.name, { kind: 'scalar', type: field.type as ScalarType, value: 0n, initialized: global, alive: true });
        else throw new CppFault('unsupported', `Struct field type ${field.type} is not modeled`);
      }
      this.bind(decl.name, { kind: 'struct', type: name, fields, alive: true });
      return;
    }
    if (type === 'double') {
      if (decl.array || decl.arrayParameter) throw new CppFault('unsupported', 'Arrays of double are not modeled');
      const slot: FloatSlot = { kind: 'float', value: 0, initialized: global, alive: true };
      this.bind(decl.name, slot);
      if (decl.init !== undefined) this.writeFloat(slot, this.scalarInit(decl.init));
      return;
    }
    if (type === 'vector<int>' || type === 'vector<vector<int>>' || type.startsWith('array<int,')) {
      if (decl.array || decl.arrayParameter) throw new CppFault('unsupported', 'Arrays of vectors are not modeled');
      const sequenceType = type as VectorType;
      let slot: VectorSlot;
      if (type.startsWith('array<int,')) {
        if (decl.constructArgs) throw new CppFault('compile-error', 'std::array is an aggregate and has no size constructor');
        const capacity = Number(type.slice('array<int,'.length, -1));
        let values: Value[] = [];
        if (decl.init !== undefined) {
          if (!Array.isArray(decl.init)) throw new CppFault('unsupported', 'std::array requires a brace initializer');
          const entries = decl.init.length === 1 && Array.isArray(decl.init[0]) ? decl.init[0] : decl.init;
          if (entries.length > capacity) throw new CppFault('compile-error', 'Too many std::array initializers');
          values = entries.map(entry => this.scalarInit(entry));
        }
        this.charge(capacity);
        slot = { kind: 'vector', type: sequenceType, alive: true, owner: true,
          cells: Array.from({ length: capacity }, (_, i) => ({ kind: 'scalar', type: 'int',
            value: i < values.length ? integralConversion(values[i], 'int') : 0n,
            initialized: global || decl.init !== undefined, alive: true } as ScalarSlot)) };
      } else if (decl.init !== undefined) {
        slot = Array.isArray(decl.init) ? this.vectorFromInit(sequenceType, decl.init)
          : this.cloneVector(sequenceType, this.evaluate(decl.init));
      } else if (decl.constructArgs) {
        if (decl.constructArgs.length < 1 || decl.constructArgs.length > 2) throw new CppFault('compile-error', 'Vector constructor expects one or two arguments');
        const size = asInt(this.evaluate(decl.constructArgs[0])).value;
        if (size < 0n || size > BigInt(MAX_ARRAY)) throw new CppFault('unsupported', 'Vector size is outside the modeled limit');
        const fill = decl.constructArgs[1] ? asInt(this.evaluate(decl.constructArgs[1])).value : 0n;
        if (type !== 'vector<int>' && decl.constructArgs.length === 2) throw new CppFault('unsupported', 'Nested vector fill constructor is not modeled');
        this.charge(Number(size));
        slot = { kind: 'vector', type: sequenceType, alive: true, owner: true, cells: Array.from({ length: Number(size) }, () =>
          type === 'vector<int>'
            ? ({ kind: 'scalar', type: 'int', value: narrow(fill, 'int'), initialized: true, alive: true } as ScalarSlot)
            : ({ kind: 'vector', type: 'vector<int>', cells: [], alive: true, owner: true } as VectorSlot)) };
      } else slot = { kind: 'vector', type: sequenceType, cells: [], alive: true, owner: true };
      this.bind(decl.name, slot);
      return;
    }
    if (type === 'string') {
      if (decl.array) {
        const size = asInt(this.evaluate(decl.array)).value;
        if (size < 0n || size > BigInt(MAX_ARRAY)) throw new CppFault('unsupported', 'String array size is outside the modeled limit');
        this.charge(Number(size));
        const cells: StringSlot[] = Array.from({ length: Number(size) }, () => ({ kind: 'string', cells: [], initialized: true, alive: true }));
        this.bind(decl.name, { kind: 'array', type: 'string', cells, alive: true, owner: true });
        if (decl.init !== undefined) {
          if (!Array.isArray(decl.init)) throw new CppFault('unsupported', 'String array initializer must be a brace list');
          if (decl.init.length > cells.length) throw new CppFault('compile-error', 'Too many string array initializers');
          for (let i = 0; i < decl.init.length; i++) this.writeString(cells[i], this.scalarInit(decl.init[i]));
        }
        return;
      }
      if (decl.arrayParameter) throw new CppFault('unsupported', 'String array parameters are not modeled');
      const slot: StringSlot = { kind: 'string', cells: [], initialized: decl.init === undefined, alive: true };
      this.bind(decl.name, slot);
      if (decl.init !== undefined) {
        if (Array.isArray(decl.init)) {
          if (decl.init.length > 1) throw new CppFault('compile-error', 'Too many string initializers');
          this.writeString(slot, decl.init.length ? this.scalarInit(decl.init[0]) : { kind: 'string', value: '' });
        } else this.writeString(slot, this.scalarInit(decl.init));
      }
      return;
    }
    const scalarType = type as ScalarType;
    if (decl.array) {
      const size = asInt(this.evaluate(decl.array)).value;
      if (size < 0n || size > BigInt(MAX_ARRAY)) throw new CppFault('unsupported', 'Array size is outside the modeled limit');
      this.charge(Number(size));
      const cells = Array.from({ length: Number(size) }, () => ({ kind: 'scalar', type: scalarType, value: 0n, initialized: global, alive: true } as ScalarSlot));
      const slot: ArraySlot = { kind: 'array', type: scalarType, cells, alive: true, owner: true };
      this.bind(decl.name, slot);
      if (decl.init !== undefined) {
        if (!Array.isArray(decl.init)) {
          const value = this.scalarInit(decl.init);
          if (scalarType !== 'char' || value.kind !== 'string') throw new CppFault('unsupported', 'Array initializer must be a brace list');
          if (value.value.length + 1 > cells.length) throw new CppFault('compile-error', 'String initializer is too long for char array');
          for (let i = 0; i < cells.length; i++) this.write(cells[i], int(BigInt(i < value.value.length ? value.value.charCodeAt(i) : 0)));
        } else {
          if (decl.init.length > cells.length) throw new CppFault('compile-error', 'Too many array initializers');
          for (let i = 0; i < cells.length; i++) this.write(cells[i], i < decl.init.length ? this.scalarInit(decl.init[i]) : int(0n));
        }
      }
    } else {
      const slot: ScalarSlot = { kind: 'scalar', type: scalarType, value: 0n, initialized: global, alive: true };
      this.bind(decl.name, slot);
      if (decl.init !== undefined) {
        if (Array.isArray(decl.init)) {
          if (decl.init.length > 1) throw new CppFault('compile-error', 'Too many scalar initializers');
          if (decl.init.length === 0) this.write(slot, int(0n));
          else this.write(slot, this.scalarInit(decl.init[0]));
        } else this.write(slot, this.scalarInit(decl.init));
      }
    }
  }
  private arithmetic(op: string, left: Value, right: Value): Value {
    if (left.kind === 'floating' || right.kind === 'floating') {
      const a = asDouble(left), b = asDouble(right);
      if (op === '==') return int(a === b ? 1n : 0n, 'bool');
      if (op === '!=') return int(a !== b ? 1n : 0n, 'bool');
      if (op === '<') return int(a < b ? 1n : 0n, 'bool');
      if (op === '<=') return int(a <= b ? 1n : 0n, 'bool');
      if (op === '>') return int(a > b ? 1n : 0n, 'bool');
      if (op === '>=') return int(a >= b ? 1n : 0n, 'bool');
      if (op === '+') return { kind: 'floating', value: a + b };
      if (op === '-') return { kind: 'floating', value: a - b };
      if (op === '*') return { kind: 'floating', value: a * b };
      if (op === '/') return { kind: 'floating', value: a / b };
      throw new CppFault('unsupported', `Floating-point operator ${op} is not modeled`);
    }
    const a = asInt(left), b = asInt(right);
    const type: ScalarType = a.type === 'size_t' || b.type === 'size_t' ? 'size_t'
      : a.type === 'long long' || b.type === 'long long' ? 'long long' : 'int';
    const av = type === 'size_t' ? BigInt.asUintN(64, a.value) : a.value;
    const bv = type === 'size_t' ? BigInt.asUintN(64, b.value) : b.value;
    const width = type === 'long long' ? 64n : 32n;
    let v: bigint;
    switch (op) {
      case '+': v = av + bv; break;
      case '-': v = av - bv; break;
      case '*': v = av * bv; break;
      case '/':
      case '%':
        if (bv === 0n) throw new CppFault('runtime-error', 'Division by zero');
        if (type !== 'size_t' && av === (type === 'long long' ? LONG_MIN : INT_MIN) && bv === -1n) throw new CppFault('runtime-error', 'Signed division overflow');
        v = op === '/' ? av / bv : av % bv; break;
      case '<<':
      case '>>':
        if (bv < 0n || bv >= (type === 'size_t' ? 64n : width)) throw new CppFault('runtime-error', 'Invalid shift count');
        if (av < 0n) throw new CppFault('runtime-error', 'Shift of negative signed value');
        v = op === '<<' ? av << bv : av >> bv; break;
      case '&': v = av & bv; break;
      case '|': v = av | bv; break;
      case '^': v = av ^ bv; break;
      case '==': return int(av === bv ? 1n : 0n, 'bool');
      case '!=': return int(av !== bv ? 1n : 0n, 'bool');
      case '<': return int(av < bv ? 1n : 0n, 'bool');
      case '<=': return int(av <= bv ? 1n : 0n, 'bool');
      case '>': return int(av > bv ? 1n : 0n, 'bool');
      case '>=': return int(av >= bv ? 1n : 0n, 'bool');
      default: throw new CppFault('unsupported', `Operator ${op} is not modeled`);
    }
    return int(type === 'size_t' ? v % UINT_MOD + (v < 0n ? UINT_MOD : 0n) : narrow(v, type), type);
  }
  private append(s: string): void {
    if (this.stdout.length + s.length > MAX_OUTPUT) throw new CppFault('unsupported', 'Output limit exceeded');
    this.stdout += s;
  }
  private display(v: Value): string {
    if (v.kind === 'integer') return v.type === 'char'
      ? String.fromCharCode(Number(BigInt.asUintN(8, v.value))) : v.value.toString();
    if (v.kind === 'string') return v.value;
    throw new CppFault('unsupported', 'Cannot output this value');
  }
  private stream(op: string, left: Value, rightExpr: Expr): Value | undefined {
    if (left.kind !== 'stream') return undefined;
    if (left.direction === 'out' && op === '<<') {
      if (rightExpr.kind === 'name' && ['endl', 'std::endl'].includes(rightExpr.name)) this.append('\n');
      else this.append(this.display(this.evaluate(rightExpr)));
      return left;
    }
    if (left.direction === 'in' && op === '>>') {
      const slot = this.addressable(rightExpr);
      const token = this.input[this.inputPos++];
      if (token === undefined) throw new CppFault('runtime-error', 'Input exhausted');
      if (slot.kind === 'string') {
        this.writeString(slot, { kind: 'string', value: token });
        return left;
      }
      if (slot.kind === 'float') {
        if (!/^[+-]?(?:\d+)(?:\.\d+)?$/.test(token)) throw new CppFault('runtime-error', `Invalid double input ${token}`);
        this.writeFloat(slot, { kind: 'floating', value: Number(token) });
        return left;
      }
      if (slot.kind !== 'scalar') throw new CppFault('compile-error', 'cin extraction requires a scalar or string lvalue');
      if (!/^[+-]?\d+$/.test(token)) throw new CppFault('runtime-error', `Invalid integer input ${token}`);
      this.write(slot, int(BigInt(token), slot.type));
      return left;
    }
    throw new CppFault('unsupported', `Stream operator ${op} is not modeled`);
  }
  private builtin(name: string, args: Expr[]): Value | undefined {
    if (['max', 'std::max', 'min', 'std::min'].includes(name)) {
      if (args.length !== 2) throw new CppFault('compile-error', `${name} expects two arguments`);
      const a = asInt(this.evaluate(args[0])), b = asInt(this.evaluate(args[1]));
      if (a.type !== b.type) throw new CppFault('unsupported', 'Mixed-type min/max template deduction is not modeled');
      return int((name.endsWith('min') ? a.value <= b.value : a.value >= b.value) ? a.value : b.value, a.type);
    }
    if (name === 'swap' || name === 'std::swap') {
      if (args.length !== 2) throw new CppFault('compile-error', 'swap expects two arguments');
      const a = this.lvalue(args[0]), b = this.lvalue(args[1]);
      if (a.type !== b.type) throw new CppFault('compile-error', 'swap arguments must have the same type');
      const first = this.read(a), second = this.read(b);
      this.write(a, second); this.write(b, first);
      return { kind: 'void' };
    }
    if (['sort', 'std::sort', 'reverse', 'std::reverse', 'count', 'std::count', 'find', 'std::find',
      'lower_bound', 'std::lower_bound', 'upper_bound', 'std::upper_bound', 'binary_search', 'std::binary_search'].includes(name)) {
      const algorithm = name.replace(/^std::/, '');
      const needsValue = !['sort', 'reverse'].includes(algorithm);
      if (args.length !== (needsValue ? 3 : 2))
        throw new CppFault('compile-error', `${algorithm} expects ${needsValue ? 'three' : 'two'} arguments`);
      const first = this.evaluate(args[0]), last = this.evaluate(args[1]);
      if (first.kind !== 'iterator' || last.kind !== 'iterator' || first.slot.cells !== last.slot.cells)
        throw new CppFault('compile-error', `${algorithm} requires iterators into the same vector`);
      const cells = first.slot.cells;
      if (first.position < 0 || last.position < first.position || last.position > cells.length)
        throw new CppFault('runtime-error', `Invalid vector ${algorithm} range`);
      if (first.slot.type !== 'vector<int>' && !first.slot.type.startsWith('array<int,'))
        throw new CppFault('unsupported', `Only ${algorithm}(vector<int> or array<int,N>) is modeled`);
      const selected = cells.slice(first.position, last.position) as ScalarSlot[];
      for (const cell of selected) this.read(cell);
      if (algorithm === 'count' || algorithm === 'find') {
        const wanted = asInt(this.evaluate(args[2])).value;
        let found = 0;
        for (let i = 0; i < selected.length; i++) {
          this.tick();
          if (selected[i].value === wanted) {
            if (algorithm === 'find') return { kind: 'iterator', slot: first.slot, position: first.position + i };
            found++;
          }
        }
        return algorithm === 'find' ? last : int(BigInt(found));
      }
      if (['lower_bound', 'upper_bound', 'binary_search'].includes(algorithm)) {
        const wanted = asInt(this.evaluate(args[2])).value;
        for (let i = 1; i < selected.length; i++) {
          this.tick();
          if (selected[i - 1].value > selected[i].value)
            throw new CppFault('runtime-error', `${algorithm} requires a sorted range`);
        }
        let lo = 0, hi = selected.length;
        while (lo < hi) {
          this.tick();
          const mid = (lo + hi) >>> 1;
          if (selected[mid].value < wanted || algorithm === 'upper_bound' && selected[mid].value === wanted) lo = mid + 1;
          else hi = mid;
        }
        if (algorithm === 'binary_search') return int(lo < selected.length && selected[lo].value === wanted ? 1n : 0n, 'bool');
        return { kind: 'iterator', slot: first.slot, position: first.position + lo };
      }
      if (algorithm === 'reverse') {
        this.charge(selected.length);
        cells.splice(first.position, selected.length, ...selected.reverse());
      } else {
        selected.sort((a, b) => { this.tick(); return a.value < b.value ? -1 : a.value > b.value ? 1 : 0; });
        cells.splice(first.position, selected.length, ...selected);
      }
      return { kind: 'void' };
    }
    if (['bool', 'int', 'long long', 'char', 'double', 'size_t'].includes(name)) {
      if (args.length !== 1) throw new CppFault('compile-error', `${name} cast expects one argument`);
      const value = this.evaluate(args[0]);
      if (name === 'bool') return int(truth(value) ? 1n : 0n, 'bool');
      if (name === 'double') return { kind: 'floating', value: asDouble(value) };
      const number = value.kind === 'floating' ? value.value : Number(asInt(value).value);
      if (!Number.isFinite(number) || value.kind === 'floating' && (number < Number(LONG_MIN) || number >= Number(UINT_MOD)))
        throw new CppFault('runtime-error', 'Out-of-range floating-to-integer conversion');
      const integer = value.kind === 'floating' ? BigInt(Math.trunc(number)) : asInt(value).value;
      return int(narrow(integer, name as 'int' | 'long long' | 'char' | 'size_t'), name as 'int' | 'long long' | 'char' | 'size_t');
    }
    if (name === 'abs' || name === 'std::abs') {
      if (args.length !== 1) throw new CppFault('compile-error', 'abs expects one argument');
      const value = asInt(this.evaluate(args[0]));
      if (value.type === 'size_t') throw new CppFault('compile-error', 'abs of unsigned size_t is ambiguous');
      const resultType = promoted(value.type);
      return int(narrow(value.value < 0n ? -value.value : value.value, resultType), resultType);
    }
    if (name === 'sqrt' || name === 'std::sqrt') {
      if (args.length !== 1) throw new CppFault('compile-error', 'sqrt expects one argument');
      const number = asDouble(this.evaluate(args[0]));
      if (number < 0) throw new CppFault('runtime-error', 'sqrt of a negative value');
      return { kind: 'floating', value: Math.sqrt(number) };
    }
    if (['pow', 'std::pow', 'floor', 'std::floor', 'ceil', 'std::ceil', 'round', 'std::round'].includes(name)) {
      const operation = name.replace(/^std::/, '');
      if (args.length !== (operation === 'pow' ? 2 : 1))
        throw new CppFault('compile-error', `${operation} expects ${operation === 'pow' ? 'two' : 'one'} arguments`);
      const a = asDouble(this.evaluate(args[0]));
      const result = operation === 'pow' ? Math.pow(a, asDouble(this.evaluate(args[1])))
        : operation === 'floor' ? Math.floor(a) : operation === 'ceil' ? Math.ceil(a)
          : Math.sign(a) * Math.floor(Math.abs(a) + 0.5);
      if (!Number.isFinite(result)) throw new CppFault('runtime-error', `Non-finite ${operation} result`);
      return { kind: 'floating', value: result };
    }
    if (/^[A-Za-z_]\w*\.(?:length|size|begin|end|empty|front|back|push_back|pop_back|clear|fill|at|substr|find)$/.test(name)) {
      const method = name.slice(name.indexOf('.') + 1);
      const slot = this.find(name.slice(0, name.indexOf('.')));
      if (['length', 'size', 'begin', 'end', 'empty', 'front', 'back', 'pop_back', 'clear'].includes(method) && args.length !== 0)
        throw new CppFault('compile-error', `${name} takes no arguments`);
      if (slot.kind === 'string') {
        const value = this.stringValue(slot);
        if (method === 'length' || method === 'size') return int(BigInt(value.length), 'size_t');
        if (method === 'empty') return int(value.length === 0 ? 1n : 0n, 'bool');
        if (method === 'front' || method === 'back') {
          if (value.length === 0) throw new CppFault('runtime-error', 'Access to empty string');
          return this.read(slot.cells[method === 'front' ? 0 : value.length - 1]);
        }
        if (method === 'at') {
          if (args.length !== 1) throw new CppFault('compile-error', 'string.at expects one argument');
          const index = asInt(this.evaluate(args[0])).value;
          if (index < 0n || index >= BigInt(value.length)) throw new CppFault('runtime-error', 'String index out of bounds');
          return this.read(slot.cells[Number(index)]);
        }
        if (method === 'substr') {
          if (args.length < 1 || args.length > 2) throw new CppFault('compile-error', 'string.substr expects one or two arguments');
          const start = asInt(this.evaluate(args[0])).value;
          if (start < 0n || start > BigInt(value.length)) throw new CppFault('runtime-error', 'String substr position out of bounds');
          const count = args[1] === undefined ? BigInt(value.length) : asInt(this.evaluate(args[1])).value;
          if (count < 0n) throw new CppFault('runtime-error', 'Negative string substr length');
          return { kind: 'string', value: value.slice(Number(start), Number(start + count > BigInt(value.length) ? BigInt(value.length) : start + count)) };
        }
        if (method === 'find') {
          if (args.length !== 1) throw new CppFault('compile-error', 'string.find expects one argument');
          const needle = this.evaluate(args[0]);
          const searched = needle.kind === 'string' ? needle.value : String.fromCharCode(Number(asInt(needle).value));
          const index = value.indexOf(searched);
          return int(index < 0 ? BigInt.asUintN(64, -1n) : BigInt(index), 'size_t');
        }
        if (method === 'clear') { this.writeString(slot, { kind: 'string', value: '' }); return { kind: 'void' }; }
      }
      if (slot.kind === 'vector') {
        const fixed = slot.type.startsWith('array<int,');
        if (method === 'size') return int(BigInt(slot.cells.length), 'size_t');
        if (method === 'empty') return int(slot.cells.length === 0 ? 1n : 0n, 'bool');
        if (method === 'begin') return { kind: 'iterator', slot, position: 0 };
        if (method === 'end') return { kind: 'iterator', slot, position: slot.cells.length };
        if (method === 'front' || method === 'back' || method === 'at') {
          if (method === 'at' && args.length !== 1) throw new CppFault('compile-error', 'vector.at expects one argument');
          const index = method === 'at' ? asInt(this.evaluate(args[0])).value : BigInt(method === 'front' ? 0 : slot.cells.length - 1);
          if (index < 0n || index >= BigInt(slot.cells.length)) throw new CppFault('runtime-error', 'Vector index out of bounds');
          const cell = slot.cells[Number(index)];
          return cell.kind === 'scalar' ? this.read(cell) : { kind: 'vector', slot: cell };
        }
        if (method === 'clear' || method === 'pop_back') {
          if (fixed) throw new CppFault('compile-error', `std::array has no ${method} method`);
          if (method === 'pop_back' && slot.cells.length === 0) throw new CppFault('runtime-error', 'pop_back on empty vector');
          const removed = method === 'clear' ? slot.cells.splice(0) : slot.cells.splice(-1);
          for (const cell of removed) this.expire(cell);
          this.charge(removed.length);
          return { kind: 'void' };
        }
        if (method === 'push_back') {
          if (args.length !== 1) throw new CppFault('compile-error', 'vector.push_back expects one argument');
          if (slot.cells.length >= MAX_ARRAY) throw new CppFault('unsupported', 'Vector size is outside the modeled limit');
          if (slot.type !== 'vector<int>') throw new CppFault('unsupported', 'Nested vector push_back is not modeled');
          const value = narrow(asInt(this.evaluate(args[0])).value, 'int');
          this.tick(); slot.cells.push({ kind: 'scalar', type: 'int', value, initialized: true, alive: true });
          return { kind: 'void' };
        }
        if (method === 'fill' && fixed) {
          if (args.length !== 1) throw new CppFault('compile-error', 'array.fill expects one argument');
          const value = integralConversion(this.evaluate(args[0]), 'int');
          for (const cell of slot.cells) { this.tick(); if (cell.kind !== 'scalar') throw new Error('Invalid array cell'); this.write(cell, int(value)); }
          return { kind: 'void' };
        }
      }
      throw new CppFault('compile-error', `${name} is not a supported method on this type`);
    }
    if (['scanf', 'std::scanf'].includes(name)) {
      if (args.length < 1) throw new CppFault('compile-error', 'scanf requires a format');
      const fmt = this.evaluate(args[0]);
      if (fmt.kind !== 'string') throw new CppFault('unsupported', 'Dynamic scanf formats are not modeled');
      const specs = fmt.value.match(/%lld|%d/g) ?? [];
      if (fmt.value.replace(/%lld|%d|\s/g, '') !== '' || specs.length !== args.length - 1)
        throw new CppFault('unsupported', 'Only whitespace and %d/%lld scanf formats are modeled');
      let assigned = 0;
      for (let i = 0; i < specs.length; i++) {
        const address = this.evaluate(args[i + 1]);
        if (address.kind !== 'address') throw new CppFault('compile-error', 'scanf argument must be an address');
        if (specs[i] === '%lld' && address.slot.type !== 'long long' || specs[i] === '%d' && address.slot.type === 'long long')
          throw new CppFault('runtime-error', 'scanf argument type does not match format');
        const token = this.input[this.inputPos];
        if (token === undefined || !/^[+-]?\d+$/.test(token)) break;
        this.inputPos++;
        this.write(address.slot, int(BigInt(token), address.slot.type));
        assigned++;
      }
      return int(BigInt(assigned));
    }
    if (['printf', 'std::printf'].includes(name)) {
      if (args.length < 1) throw new CppFault('compile-error', 'printf requires a format');
      const fmt = this.evaluate(args[0]);
      if (fmt.kind !== 'string') throw new CppFault('unsupported', 'Dynamic printf formats are not modeled');
      const values = args.slice(1).map(a => this.evaluate(a));
      let i = 0, output = '';
      for (let p = 0; p < fmt.value.length; p++) {
        if (fmt.value[p] !== '%') { output += fmt.value[p]; continue; }
        if (fmt.value[++p] === '%') { output += '%'; continue; }
        let spec = fmt.value[p];
        let precision = 6;
        if (spec === '.') {
          const digits = fmt.value[++p];
          if (!/^[0-9]$/.test(digits ?? '') || fmt.value[++p] !== 'f') throw new CppFault('unsupported', 'Only single-digit printf float precision is modeled');
          precision = Number(digits);
          spec = 'f';
        }
        if (spec === 'l' && fmt.value[p + 1] === 'l') { spec = `ll${fmt.value[p + 2]}`; p += 2; }
        if (!['d', 'c', 's', 'f', 'lld'].includes(spec)) throw new CppFault('unsupported', `printf format %${spec} is not modeled`);
        if (i >= values.length) throw new CppFault('compile-error', 'Missing printf argument');
        const next = values[i++];
        if (spec === 'f') {
          if (next.kind !== 'floating') throw new CppFault('compile-error', '%f requires a floating-point argument');
          output += next.value.toFixed(precision);
          continue;
        }
        if (spec === 's') {
          if (next.kind === 'string') { output += next.value; continue; }
          if (next.kind !== 'array' || next.slot.type !== 'char') throw new CppFault('compile-error', '%s requires a char array or string literal');
          let terminated = false;
          for (const cell of next.slot.cells) {
            if (cell.kind !== 'scalar') throw new CppFault('compile-error', '%s requires a char array');
            const code = Number(asInt(this.read(cell)).value);
            if (code === 0) { terminated = true; break; }
            output += String.fromCharCode(code < 0 ? code + 256 : code);
          }
          if (!terminated) throw new CppFault('runtime-error', '%s reads beyond an unterminated char array');
          continue;
        }
        const arg = asInt(next);
        if (spec === 'lld' && arg.type !== 'long long' || spec !== 'lld' && arg.type === 'long long')
          throw new CppFault('runtime-error', 'printf argument type does not match format');
        const value = arg.value;
        output += spec === 'c' ? String.fromCharCode(Number(value)) : value.toString();
      }
      if (i !== values.length) throw new CppFault('compile-error', 'Too many printf arguments');
      this.append(output);
      return int(BigInt(output.length));
    }
    if (name === 'putchar') { if (args.length !== 1) throw new CppFault('compile-error', 'putchar requires one argument'); const v = asInt(this.evaluate(args[0])).value; this.append(String.fromCharCode(Number(v))); return int(v); }
    return undefined;
  }
  private evaluate(expr: Expr): Value {
    this.tick();
    switch (expr.kind) {
      case 'number': {
        const type: ScalarType = expr.long || expr.value > INT_MAX ? 'long long' : 'int';
        if (expr.value > LONG_MAX) throw new CppFault('unsupported', 'Integer literal exceeds signed long long');
        return int(expr.value, type);
      }
      case 'float': return { kind: 'floating', value: expr.value };
      case 'char': return int(expr.value, 'char');
      case 'string': return { kind: 'string', value: this.checkedString({ kind: 'string', value: expr.value }) };
      case 'name': {
        if (expr.name === 'NULL' && this.target.language === 'c') return int(0n);
        if (['cout', 'std::cout', 'cin', 'std::cin'].includes(expr.name) && this.target.language === 'c')
          throw new CppFault('compile-error', `C program cannot use ${expr.name}`);
        if (['cout', 'std::cout'].includes(expr.name)) return { kind: 'stream', direction: 'out' };
        if (['cin', 'std::cin'].includes(expr.name)) return { kind: 'stream', direction: 'in' };
        const slot = this.find(expr.name);
        return slot.kind === 'scalar' ? this.read(slot) : slot.kind === 'float' ? this.readFloat(slot)
          : slot.kind === 'string' ? { kind: 'string', value: this.stringValue(slot) }
          : slot.kind === 'array' ? { kind: 'array', slot } : slot.kind === 'vector' ? { kind: 'vector', slot }
          : slot.kind === 'pointer' ? this.readPointer(slot) : { kind: 'struct', slot };
      }
      case 'index': {
        const slot = this.indexedSlot(expr);
        return slot.kind === 'scalar' ? this.read(slot) : slot.kind === 'string'
          ? { kind: 'string', value: this.stringValue(slot) } : { kind: 'vector', slot };
      }
      case 'member': throw new CppFault('unsupported', `Member ${expr.name} requires a call`);
      case 'field': {
        const field = this.fieldSlot(expr);
        return field.kind === 'scalar' ? this.read(field) : this.readPointer(field);
      }
      case 'method-call': {
        if (expr.args.length !== 0) throw new CppFault('compile-error', `${expr.name} takes no arguments`);
        const base = this.evaluate(expr.base);
        if (base.kind === 'string' && ['length', 'size'].includes(expr.name)) return int(BigInt(base.value.length), 'size_t');
        if (base.kind === 'vector' && expr.name === 'size') return int(BigInt(base.slot.cells.length), 'size_t');
        throw new CppFault('unsupported', `Method ${expr.name} on this expression is not modeled`);
      }
      case 'cast': {
        const value = this.evaluate(expr.arg);
        if (expr.type === 'double') return { kind: 'floating', value: asDouble(value) };
        if (expr.type === 'string' || expr.type === 'void' || expr.type === 'vector<int>' || expr.type === 'vector<vector<int>>' || expr.type.startsWith('array<int,') ||
            expr.type.startsWith('pointer:') || expr.type.startsWith('struct '))
          throw new CppFault('unsupported', `Cast to ${expr.type} is not modeled`);
        if (expr.type === 'bool') return int(truth(value) ? 1n : 0n, 'bool');
        const number = value.kind === 'floating' ? value.value : Number(asInt(value).value);
        if (!Number.isFinite(number)) throw new CppFault('runtime-error', 'Non-finite floating-to-integer conversion');
        if (value.kind === 'floating' && (number < Number(LONG_MIN) || number >= Number(UINT_MOD)))
          throw new CppFault('runtime-error', 'Out-of-range floating-to-integer conversion');
        const integer = value.kind === 'floating' ? BigInt(Math.trunc(number)) : asInt(value).value;
        return int(narrow(integer, expr.type as ScalarType), expr.type as ScalarType);
      }
      case 'call': {
        for (let i = 0; i < expr.args.length; i++) for (let j = i + 1; j < expr.args.length; j++)
          if (unsequenced(expr.args[i], expr.args[j])) throw new CppFault('runtime-error', 'Unsequenced modification across function arguments');
        if (this.unit.functions.has(expr.name)) return this.call(expr.name, expr.args.map(a => this.evaluate(a)));
        const built = this.builtin(expr.name, expr.args);
        if (built) return built;
        return this.call(expr.name, expr.args.map(a => this.evaluate(a)));
      }
      case 'conditional': return truth(this.evaluate(expr.condition)) ? this.evaluate(expr.yes) : this.evaluate(expr.no);
      case 'unary': {
        if (expr.op === '&') {
          const slot = this.addressable(expr.arg);
          if (slot.kind === 'struct') return { kind: 'pointer', type: slot.type, target: slot };
          if (slot.kind === 'scalar') return { kind: 'address', slot };
          throw new CppFault('unsupported', 'Only scalar and struct addresses are modeled');
        }
        if (expr.op === '*') {
          const value = this.evaluate(expr.arg);
          if (value.kind !== 'pointer') throw new CppFault('compile-error', 'Dereference requires a struct pointer');
          if (value.target === null) throw new CppFault('runtime-error', 'Null struct pointer dereference');
          if (!value.target.alive) throw new CppFault('runtime-error', 'Struct access after object lifetime');
          return { kind: 'struct', slot: value.target };
        }
        if (expr.op === '++' || expr.op === '--') {
          const slot = this.lvalue(expr.arg), old = asInt(this.read(slot));
          const next = this.arithmetic(expr.op === '++' ? '+' : '-', old as Value, int(1n));
          const written = this.write(slot, next);
          return expr.postfix ? old as Value : written;
        }
        const evaluated = this.evaluate(expr.arg);
        if (evaluated.kind === 'floating') {
          if (expr.op === '+') return evaluated;
          if (expr.op === '-') return { kind: 'floating', value: -evaluated.value };
          if (expr.op === '!') return int(evaluated.value === 0 ? 1n : 0n, 'bool');
          throw new CppFault('unsupported', `Floating-point unary operator ${expr.op} is not modeled`);
        }
        const v = asInt(evaluated);
        if (expr.op === '+') return int(v.value, promoted(v.type));
        if (expr.op === '-') return int(narrow(-v.value, promoted(v.type)), promoted(v.type));
        if (expr.op === '!') return int(v.value === 0n ? 1n : 0n, 'bool');
        if (expr.op === '~') return int(narrow(~v.value, promoted(v.type)), promoted(v.type));
        throw new CppFault('unsupported', `Unary operator ${expr.op} is not modeled`);
      }
      case 'binary': {
        if (!['&&', '||'].includes(expr.op) && unsequenced(expr.left, expr.right))
          throw new CppFault('runtime-error', 'Unsequenced read and modification');
        const left = this.evaluate(expr.left);
        const streamed = this.stream(expr.op, left, expr.right);
        if (streamed) return streamed;
        if (expr.op === '&&') return int(truth(left) && truth(this.evaluate(expr.right)) ? 1n : 0n, 'bool');
        if (expr.op === '||') return int(truth(left) || truth(this.evaluate(expr.right)) ? 1n : 0n, 'bool');
        const right = this.evaluate(expr.right);
        if (left.kind === 'iterator' || right.kind === 'iterator') {
          if (left.kind !== 'iterator' || right.kind !== 'iterator' || left.slot !== right.slot)
            throw new CppFault('compile-error', 'Iterator comparison requires iterators from the same vector');
          if (expr.op === '==') return int(left.position === right.position ? 1n : 0n, 'bool');
          if (expr.op === '!=') return int(left.position !== right.position ? 1n : 0n, 'bool');
          throw new CppFault('unsupported', `Iterator operator ${expr.op} is not modeled`);
        }
        if (left.kind === 'pointer' || right.kind === 'pointer') {
          if (expr.op !== '==' && expr.op !== '!=') throw new CppFault('compile-error', `Invalid struct pointer operator ${expr.op}`);
          const nullInteger = (value: Value) => value.kind === 'integer' && value.value === 0n;
          if (left.kind !== 'pointer' && !nullInteger(left) || right.kind !== 'pointer' && !nullInteger(right))
            throw new CppFault('compile-error', 'Struct pointer comparison requires a compatible pointer or NULL');
          if (left.kind === 'pointer' && right.kind === 'pointer' && left.type !== right.type)
            throw new CppFault('compile-error', 'Incompatible struct pointer comparison');
          const same = (left.kind === 'pointer' ? left.target : null) === (right.kind === 'pointer' ? right.target : null);
          return int((expr.op === '==' ? same : !same) ? 1n : 0n, 'bool');
        }
        if (left.kind === 'string' && right.kind === 'string') {
          const cmp = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
          if (expr.op === '+') return { kind: 'string', value: this.checkedString({ kind: 'string', value: left.value + right.value }) };
          if (expr.op === '==') return int(cmp === 0 ? 1n : 0n, 'bool');
          if (expr.op === '!=') return int(cmp !== 0 ? 1n : 0n, 'bool');
          if (expr.op === '<') return int(cmp < 0 ? 1n : 0n, 'bool');
          if (expr.op === '<=') return int(cmp <= 0 ? 1n : 0n, 'bool');
          if (expr.op === '>') return int(cmp > 0 ? 1n : 0n, 'bool');
          if (expr.op === '>=') return int(cmp >= 0 ? 1n : 0n, 'bool');
          throw new CppFault('unsupported', `String operator ${expr.op} is not modeled`);
        }
        return this.arithmetic(expr.op, left, right);
      }
      case 'assign': {
        if (expr.left.kind === 'name' && effects(expr.right).writes.has(expr.left.name))
          throw new CppFault('unsupported', 'Assignment sequencing for a modified operand depends on the C++ dialect');
        const object = this.addressable(expr.left);
        if (object.kind === 'pointer') {
          if (expr.op !== '=') throw new CppFault('compile-error', 'Only plain struct-pointer assignment is modeled');
          return this.writePointer(object, this.evaluate(expr.right));
        }
        if (object.kind === 'string') {
          const rhs = this.evaluate(expr.right);
          if (expr.op === '=') return this.writeString(object, rhs);
          if (expr.op === '+=') return this.appendString(object, rhs);
          throw new CppFault('unsupported', `String operator ${expr.op} is not modeled`);
        }
        if (object.kind === 'float') {
          const rhs = this.evaluate(expr.right);
          if (expr.op === '=') return this.writeFloat(object, rhs);
          return this.writeFloat(object, this.arithmetic(expr.op.slice(0, -1), this.readFloat(object), rhs));
        }
        if (object.kind !== 'scalar') throw new CppFault('compile-error', 'Assignment requires a scalar or string lvalue');
        const slot = object;
        const rhs = this.evaluate(expr.right);
        if (expr.op === '=') return this.write(slot, rhs);
        const value = this.arithmetic(expr.op.slice(0, -1), this.read(slot), rhs);
        return this.write(slot, value);
      }
    }
  }
  private statement(stmt: Stmt): Flow {
    this.tick();
    switch (stmt.kind) {
      case 'block': {
        this.push();
        try { for (const child of stmt.statements) { const flow = this.statement(child); if (flow.kind !== 'normal') return flow; } return normal; }
        finally { this.pop(); }
      }
      case 'declaration': for (const decl of stmt.declarations) this.declare(decl); return normal;
      case 'expression': if (stmt.expression) this.evaluate(stmt.expression); return normal;
      case 'if': return truth(this.evaluate(stmt.condition)) ? this.statement(stmt.yes) : stmt.no ? this.statement(stmt.no) : normal;
      case 'while': {
        while (truth(this.evaluate(stmt.condition))) {
          const f = this.statement(stmt.body);
          if (f.kind === 'break') break;
          if (f.kind === 'return') return f;
        }
        return normal;
      }
      case 'for': {
        this.push();
        try {
          if (stmt.init) this.statement(stmt.init);
          while (!stmt.condition || truth(this.evaluate(stmt.condition))) {
            if (!stmt.condition) this.tick();
            const f = this.statement(stmt.body);
            if (f.kind === 'break') break;
            if (f.kind === 'return') return f;
            if (stmt.increment) this.evaluate(stmt.increment);
          }
          return normal;
        } finally { this.pop(); }
      }
      case 'range-for': {
        const value = this.evaluate(stmt.iterable);
        let elements: Value[];
        if (stmt.variable.type === 'char' && value.kind === 'string')
          elements = [...this.checkedString(value)].map(ch => int(BigInt(ch.charCodeAt(0)), 'char'));
        else if (stmt.variable.type === 'int' && value.kind === 'vector' &&
          (value.slot.type === 'vector<int>' || value.slot.type.startsWith('array<int,')))
          elements = value.slot.cells.map(cell => cell.kind === 'scalar' ? this.read(cell) : (() => { throw new CppFault('unsupported', 'Nested range-for elements are not modeled'); })());
        else throw new CppFault('unsupported', 'This range-for element and container combination is not modeled');
        for (const element of elements) {
          this.tick();
          this.push();
          try {
            this.bind(stmt.variable.name, { kind: 'scalar', type: stmt.variable.type as ScalarType,
              value: integralConversion(element, stmt.variable.type as ScalarType), initialized: true, alive: true });
            const f = this.statement(stmt.body);
            if (f.kind === 'break') break;
            if (f.kind === 'return') return f;
          } finally { this.pop(); }
        }
        return normal;
      }
      case 'return': return { kind: 'return', value: stmt.value ? this.evaluate(stmt.value) : { kind: 'void' } };
      case 'break': case 'continue': return { kind: stmt.kind };
    }
  }
  private call(name: string, values: Value[]): Value {
    this.tick();
    const fn: FunctionDef | undefined = this.unit.functions.get(name);
    if (!fn) throw new CppFault('unsupported', `Function ${name} is not modeled or declared`);
    if (values.length !== fn.params.length) throw new CppFault('compile-error', `Function ${name} expects ${fn.params.length} arguments`);
    if (++this.callDepth > MAX_CALL_DEPTH) { this.callDepth--; throw new CppFault('step-limit', 'Call depth exceeded'); }
    const saved = this.scopes;
    this.scopes = [];
    this.push();
    try {
      for (let i = 0; i < values.length; i++) {
        const param = fn.params[i], v = values[i];
        if (param.arrayParameter) {
          if (param.type === 'string') throw new CppFault('unsupported', 'String array parameters are not modeled');
          if (v.kind !== 'array') throw new CppFault('compile-error', `Argument ${i + 1} must be an array`);
          this.bind(param.name, { kind: 'array', type: v.slot.type, cells: v.slot.cells, alive: true, owner: false });
        } else {
          if (param.type === 'void') throw new CppFault('compile-error', 'Void parameter');
          if (param.type === 'string') {
            const slot: StringSlot = { kind: 'string', cells: [], initialized: false, alive: true };
            this.bind(param.name, slot); this.writeString(slot, v);
            continue;
          }
          if (param.type === 'double') {
            const slot: FloatSlot = { kind: 'float', value: 0, initialized: false, alive: true };
            this.bind(param.name, slot); this.writeFloat(slot, v);
            continue;
          }
          if (param.type === 'vector<int>' || param.type === 'vector<vector<int>>' || param.type.startsWith('array<int,')) {
            if (param.reference) {
              if (v.kind !== 'vector' || v.slot.type !== param.type)
                throw new CppFault('compile-error', 'Vector reference requires a matching vector lvalue');
              this.bind(param.name, { kind: 'vector', type: param.type as VectorType, cells: v.slot.cells, alive: true, owner: false });
            } else this.bind(param.name, this.cloneVector(param.type as VectorType, v));
            continue;
          }
          if (param.type.startsWith('pointer:')) {
            const slot: PointerSlot = { kind: 'pointer', type: param.type.slice('pointer:'.length), target: null, initialized: false, alive: true };
            this.bind(param.name, slot); this.writePointer(slot, v);
            continue;
          }
          if (param.type.startsWith('struct ')) throw new CppFault('unsupported', 'Struct-by-value parameters are not modeled');
          const slot: ScalarSlot = { kind: 'scalar', type: param.type as ScalarType, value: 0n, initialized: false, alive: true };
          this.bind(param.name, slot); this.write(slot, v);
        }
      }
      const flow = this.statement(fn.body);
      if (flow.kind === 'return') {
        if (fn.result === 'void') { if (flow.value.kind !== 'void') throw new CppFault('compile-error', 'Void function returning value'); return { kind: 'void' }; }
        if (flow.value.kind === 'void') throw new CppFault('runtime-error', `Non-void function ${name} returned without value`);
        if (fn.result === 'string') return { kind: 'string', value: this.checkedString(flow.value) };
        if (fn.result === 'double') return { kind: 'floating', value: asDouble(flow.value) };
        if (fn.result === 'vector<int>' || fn.result === 'vector<vector<int>>' || fn.result.startsWith('array<int,'))
          return { kind: 'vector', slot: this.cloneVector(fn.result as VectorType, flow.value) };
        if (fn.result.startsWith('pointer:')) {
          const pointerType = fn.result.slice('pointer:'.length);
          if (flow.value.kind === 'integer' && flow.value.value === 0n) return { kind: 'pointer', type: pointerType, target: null };
          if (flow.value.kind !== 'pointer' || flow.value.type !== pointerType) throw new CppFault('compile-error', 'Struct pointer return type mismatch');
          if (flow.value.target && !flow.value.target.alive) throw new CppFault('runtime-error', 'Returning pointer to expired struct');
          return flow.value;
        }
        if (fn.result.startsWith('struct ')) throw new CppFault('unsupported', 'Struct-by-value returns are not modeled');
        return int(integralConversion(flow.value, fn.result as ScalarType), fn.result as ScalarType);
      }
      if (fn.result !== 'void' && name !== 'main') throw new CppFault('runtime-error', `Non-void function ${name} fell off end`);
      return fn.result === 'void' ? { kind: 'void' } : fn.result === 'double' ? { kind: 'floating', value: 0 } : int(0n);
    } finally { this.pop(); this.scopes = saved; this.callDepth--; }
  }
  private fromJson(value: JsonValue, expectedType?: TypeName): Value {
    if (typeof value === 'string') {
      if (expectedType === 'char') {
        if (value.length !== 1 || value.charCodeAt(0) > 127) throw new CppFault('unsupported', 'Char argument requires one ASCII character');
        return int(BigInt(value.charCodeAt(0)), 'char');
      }
      return { kind: 'string', value: this.checkedString({ kind: 'string', value }) };
    }
    if (typeof value === 'boolean') return int(value ? 1n : 0n, 'bool');
    if (typeof value === 'number') {
      if (expectedType === 'double') {
        if (!Number.isFinite(value)) throw new CppFault('unsupported', 'Non-finite floating argument');
        return { kind: 'floating', value };
      }
      if (!Number.isSafeInteger(value)) throw new CppFault('unsupported', 'JSON integer argument is not exact');
      return int(BigInt(value), value > Number(INT_MAX) || value < Number(INT_MIN) ? 'long long' : 'int');
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) throw new CppFault('unsupported', 'Argument array too long');
      this.charge(value.length);
      if (expectedType === 'vector<vector<int>>') {
        const cells = value.map(item => {
          if (!Array.isArray(item)) throw new CppFault('unsupported', 'Nested vector argument requires nested arrays');
          const inner = this.fromJson(item, 'vector<int>');
          if (inner.kind !== 'vector') throw new Error('Internal nested vector conversion error');
          return inner.slot;
        });
        return { kind: 'vector', slot: { kind: 'vector', type: expectedType, cells, alive: true, owner: true } };
      }
      const cells: ScalarSlot[] = value.map(v => {
        if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new CppFault('unsupported', 'Only integer arrays are modeled');
        return { kind: 'scalar', type: 'int', value: narrow(BigInt(v), 'int'), initialized: true, alive: true };
      });
      if (expectedType?.startsWith('array<int,')) {
        const capacity = Number(expectedType.slice('array<int,'.length, -1));
        if (cells.length !== capacity) throw new CppFault('compile-error', `std::array argument requires ${capacity} elements`);
        return { kind: 'vector', slot: { kind: 'vector', type: expectedType as VectorType, cells, alive: true, owner: true } };
      }
      if (expectedType === 'vector<int>')
        return { kind: 'vector', slot: { kind: 'vector', type: expectedType, cells, alive: true, owner: true } };
      return { kind: 'array', slot: { kind: 'array', type: 'int', cells, alive: true, owner: true } };
    }
    throw new CppFault('unsupported', 'This JSON argument type is not modeled');
  }
  private toJson(value: Value): JsonValue {
    if (value.kind === 'string') return value.value;
    if (value.kind === 'floating') {
      if (!Number.isFinite(value.value)) throw new CppFault('unsupported', 'Non-finite floating argument');
      return value.value;
    }
    if (value.kind === 'integer') {
      if (value.value > BigInt(Number.MAX_SAFE_INTEGER) || value.value < BigInt(Number.MIN_SAFE_INTEGER))
        throw new CppFault('unsupported', 'Argument value exceeds exact JSON number range');
      return Number(value.value);
    }
    if (value.kind === 'vector' || value.kind === 'array') {
      if (!value.slot.alive) throw new CppFault('runtime-error', 'Argument object expired before observation');
      this.charge(value.slot.cells.length);
      return value.slot.cells.map(cell => cell.kind === 'scalar' ? this.toJson(this.read(cell))
        : cell.kind === 'string' ? this.stringValue(cell) : this.toJson({ kind: 'vector', slot: cell }));
    }
    throw new CppFault('unsupported', 'Argument value cannot be represented in JSON');
  }
  run(): Observation {
    for (const global of this.unit.globals) this.declare(global, true);
    if (this.target.harness.kind === 'call') {
      const fn = this.unit.functions.get(this.target.harness.function);
      const args = (this.testCase.args ?? []).map((a, i) => this.fromJson(a, fn?.params[i]?.type));
      const value = this.call(this.target.harness.function, args);
      const argsAfter = this.testCase.expected.argsAfter === undefined ? undefined : args.map(a => this.toJson(a));
      if (value.kind === 'void') return { stdout: this.stdout, argsAfter };
      if (value.kind === 'string') return { returnValue: value.value, stdout: this.stdout, argsAfter };
      if (value.kind === 'floating') {
        if (!Number.isFinite(value.value)) throw new CppFault('unsupported', 'Non-finite floating return');
        return { returnValue: value.value, stdout: this.stdout, argsAfter };
      }
      if (value.kind !== 'integer') throw new CppFault('unsupported', 'Function return type is not representable');
      if (value.value > BigInt(Number.MAX_SAFE_INTEGER) || value.value < BigInt(Number.MIN_SAFE_INTEGER))
        throw new CppFault('unsupported', 'Return value exceeds exact JSON number range');
      return { returnValue: Number(value.value), stdout: this.stdout, argsAfter };
    }
    this.call('main', []);
    return { stdout: this.stdout };
  }
}
