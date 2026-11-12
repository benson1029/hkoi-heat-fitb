/** Small, deliberately closed Python expression evaluator used for cheap candidate probes.
 * Unsupported syntax is handed to Pyodide by the normal engine. */
export type PythonExpressionResult =
  | { kind: 'ok'; value: unknown; steps: number }
  | { kind: 'unsupported' | 'compile-error' | 'runtime-error' | 'step-limit'; message: string; steps: number };

type Token = { text: string; value?: string | number };
type Node =
  | { kind: 'literal'; value: unknown }
  | { kind: 'name'; name: string }
  | { kind: 'unary'; op: string; child: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'compare'; first: Node; rest: { op: string; right: Node }[] }
  | { kind: 'conditional'; yes: Node; test: Node; no: Node }
  | { kind: 'list'; items: Node[] }
  | { kind: 'tuple'; items: Node[] }
  | { kind: 'dict'; entries: { key: Node; value: Node }[] }
  | { kind: 'set'; items: Node[] }
  | { kind: 'subscript'; base: Node; index: Node }
  | { kind: 'slice'; base: Node; start: Node | null; end: Node | null; step: Node | null }
  | { kind: 'attribute'; base: Node; name: string }
  | { kind: 'call'; fn: Node; args: Node[]; kwargs: { name: string; value: Node }[] }
  | { kind: 'lambda'; params: string[]; body: Node };

export interface PythonExpressionOptions {
  meter?: { steps: number };
  invoke?: (name: string, args: unknown[], receiver?: unknown, kwargs?: Record<string, unknown>) => { handled: true; value: unknown } | { handled: false };
  isCallableName?: (name: string) => boolean;
  shouldRethrow?: (error: unknown) => boolean;
}

class Unsupported extends Error {}
class StepLimit extends Error {}
export class PythonSyntaxFailure extends Error {
  constructor(message: string, name: 'SyntaxError' | 'IndentationError' | 'TabError' = 'SyntaxError') {
    super(message);
    this.name = name;
  }
}

export class PythonTuple {
  constructor(readonly values: unknown[]) {}
}

function hashKey(value: unknown): string | null {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return `number:${Number(value)}`;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return `number:${value}`;
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (value instanceof PythonTuple) {
    const parts = value.values.map(hashKey);
    return parts.every((part): part is string => part !== null) ? `tuple:${JSON.stringify(parts)}` : null;
  }
  return null;
}

export class PythonDict {
  readonly entries = new Map<string, { key: unknown; value: unknown }>();
  set(key: unknown, value: unknown): boolean {
    const hash = hashKey(key); if (hash === null) return false;
    const existing = this.entries.get(hash);
    this.entries.set(hash, { key: existing?.key ?? key, value });
    return true;
  }
  get(key: unknown): { found: boolean; value?: unknown } {
    const hash = hashKey(key); if (hash === null) throw new Unsupported('Unhashable dictionary key');
    const item = this.entries.get(hash);
    return item ? { found: true, value: item.value } : { found: false };
  }
  has(key: unknown): boolean { const hash = hashKey(key); if (hash === null) throw new Unsupported('Unhashable dictionary key'); return this.entries.has(hash); }
  keys(): unknown[] { return [...this.entries.values()].map((item) => item.key); }
  values(): unknown[] { return [...this.entries.values()].map((item) => item.value); }
}

export class PythonSet {
  readonly entries = new Map<string, unknown>();
  add(value: unknown): boolean { const hash = hashKey(value); if (hash === null) return false; this.entries.set(hash, this.entries.get(hash) ?? value); return true; }
  has(value: unknown): boolean { const hash = hashKey(value); if (hash === null) throw new Unsupported('Unhashable set item'); return this.entries.has(hash); }
  values(): unknown[] { return [...this.entries.values()]; }
}

const KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield').split(' '));
const OPERATORS = ['//', '**', '<<', '>>', '<=', '>=', '==', '!='];
const SINGLE = new Set('+-*/%&|^~<>()[]{},.:='.split(''));

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < source.length;) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      let value = '';
      i++;
      let closed = false;
      while (i < source.length) {
        const ch = source[i++];
        if (ch === quote) { closed = true; break; }
        if (ch === '\\') {
          const escaped = source[i++];
          if (escaped === undefined) throw new PythonSyntaxFailure('unterminated string literal');
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
          if (!(escaped in escapes)) throw new Unsupported('String escape is outside the fast subset');
          value += escapes[escaped];
        } else value += ch;
      }
      if (!closed) throw new PythonSyntaxFailure('unterminated string literal');
      tokens.push({ text: '<string>', value });
      continue;
    }
    const prefixed = /^0(?:[xX]_?[0-9a-fA-F](?:_?[0-9a-fA-F])*|[bB]_?[01](?:_?[01])*|[oO]_?[0-7](?:_?[0-7])*)/.exec(source.slice(i));
    if (prefixed) {
      const value = Number(prefixed[0].replace(/_/g, ''));
      if (!Number.isSafeInteger(value)) throw new Unsupported('Integer literal outside exact range');
      tokens.push({ text: '<number>', value });
      i += prefixed[0].length;
      if (/[A-Za-z_]/.test(source[i] ?? '')) throw new PythonSyntaxFailure('invalid numeric literal');
      continue;
    }
    const number = /^(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?/.exec(source.slice(i));
    if (number) {
      const raw = number[0];
      if (!/[.eE]/.test(raw) && /^0[0-9_]*[1-9]/.test(raw.replace(/_/g, ''))) throw new PythonSyntaxFailure('leading zeros in decimal integer literals are not permitted');
      const value = Number(raw.replace(/_/g, ''));
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Unsupported('Number outside safe range');
      tokens.push({ text: '<number>', value });
      i += number[0].length;
      if (/[A-Za-z_]/.test(source[i] ?? '')) {
        if (/^[jJ](?![A-Za-z_0-9])/.test(source.slice(i))) throw new Unsupported('Complex literals require full Python');
        throw new PythonSyntaxFailure('invalid numeric literal');
      }
      continue;
    }
    const name = /^[A-Za-z_]\w*/.exec(source.slice(i));
    if (name) { tokens.push({ text: name[0] }); i += name[0].length; continue; }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) { tokens.push({ text: op }); i += op.length; continue; }
    if (SINGLE.has(c)) { tokens.push({ text: c }); i++; continue; }
    if (c === '@') throw new Unsupported('Matrix multiplication requires full Python');
    throw new PythonSyntaxFailure(`invalid character ${JSON.stringify(c)}`);
  }
  tokens.push({ text: '<end>' });
  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  or: 1, and: 2, '|': 4, '^': 5, '&': 6, '<<': 7, '>>': 7,
  '+': 8, '-': 8, '*': 9, '/': 9, '//': 9, '%': 9, '**': 11,
};
const COMPARE = new Set(['<', '<=', '>', '>=', '==', '!=', 'in', 'not in', 'is', 'is not']);
const BUILTINS = new Set([
  'len', 'abs', 'min', 'max', 'sum', 'int', 'float', 'bool', 'str', 'range', 'list', 'tuple', 'dict', 'set',
  'input', 'round', 'sorted', 'map', 'filter', 'all', 'any', 'enumerate', 'zip', 'reversed', 'chr',
  'ord', 'pow', 'divmod', 'bin', 'oct', 'hex', 'isinstance',
]);

