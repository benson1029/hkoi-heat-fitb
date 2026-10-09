/** Small, deliberately closed Python expression evaluator used for cheap candidate probes.
 * Unsupported syntax is handed to Pyodide by the normal engine. */
export type PythonExpressionResult =
  | { kind: 'ok'; value: unknown; steps: number }
  | { kind: 'unsupported' | 'runtime-error' | 'step-limit'; message: string; steps: number };

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
  | { kind: 'subscript'; base: Node; index: Node }
  | { kind: 'slice'; base: Node; start: Node | null; end: Node | null; step: Node | null }
  | { kind: 'attribute'; base: Node; name: string }
  | { kind: 'call'; fn: Node; args: Node[] };

export interface PythonExpressionOptions {
  meter?: { steps: number };
  invoke?: (name: string, args: unknown[], receiver?: unknown) => { handled: true; value: unknown } | { handled: false };
  isCallableName?: (name: string) => boolean;
  shouldRethrow?: (error: unknown) => boolean;
}

class Unsupported extends Error {}
class StepLimit extends Error {}

export class PythonTuple {
  constructor(readonly values: unknown[]) {}
}

const KEYWORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else', 'True', 'False', 'None']);
const OPERATORS = ['//', '**', '<<', '>>', '<=', '>=', '==', '!='];
const SINGLE = new Set('+-*/%&|^~<>()[],.:'.split(''));

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
          if (escaped === undefined) throw new Unsupported('Unterminated string');
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
          if (!(escaped in escapes)) throw new Unsupported('String escape is outside the fast subset');
          value += escapes[escaped];
        } else value += ch;
      }
      if (!closed) throw new Unsupported('Unterminated string');
      tokens.push({ text: '<string>', value });
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Unsupported('Number outside safe range');
      tokens.push({ text: '<number>', value });
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z_]\w*/.exec(source.slice(i));
    if (name) { tokens.push({ text: name[0] }); i += name[0].length; continue; }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i));
    if (op) { tokens.push({ text: op }); i += op.length; continue; }
    if (SINGLE.has(c)) { tokens.push({ text: c }); i++; continue; }
    throw new Unsupported(`Token ${JSON.stringify(c)} is outside the fast subset`);
  }
  tokens.push({ text: '<end>' });
  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  or: 1, and: 2, '|': 4, '^': 5, '&': 6, '<<': 7, '>>': 7,
  '+': 8, '-': 8, '*': 9, '/': 9, '//': 9, '%': 9, '**': 11,
};
const COMPARE = new Set(['<', '<=', '>', '>=', '==', '!=', 'in', 'not in']);

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}
  private peek(): string { return this.tokens[this.index].text; }
  private take(text: string): boolean { if (this.peek() !== text) return false; this.index++; return true; }
  private expect(text: string): void { if (!this.take(text)) throw new Unsupported(`Expected ${text}`); }
  parse(): Node {
    const node = this.expression(0);
    if (this.peek() !== '<end>') throw new Unsupported(`Unexpected ${this.peek()}`);
    return node;
  }
  private expression(min: number): Node {
    let left = this.prefix();
    while (true) {
      if (this.peek() === '(' && 12 >= min) {
        this.index++;
        const args: Node[] = [];
        if (!this.take(')')) {
          do { args.push(this.expression(0)); } while (this.take(','));
          this.expect(')');
        }
        left = { kind: 'call', fn: left, args };
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
          if (!first) throw new Unsupported('Missing subscript');
          this.expect(']');
          left = { kind: 'subscript', base: left, index: first };
        }
        continue;
      }
      if (this.peek() === '.' && 12 >= min) {
        this.index++;
        const name = this.tokens[this.index++].text;
        if (!/^[A-Za-z_]\w*$/.test(name)) throw new Unsupported('Expected attribute name');
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
    const token = this.tokens[this.index++];
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
    if (/^[A-Za-z_]\w*$/.test(token.text) && !KEYWORDS.has(token.text)) return { kind: 'name', name: token.text };
    throw new Unsupported(`Unexpected ${token.text}`);
  }
}