function lambdaHasFreeName(node: Node, bound: Set<string>): boolean {
  switch (node.kind) {
    case 'literal': return false;
    case 'name': return !bound.has(node.name) && !BUILTINS.has(node.name);
    case 'lambda': return true;
    case 'unary': return lambdaHasFreeName(node.child, bound);
    case 'binary': return lambdaHasFreeName(node.left, bound) || lambdaHasFreeName(node.right, bound);
    case 'compare': return lambdaHasFreeName(node.first, bound) || node.rest.some((item) => lambdaHasFreeName(item.right, bound));
    case 'conditional': return lambdaHasFreeName(node.yes, bound) || lambdaHasFreeName(node.test, bound) || lambdaHasFreeName(node.no, bound);
    case 'list': case 'tuple': case 'set': return node.items.some((item) => lambdaHasFreeName(item, bound));
    case 'dict': return node.entries.some((item) => lambdaHasFreeName(item.key, bound) || lambdaHasFreeName(item.value, bound));
    case 'subscript': return lambdaHasFreeName(node.base, bound) || lambdaHasFreeName(node.index, bound);
    case 'slice': return lambdaHasFreeName(node.base, bound) || [node.start, node.end, node.step].some((item) => item !== null && lambdaHasFreeName(item, bound));
    case 'attribute': return lambdaHasFreeName(node.base, bound);
    case 'call': return lambdaHasFreeName(node.fn, bound) || node.args.some((item) => lambdaHasFreeName(item, bound)) || node.kwargs.some((item) => lambdaHasFreeName(item.value, bound));
  }
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}
  private peek(): string { return this.tokens[this.index]?.text ?? '<end>'; }
  private take(text: string): boolean { if (this.peek() !== text) return false; this.index++; return true; }
  private expect(text: string): void { if (!this.take(text)) throw new PythonSyntaxFailure(`expected ${text}`); }
  parse(): Node {
    const node = this.expression(0);
    if (this.peek() !== '<end>') throw new PythonSyntaxFailure(`unexpected ${this.peek()}`);
    return node;
  }
  private expression(min: number): Node {
    let left = this.prefix();
    while (true) {
      if (this.peek() === '(' && 12 >= min) {
        this.index++;
        const args: Node[] = [];
        const kwargs: { name: string; value: Node }[] = [];
        if (!this.take(')')) {
          do {
            if (/^[A-Za-z_]\w*$/.test(this.peek()) && this.tokens[this.index + 1]?.text === '=') {
              const name = this.tokens[this.index++].text;
              this.index++;
              if (kwargs.some((item) => item.name === name)) throw new PythonSyntaxFailure(`keyword argument repeated: ${name}`);
              kwargs.push({ name, value: this.expression(0) });
            } else {
              if (kwargs.length) throw new PythonSyntaxFailure('positional argument follows keyword argument');
              args.push(this.expression(0));
            }
          } while (this.take(',') && this.peek() !== ')');
          this.expect(')');
        }
        left = { kind: 'call', fn: left, args, kwargs };
        continue;
      }
      if (this.peek() === '[' && 12 >= min) {
        this.index++;
        const first = this.peek() === ':' ? null : this.expression(0);
        if (this.take(':')) {
          const end = this.peek() === ':' || this.peek() === ']' ? null : this.expression(0);
          const step = this.take(':') ? (this.peek() === ']' ? null : this.expression(0)) : null;
          this.expect(']');
          left = { kind: 'slice', base: left, start: first, end, step };
        } else {
          if (!first) throw new PythonSyntaxFailure('missing subscript');
          this.expect(']');
          left = { kind: 'subscript', base: left, index: first };
        }
        continue;
      }
      if (this.peek() === '.' && 12 >= min) {
        this.index++;
        const name = this.tokens[this.index++]?.text ?? '<end>';
        if (!/^[A-Za-z_]\w*$/.test(name) || KEYWORDS.has(name)) throw new PythonSyntaxFailure('expected attribute name');
        left = { kind: 'attribute', base: left, name };
        continue;
      }
      if (this.peek() === 'if' && min <= 0) {
        this.index++;
        const test = this.expression(1);
        this.expect('else');
        const no = this.expression(0);
        left = { kind: 'conditional', yes: left, test, no };
        continue;
      }
      let op = this.peek();
      if ((op === 'not' && this.tokens[this.index + 1]?.text === 'in') ||
          (op === 'is' && this.tokens[this.index + 1]?.text === 'not')) op += ` ${this.tokens[this.index + 1].text}`;
      if (COMPARE.has(op) && min <= 3) {
        const rest: { op: string; right: Node }[] = [];
        do {
          this.index += op.includes(' ') ? 2 : 1;
          rest.push({ op, right: this.expression(4) });
          op = this.peek();
          if ((op === 'not' && this.tokens[this.index + 1]?.text === 'in') ||
              (op === 'is' && this.tokens[this.index + 1]?.text === 'not')) op += ` ${this.tokens[this.index + 1].text}`;
        } while (COMPARE.has(op));
        left = { kind: 'compare', first: left, rest };
        continue;
      }
      const precedence = PRECEDENCE[op];
      if (precedence === undefined || precedence < min) break;
      this.index++;
      left = { kind: 'binary', op, left, right: this.expression(precedence + (op === '**' ? 0 : 1)) };
    }
    return left;
  }
  private prefix(): Node {
    const token = this.tokens[this.index++] ?? { text: '<end>' };
    if (token.text === 'lambda') {
      const params: string[] = [];
      if (!this.take(':')) {
        do {
          const name = this.tokens[this.index++]?.text ?? '<end>';
          if (!/^[A-Za-z_]\w*$/.test(name) || KEYWORDS.has(name) || params.includes(name)) throw new PythonSyntaxFailure('invalid lambda parameter');
          params.push(name);
        } while (this.take(','));
        this.expect(':');
      }
      return { kind: 'lambda', params, body: this.expression(0) };
    }
    if (token.text === '<number>' || token.text === '<string>') return { kind: 'literal', value: token.value };
    if (token.text === 'True') return { kind: 'literal', value: true };
    if (token.text === 'False') return { kind: 'literal', value: false };
    if (token.text === 'None') return { kind: 'literal', value: null };
    if (token.text === '+' || token.text === '-' || token.text === '~') return { kind: 'unary', op: token.text, child: this.expression(10) };
    if (token.text === 'not') return { kind: 'unary', op: token.text, child: this.expression(3) };
    if (token.text === '(') {
      if (this.take(')')) return { kind: 'tuple', items: [] };
      const first = this.expression(0);
      if (this.take(',')) {
        const items = [first];
        while (this.peek() !== ')') { items.push(this.expression(0)); if (!this.take(',')) break; }
        this.expect(')');
        return { kind: 'tuple', items };
      }
      this.expect(')');
      return first;
    }
    if (token.text === '[') {
      const items: Node[] = [];
      if (!this.take(']')) {
        do { items.push(this.expression(0)); } while (this.take(',') && this.peek() !== ']');
        this.expect(']');
      }
      return { kind: 'list', items };
    }
    if (token.text === '{') {
      if (this.take('}')) return { kind: 'dict', entries: [] };
      const first = this.expression(0);
      if (this.take(':')) {
        const entries = [{ key: first, value: this.expression(0) }];
        while (this.take(',') && this.peek() !== '}') {
          const key = this.expression(0);
          this.expect(':');
          entries.push({ key, value: this.expression(0) });
        }
        this.expect('}');
        return { kind: 'dict', entries };
      }
      const items = [first];
      while (this.take(',') && this.peek() !== '}') items.push(this.expression(0));
      this.expect('}');
      return { kind: 'set', items };
    }
    if (/^[A-Za-z_]\w*$/.test(token.text) && !KEYWORDS.has(token.text)) return { kind: 'name', name: token.text };
    throw new PythonSyntaxFailure(`unexpected ${token.text}`);
  }
}

function truthy(value: unknown): boolean {
  if (value === null || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (value instanceof PythonTuple && value.values.length === 0) return false;
  if (value instanceof PythonDict && value.entries.size === 0) return false;
  if (value instanceof PythonSet && value.entries.size === 0) return false;
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
}

function pyEqual(a: unknown, b: unknown): boolean {
  if (a instanceof PythonDict || b instanceof PythonDict) {
    if (!(a instanceof PythonDict && b instanceof PythonDict) || a.entries.size !== b.entries.size) return false;
    return a.keys().every((key) => { const left = a.get(key); const right = b.get(key); return left.found && right.found && pyEqual(left.value, right.value); });
  }
  if (a instanceof PythonSet || b instanceof PythonSet) {
    if (!(a instanceof PythonSet && b instanceof PythonSet) || a.entries.size !== b.entries.size) return false;
    return a.values().every((value) => b.has(value));
  }
  if (a instanceof PythonTuple || b instanceof PythonTuple) return a instanceof PythonTuple && b instanceof PythonTuple && a.values.length === b.values.length && a.values.every((v, i) => pyEqual(v, b.values[i]));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => pyEqual(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && pyEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  if (typeof a === 'boolean' && typeof b === 'number') return Number(a) === b;
  if (typeof b === 'boolean' && typeof a === 'number') return a === Number(b);
  return a === b;
}

function pyOrder(a: unknown, b: unknown): number | null {
  if ((typeof a === 'number' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'boolean'))
    return Number(a) - Number(b);
  if (typeof a === 'string' && typeof b === 'string') return comparePythonStrings(a, b);
  const left = a instanceof PythonTuple ? a.values : Array.isArray(a) ? a : null;
  const right = b instanceof PythonTuple ? b.values : Array.isArray(b) ? b : null;
  if (!left || !right || (a instanceof PythonTuple) !== (b instanceof PythonTuple)) return null;
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (pyEqual(left[index], right[index])) continue;
    return pyOrder(left[index], right[index]);
  }
  return left.length - right.length;
}

function checkedNumber(value: number): number {
  if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Unsupported('Numeric result outside exact JSON range');
  return value;
}

export function comparePythonStrings(a: string, b: string): number {
  const left = [...a]; const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = (left[i].codePointAt(0) ?? 0) - (right[i].codePointAt(0) ?? 0);
    if (difference) return difference;
  }
  return left.length - right.length;
}