function truthy(value: unknown): boolean {
  if (value === null || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (value instanceof PythonTuple && value.values.length === 0) return false;
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
}

function pyEqual(a: unknown, b: unknown): boolean {
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

export function supportsPythonExpressionSyntax(source: string): boolean {
  try { new Parser(lex(source)).parse(); return true; }
  catch { return false; }
}

export function evaluatePythonExpression(source: string, variables: Record<string, unknown> = {}, maxSteps = 1_000, options?: PythonExpressionOptions): PythonExpressionResult {
  let steps = 0;
  try {
    let tree = parseCache.get(source);
    if (!tree) {
      tree = new Parser(lex(source)).parse();
      if (parseCache.size >= 1024) parseCache.clear();
      parseCache.set(source, tree);
    }
    const evalNode = (node: Node): unknown => {
      steps++;
      if (options?.meter) options.meter.steps++;
      if ((options?.meter?.steps ?? steps) > maxSteps) throw new StepLimit('Python fast expression step limit exceeded');
      switch (node.kind) {
        case 'literal': return node.value;
        case 'name':
          if (Object.hasOwn(variables, node.name)) return variables[node.name];
          if (['len', 'abs', 'min', 'max', 'sum', 'int', 'bool', 'str', 'range', 'list', 'input', 'round', 'sorted', 'map', 'all', 'any'].includes(node.name) || options?.isCallableName?.(node.name)) return { builtin: node.name };
          throw new Unsupported(`Name ${node.name} requires full Python`);
        case 'list': return node.items.map(evalNode);
        case 'tuple': return new PythonTuple(node.items.map(evalNode));
        case 'conditional': return truthy(evalNode(node.test)) ? evalNode(node.yes) : evalNode(node.no);
        case 'attribute': return { method: node.name, receiver: evalNode(node.base) };
        case 'subscript': {
          const base = evalNode(node.base);
          const index = evalNode(node.index);
          if ((typeof base !== 'string' && !Array.isArray(base) && !(base instanceof PythonTuple)) || !Number.isInteger(index)) throw new Unsupported('Subscript requires a sequence and integer index');
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
          if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end)) || !Number.isSafeInteger(step)) throw new Unsupported('Slice indices require integers');
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
          if (!fn || typeof fn !== 'object') throw new Unsupported('Call target requires full Python');
          if ('method' in fn) {
            const invoked = options?.invoke?.(String(fn.method), args, (fn as unknown as { receiver: unknown }).receiver);
            if (invoked?.handled) return invoked.value;
            throw new Unsupported(`Method ${String(fn.method)} requires full Python`);
          }
          if (!('builtin' in fn)) throw new Unsupported('Call target requires full Python');
          const name = String(fn.builtin);
          const invoked = options?.invoke?.(name, args);
          if (invoked?.handled) return invoked.value;
          if (name === 'len' && args.length === 1 && typeof args[0] === 'string') return [...args[0]].length;
          if (name === 'len' && args.length === 1 && Array.isArray(args[0])) return args[0].length;
          if (name === 'len' && args.length === 1 && args[0] instanceof PythonTuple) return args[0].values.length;
          if (name === 'abs' && args.length === 1 && typeof args[0] === 'number') return checkedNumber(Math.abs(args[0]));
          if (name === 'bool' && args.length === 1) return truthy(args[0]);
          if (name === 'int' && args.length === 1 && (typeof args[0] === 'number' || typeof args[0] === 'boolean')) return checkedNumber(Math.trunc(Number(args[0])));
          if (name === 'str' && args.length === 1 && typeof args[0] === 'string') return args[0];
          if ((name === 'min' || name === 'max') && args.length > 0 && args.every((x) => typeof x === 'number')) return name === 'min' ? Math.min(...args as number[]) : Math.max(...args as number[]);
          if (name === 'sum' && args.length === 1 && Array.isArray(args[0]) && args[0].every((x) => typeof x === 'number')) return checkedNumber(args[0].reduce((a: number, b: number) => a + b, 0));
          throw new Unsupported(`Call to ${String(name)} requires full Python`);
        }
        case 'unary': {
          const value = evalNode(node.child);
          if (node.op === 'not') return !truthy(value);
          const number = typeof value === 'boolean' ? Number(value) : value;
          if (typeof number !== 'number') throw new Unsupported('Numeric unary operator requires a number');
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
            else if (item.op === 'in' || item.op === 'not in') {
              if (Array.isArray(right)) result = right.some((x) => pyEqual(x, left));
              else if (right instanceof PythonTuple) result = right.values.some((x) => pyEqual(x, left));
              else if (typeof right === 'string' && typeof left === 'string') result = right.includes(left);
              else throw new Unsupported('Membership requires a list or string');
              if (item.op === 'not in') result = !result;
            } else if ((typeof left === 'number' && typeof right === 'number') || (typeof left === 'string' && typeof right === 'string')) {
              const order = typeof left === 'string' && typeof right === 'string' ? comparePythonStrings(left, right) : (left as number) - (right as number);
              if (item.op === '<') result = order < 0;
              else if (item.op === '<=') result = order <= 0;
              else if (item.op === '>') result = order > 0;
              else result = order >= 0;
            } else throw new Unsupported('Ordering requires matching scalar types');
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
          if (node.op === '*' && typeof left === 'string' && Number.isSafeInteger(right) && (right as number) >= 0 && (right as number) <= 10_000) return left.repeat(right as number);
          if (node.op === '*' && Array.isArray(left) && Number.isSafeInteger(right) && (right as number) >= 0 && (right as number) <= 10_000) return Array.from({ length: right as number }, () => left).flat();
          if (typeof left === 'boolean' && typeof right === 'boolean' && ['&', '|', '^'].includes(node.op)) {
            return node.op === '&' ? left && right : node.op === '|' ? left || right : left !== right;
          }
          const numericLeft = typeof left === 'boolean' ? Number(left) : left;
          const numericRight = typeof right === 'boolean' ? Number(right) : right;
          if (typeof numericLeft !== 'number' || typeof numericRight !== 'number') throw new Unsupported('Numeric operator requires numbers');
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
    if (error instanceof Unsupported) return { kind: 'unsupported', message, steps };
    return { kind: 'runtime-error', message, steps };
  }
}