const parseCache = new Map<string, Node>();

function parseExpression(source: string): Node {
  try { return new Parser(lex(source)).parse(); }
  catch (error) {
    // These are valid Python constructs that this small expression grammar does
    // not yet evaluate. Do not mislabel their parser failures as SyntaxError.
    if (error instanceof PythonSyntaxFailure && (/(?:^|[^\w])(?:f|F|fr|rf|Fr|Rf)["']/.test(source)
      || source.includes(':=') || /\b(?:for|await|yield)\b/.test(source)))
      throw new Unsupported('Expression requires full Python');
    throw error;
  }
}

export function classifyPythonExpressionSyntax(source: string): 'supported' | 'unsupported' | 'invalid' {
  try { parseExpression(source); return 'supported'; }
  catch (error) { return error instanceof PythonSyntaxFailure ? 'invalid' : 'unsupported'; }
}

export function supportsPythonExpressionSyntax(source: string): boolean {
  return classifyPythonExpressionSyntax(source) === 'supported';
}

export function pythonTypeName(value: unknown): string {
  if (value === null) return 'NoneType';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'str';
  if (Array.isArray(value)) return 'list';
  if (value instanceof PythonTuple) return 'tuple';
  if (value instanceof PythonDict) return 'dict';
  if (value instanceof PythonSet) return 'set';
  if (typeof value === 'function') return 'function';
  if (value && typeof value === 'object' && 'builtin' in value) {
    if ('typeAlias' in value) return 'GenericAlias';
    return ['int', 'str', 'float', 'bool', 'list', 'tuple', 'dict', 'set'].includes(String(value.builtin))
      ? 'type' : 'builtin_function_or_method';
  }
  return 'object';
}

export function evaluatePythonExpression(source: string, variables: Record<string, unknown> = {}, maxSteps = 1_000, options?: PythonExpressionOptions): PythonExpressionResult {
  let steps = 0;
  try {
    let tree = parseCache.get(source);
    if (!tree) {
      tree = parseExpression(source);
      if (parseCache.size >= 1024) parseCache.clear();
      parseCache.set(source, tree);
    }
    let currentVars = variables;
    const evalNode = (node: Node): unknown => {
      steps++;
      if (options?.meter) options.meter.steps++;
      if ((options?.meter?.steps ?? steps) > maxSteps) throw new StepLimit('Python fast expression step limit exceeded');
      switch (node.kind) {
        case 'literal': return node.value;
        case 'lambda': {
          if (lambdaHasFreeName(node.body, new Set(node.params))) throw new Unsupported('Lambda closure requires full Python');
          const captured = { ...currentVars };
          return (...args: unknown[]) => {
            if (args.length !== node.params.length) throw new Error('TypeError: lambda argument count mismatch');
            const previous = currentVars;
            currentVars = { ...captured, ...Object.fromEntries(node.params.map((name, index) => [name, args[index]])) };
            try { return evalNode(node.body); }
            finally { currentVars = previous; }
          };
        }
        case 'name':
          if (Object.hasOwn(currentVars, node.name)) return currentVars[node.name];
          if (BUILTINS.has(node.name) || options?.isCallableName?.(node.name)) return { builtin: node.name };
          throw new Error(`NameError: name '${node.name}' is not defined`);
        case 'list': return node.items.map(evalNode);
        case 'tuple': return new PythonTuple(node.items.map(evalNode));
        case 'dict': {
          const result = new PythonDict();
          for (const entry of node.entries) if (!result.set(evalNode(entry.key), evalNode(entry.value))) throw new Unsupported('Dictionary key requires a hashable scalar or tuple');
          return result;
        }
        case 'set': {
          const result = new PythonSet();
          for (const item of node.items) if (!result.add(evalNode(item))) throw new Unsupported('Set item requires a hashable scalar or tuple');
          return result;
        }
        case 'conditional': return truthy(evalNode(node.test)) ? evalNode(node.yes) : evalNode(node.no);
        case 'attribute': return { method: node.name, receiver: evalNode(node.base) };
        case 'subscript': {
          const base = evalNode(node.base);
          const index = evalNode(node.index);
          if (base && typeof base === 'object' && 'builtin' in base
            && ['int', 'str', 'float', 'bool', 'list', 'tuple', 'dict', 'set'].includes(String(base.builtin)))
            return { builtin: base.builtin, typeAlias: index };
          if (base instanceof PythonDict) {
            const value = base.get(index);
            if (!value.found) throw new Error('KeyError: key not found');
            return value.value;
          }
          if (typeof base !== 'string' && !Array.isArray(base) && !(base instanceof PythonTuple))
            throw new Error(`TypeError: '${pythonTypeName(base)}' object is not subscriptable`);
          if (!Number.isInteger(index)) throw new Error('TypeError: sequence indices must be integers');
          const sequence = typeof base === 'string' ? [...base] : base instanceof PythonTuple ? base.values : base as unknown[];
          const at = (index as number) < 0 ? sequence.length + (index as number) : index as number;
          if (at < 0 || at >= sequence.length) throw new Error('IndexError: index out of range');
          return sequence[at];
        }
        case 'slice': {
          const base = evalNode(node.base);
          if (typeof base !== 'string' && !Array.isArray(base) && !(base instanceof PythonTuple)) throw new Unsupported('Slice requires a sequence');
          const sequence = typeof base === 'string' ? [...base] : base instanceof PythonTuple ? base.values : base;
          const start = node.start ? evalNode(node.start) : null;
          const end = node.end ? evalNode(node.end) : null;
          const step = node.step ? evalNode(node.step) : 1;
          if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end)) || !Number.isSafeInteger(step))
            throw new Error('TypeError: slice indices must be integers or None');
          if (step === 0) throw new Error('ValueError: slice step cannot be zero');
          const size = sequence.length;
          const stride = step as number;
          const normalize = (value: number | null, defaultValue: number): number => {
            if (value === null) return defaultValue;
            const shifted = value < 0 ? value + size : value;
            return stride > 0 ? Math.max(0, Math.min(size, shifted)) : Math.max(-1, Math.min(size - 1, shifted));
          };
          const from = normalize(start as number | null, stride > 0 ? 0 : size - 1);
          const to = normalize(end as number | null, stride > 0 ? size : -1);
          const result: unknown[] = [];
          for (let i = from; stride > 0 ? i < to : i > to; i += stride) result.push(sequence[i]);
          return typeof base === 'string' ? result.join('') : base instanceof PythonTuple ? new PythonTuple(result) : result;
        }
        case 'call': {
          const fn = evalNode(node.fn);
          const args = node.args.map(evalNode);
          const kwargs = Object.fromEntries(node.kwargs.map((item) => [item.name, evalNode(item.value)]));
          if (typeof fn === 'function' && !node.kwargs.length) return fn(...args);
          if (!fn || typeof fn !== 'object') throw new Error(`TypeError: '${pythonTypeName(fn)}' object is not callable`);
          if ('method' in fn) {
            const invoked = options?.invoke?.(String(fn.method), args, (fn as unknown as { receiver: unknown }).receiver, kwargs);
            if (invoked?.handled) return invoked.value;
            throw new Unsupported(`Method ${String(fn.method)} requires full Python`);
          }
          if (!('builtin' in fn)) throw new Error(`TypeError: '${pythonTypeName(fn)}' object is not callable`);
          const name = String(fn.builtin);
          const invoked = options?.invoke?.(name, args, undefined, kwargs);
          if (invoked?.handled) return invoked.value;
          if (node.kwargs.length) throw new Unsupported(`Keyword call to ${name} requires full Python`);
          if (name === 'len' && args.length === 1 && typeof args[0] === 'string') return [...args[0]].length;
          if (name === 'len' && args.length === 1 && Array.isArray(args[0])) return args[0].length;
          if (name === 'len' && args.length === 1 && args[0] instanceof PythonTuple) return args[0].values.length;
          if (name === 'len' && args.length === 1 && args[0] instanceof PythonDict) return args[0].entries.size;
          if (name === 'len' && args.length === 1 && args[0] instanceof PythonSet) return args[0].entries.size;
          if (name === 'len') throw new Error(args.length === 1
            ? `TypeError: object of type '${pythonTypeName(args[0])}' has no len()`
            : `TypeError: len() takes exactly one argument (${args.length} given)`);
          if (name === 'abs' && args.length === 1 && typeof args[0] === 'number') return checkedNumber(Math.abs(args[0]));
          if (name === 'bool' && args.length === 1) return truthy(args[0]);
          if (name === 'int' && args.length === 1 && (typeof args[0] === 'number' || typeof args[0] === 'boolean')) return checkedNumber(Math.trunc(Number(args[0])));
          if (name === 'str' && args.length === 1 && typeof args[0] === 'string') return args[0];
          if ((name === 'min' || name === 'max') && args.length > 0 && args.every((x) => typeof x === 'number')) return name === 'min' ? Math.min(...args as number[]) : Math.max(...args as number[]);
          if (name === 'sum' && args.length === 1 && Array.isArray(args[0]) && args[0].every((x) => typeof x === 'number')) {
            let total = 0;
            for (const item of args[0]) total = checkedNumber(total + item);
            return total;
          }
          throw new Unsupported(`Call to ${String(name)} requires full Python`);
        }
        case 'unary': {
          const value = evalNode(node.child);
          if (node.op === 'not') return !truthy(value);
          const number = typeof value === 'boolean' ? Number(value) : value;
          if (typeof number !== 'number') throw new Error(`TypeError: bad operand type for unary ${node.op}: '${pythonTypeName(value)}'`);
          if (node.op === '~' && Number.isSafeInteger(number)) return checkedNumber(-number - 1);
          if (node.op === '+') return number;
          if (node.op === '-') return checkedNumber(-number);
          throw new Unsupported('Unary operator requires full Python');
        }
        case 'compare': {
          let left = evalNode(node.first);
          for (const item of node.rest) {
            const right = evalNode(item.right);
            let result: boolean;
            if (item.op === '==') result = pyEqual(left, right);
            else if (item.op === '!=') result = !pyEqual(left, right);
            else if (item.op === 'is' || item.op === 'is not') {
              if (left !== null && right !== null && typeof left !== 'boolean' && typeof right !== 'boolean' && typeof left !== 'object' && typeof right !== 'object')
                throw new Unsupported('Identity of non-singleton scalars requires full Python');
              result = left === right;
              if (item.op === 'is not') result = !result;
            }
            else if (item.op === 'in' || item.op === 'not in') {
              if (Array.isArray(right)) result = right.some((x) => pyEqual(x, left));
              else if (right instanceof PythonTuple) result = right.values.some((x) => pyEqual(x, left));
              else if (right instanceof PythonDict || right instanceof PythonSet) result = right.has(left);
              else if (typeof right === 'string' && typeof left === 'string') result = right.includes(left);
              else throw new Error(`TypeError: argument of type '${pythonTypeName(right)}' is not iterable`);
              if (item.op === 'not in') result = !result;
            } else {
              const order = pyOrder(left, right);
              if (order === null) throw new Error(`TypeError: '${item.op}' not supported between instances of '${pythonTypeName(left)}' and '${pythonTypeName(right)}'`);
              if (item.op === '<') result = order < 0;
              else if (item.op === '<=') result = order <= 0;
              else if (item.op === '>') result = order > 0;
              else result = order >= 0;
            }
            if (!result) return false;
            left = right;
          }
          return true;
        }
        case 'binary': {
          const left = evalNode(node.left);
          if (node.op === 'and') return truthy(left) ? evalNode(node.right) : left;
          if (node.op === 'or') return truthy(left) ? left : evalNode(node.right);
          const right = evalNode(node.right);
          if (node.op === '+' && typeof left === 'string' && typeof right === 'string') return left + right;
          if (node.op === '+' && Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
          if (node.op === '+' && left instanceof PythonTuple && right instanceof PythonTuple)
            return new PythonTuple([...left.values, ...right.values]);
          if (left instanceof PythonSet && right instanceof PythonSet && ['&', '|', '^', '-'].includes(node.op)) {
            const result = new PythonSet();
            const include = (item: unknown) => { if (!result.add(item)) throw new Unsupported('Set item requires a hashable scalar or tuple'); };
            if (node.op === '&') left.values().filter((item) => right.has(item)).forEach(include);
            if (node.op === '|') [...left.values(), ...right.values()].forEach(include);
            if (node.op === '^') [...left.values().filter((item) => !right.has(item)), ...right.values().filter((item) => !left.has(item))].forEach(include);
            if (node.op === '-') left.values().filter((item) => !right.has(item)).forEach(include);
            return result;
          }
          if (node.op === '*') {
            const sequence = typeof left === 'string' || Array.isArray(left) || left instanceof PythonTuple ? left
              : typeof right === 'string' || Array.isArray(right) || right instanceof PythonTuple ? right : null;
            const rawCount = sequence === left ? right : left;
            const count = typeof rawCount === 'boolean' ? Number(rawCount) : rawCount;
            if (sequence !== null && Number.isSafeInteger(count)) {
              const times = Math.max(0, count as number);
              const values = sequence instanceof PythonTuple ? sequence.values : sequence;
              if (values.length * times > 100_000) throw new Unsupported('Repeated sequence exceeds the fast result limit');
              if (typeof sequence === 'string') return sequence.repeat(times);
              const repeated = Array.from({ length: times }, () => values).flat();
              return sequence instanceof PythonTuple ? new PythonTuple(repeated) : repeated;
            }
          }
          if (typeof left === 'boolean' && typeof right === 'boolean' && ['&', '|', '^'].includes(node.op)) {
            return node.op === '&' ? left && right : node.op === '|' ? left || right : left !== right;
          }
          const numericLeft = typeof left === 'boolean' ? Number(left) : left;
          const numericRight = typeof right === 'boolean' ? Number(right) : right;
          if (typeof numericLeft !== 'number' || typeof numericRight !== 'number')
            throw new Error(`TypeError: unsupported operand type(s) for ${node.op}: '${pythonTypeName(left)}' and '${pythonTypeName(right)}'`);
          if (node.op === '/' || node.op === '//' || node.op === '%') {
            if (numericRight === 0) throw new Error('ZeroDivisionError: division by zero');
            if (node.op === '/') return checkedNumber(numericLeft / numericRight);
            if (!Number.isSafeInteger(numericLeft) || !Number.isSafeInteger(numericRight)) throw new Unsupported('Float floor division and modulo require full Python');
            const dividend = BigInt(numericLeft); const divisor = BigInt(numericRight);
            let quotient = dividend / divisor;
            if (dividend % divisor !== 0n && (dividend < 0n) !== (divisor < 0n)) quotient -= 1n;
            return checkedNumber(Number(node.op === '//' ? quotient : dividend - quotient * divisor));
          }
          if (node.op === '+') return checkedNumber(numericLeft + numericRight);
          if (node.op === '-') return checkedNumber(numericLeft - numericRight);
          if (node.op === '*') return checkedNumber(numericLeft * numericRight);
          if (node.op === '**') return checkedNumber(numericLeft ** numericRight);
          if (!Number.isSafeInteger(numericLeft) || !Number.isSafeInteger(numericRight)) throw new Unsupported('Bitwise operator requires exact integers');
          if (['&', '|', '^', '<<', '>>'].includes(node.op)) {
            if ((node.op === '<<' || node.op === '>>') && (numericRight < 0 || numericRight > 1_000)) throw new Unsupported('Shift count outside fast subset');
            const a = BigInt(numericLeft); const b = BigInt(numericRight);
            const answer = node.op === '&' ? a & b : node.op === '|' ? a | b : node.op === '^' ? a ^ b : node.op === '<<' ? a << b : a >> b;
            return checkedNumber(Number(answer));
          }
          throw new Unsupported('Operator requires full Python');
        }
      }
    };
    return { kind: 'ok', value: evalNode(tree), steps };
  } catch (error) {
    if (options?.shouldRethrow?.(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof StepLimit) return { kind: 'step-limit', message, steps };
    if (error instanceof PythonSyntaxFailure) return { kind: 'compile-error', message: `${error.name}: ${message}`, steps };
    if (error instanceof Unsupported) return { kind: 'unsupported', message, steps };
    return { kind: 'runtime-error', message, steps };
  }
}
