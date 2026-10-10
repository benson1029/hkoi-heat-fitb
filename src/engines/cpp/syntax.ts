/** A deliberately small C/C++ grammar. Unknown constructs are never guessed. */
export class CppFault extends Error {
  constructor(public readonly kind: 'compile-error' | 'runtime-error' | 'step-limit' | 'unsupported', message: string) {
    super(message);
  }
}

export interface Token { text: string; at: number }
export type TypeName = 'int' | 'long long' | 'bool' | 'char' | 'string' | 'double' | 'void' | 'size_t' | 'vector<int>' | 'vector<vector<int>>' | 'deque<int>' | 'stack<int>' | 'queue<int>' | 'priority_queue<int>' | `array<int,${number}>` | `struct ${string}` | `pointer:${string}`;
export type Initializer = Expr | Initializer[];
export interface Decl { name: string; type: TypeName; array?: Expr; arrayParameter?: boolean; reference?: boolean; init?: Initializer; constructArgs?: Expr[] }
export type Expr =
  | { kind: 'number'; value: bigint; long: boolean }
  | { kind: 'float'; value: number }
  | { kind: 'char'; value: bigint }
  | { kind: 'string'; value: string }
  | { kind: 'name'; name: string }
  | { kind: 'index'; base: Expr; index: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'method-call'; base: Expr; name: string; args: Expr[] }
  | { kind: 'member'; base: Expr; name: string }
  | { kind: 'field'; base: Expr; name: string; viaPointer: boolean }
  | { kind: 'cast'; type: TypeName; arg: Expr }
  | { kind: 'unary'; op: string; arg: Expr; postfix?: boolean }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'conditional'; condition: Expr; yes: Expr; no: Expr }
  | { kind: 'assign'; op: string; left: Expr; right: Expr };
export type Stmt =
  | { kind: 'block'; statements: Stmt[] }
  | { kind: 'declaration'; declarations: Decl[] }
  | { kind: 'expression'; expression?: Expr }
  | { kind: 'if'; condition: Expr; yes: Stmt; no?: Stmt }
  | { kind: 'while'; condition: Expr; body: Stmt }
  | { kind: 'do-while'; condition: Expr; body: Stmt }
  | { kind: 'for'; init?: Stmt; condition?: Expr; increment?: Expr; body: Stmt }
  | { kind: 'range-for'; variable: Decl; iterable: Expr; body: Stmt }
  | { kind: 'return'; value?: Expr }
  | { kind: 'break' | 'continue' };
export interface FunctionDef { name: string; result: TypeName; params: Decl[]; body: Stmt }
export interface TranslationUnit { functions: Map<string, FunctionDef>; globals: Decl[]; structs: Map<string, Decl[]> }

const operators = ['>>=', '<<=', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '->'];
const cppAlternativeOperators: Record<string, string> = {
  and: '&&', or: '||', not: '!', not_eq: '!=',
  bitand: '&', bitor: '|', xor: '^', compl: '~',
  and_eq: '&=', or_eq: '|=', xor_eq: '^='
};
const punct = '{}[]();,?:+-*/%<>=!~&|^.';
const MAX_SOURCE = 128 * 1024;
const MAX_TOKENS = 30000;
const MAX_PARSE_DEPTH = 256;

export function lex(source: string, language: 'cpp' | 'c' = 'cpp'): Token[] {
  if (new TextEncoder().encode(source).length > MAX_SOURCE) throw new CppFault('unsupported', 'Source exceeds 128 KiB');
  // Only header declarations are accepted. Macros and conditional compilation alter semantics.
  source = source.replace(/^\s*#\s*include\s*[<"]([^>"]+)[>"]\s*$/gm, (_whole, header: string) => {
    if (!['algorithm', 'array', 'cmath', 'cstdlib', 'deque', 'forward_list', 'iostream', 'list', 'queue', 'stack', 'string', 'utility', 'vector',
      'cstdio', 'stdio.h', 'math.h', 'bits/stdc++.h', 'climits', 'cstdint', 'stdlib.h', 'limits.h'].includes(header))
      throw new CppFault('unsupported', `Header ${header} is not modeled`);
    if (language === 'c' && ['algorithm', 'array', 'cmath', 'cstdlib', 'deque', 'forward_list', 'iostream', 'list', 'queue', 'stack', 'string', 'utility', 'vector',
      'cstdio', 'bits/stdc++.h', 'climits', 'cstdint'].includes(header))
      throw new CppFault('compile-error', `C program cannot include C++ header ${header}`);
    return ' ';
  });
  if (/(^|\n)\s*#/.test(source)) throw new CppFault('unsupported', 'Preprocessor directives are not modeled');
  const result: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith('//', i)) { i = source.indexOf('\n', i + 2); if (i < 0) break; continue; }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new CppFault('compile-error', 'Unterminated comment');
      i = end + 2; continue;
    }
    const start = i;
    const c = source[i];
    if (/[A-Za-z_]/.test(c)) { i++; while (i < source.length && /[A-Za-z_0-9]/.test(source[i])) i++; }
    else if (/[0-9]/.test(c)) {
      i++; while (i < source.length && /[A-Za-z_0-9]/.test(source[i])) i++;
      if (source[i] === '.' && /[0-9]/.test(source[i + 1] ?? '')) {
        i++; while (i < source.length && /[0-9]/.test(source[i])) i++;
      }
    }
    else if (c === '"' || c === "'") {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i++] === c) break;
      }
      if (source[i - 1] !== c || i > source.length) throw new CppFault('compile-error', 'Unterminated string or character literal');
    } else {
      const op = operators.find(o => source.startsWith(o, i));
      if (op) i += op.length;
      else if (punct.includes(c)) i++;
      else throw new CppFault('unsupported', `Unsupported token ${JSON.stringify(c)} at ${i}`);
    }
    const text = source.slice(start, i);
    result.push({ text: language === 'cpp' ? cppAlternativeOperators[text] ?? text : text, at: start });
    if (result.length > MAX_TOKENS) throw new CppFault('unsupported', 'Token limit exceeded');
  }
  result.push({ text: '<eof>', at: source.length });
  return result;
}

const precedence: Record<string, number> = {
  '||': 2, '&&': 3, '|': 4, '^': 5, '&': 6,
  '==': 7, '!=': 7, '<': 8, '<=': 8, '>': 8, '>=': 8,
  '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11,
};
const assignments = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=']);

export class Parser {
  private pos = 0;
  private depth = 0;
  private readonly aliases = new Map<string, TypeName>();
  private readonly structs = new Map<string, Decl[]>();
  constructor(private readonly tokens: Token[], private readonly language: 'cpp' | 'c') {}
  private peek(n = 0): string { return this.tokens[this.pos + n]?.text ?? '<eof>'; }
  private take(): string { return this.tokens[this.pos++].text; }
  private eat(t: string): boolean { if (this.peek() === t) { this.pos++; return true; } return false; }
  private need(t: string): void { if (!this.eat(t)) throw new CppFault('compile-error', `Expected ${t} at ${this.tokens[this.pos].at}, got ${this.peek()}`); }
  private enter(): void { if (++this.depth > MAX_PARSE_DEPTH) throw new CppFault('unsupported', 'Syntax nesting limit exceeded'); }
  private leave(): void { this.depth--; }
  private identifier(): string {
    const s = this.take();
    if (!/^[A-Za-z_]\w*$/.test(s)) throw new CppFault('compile-error', `Expected identifier, got ${s}`);
    return s;
  }
  private type(): TypeName {
    if (this.eat('const')) throw new CppFault('unsupported', 'Const qualification is not modeled');
    let t = this.take();
    if (t === 'struct') return `struct ${this.identifier()}`;
    const alias = this.aliases.get(t);
    if (alias) return alias;
    if (t === 'std' && this.eat('::')) t = this.take();
    if (t === 'stack' || t === 'queue' || t === 'deque' || t === 'priority_queue') {
      if (this.language === 'c') throw new CppFault('compile-error', `std::${t} is not a C type`);
      this.need('<'); this.need('int'); this.need('>');
      return `${t}<int>`;
    }
    if (t === 'vector') {
      if (this.language === 'c') throw new CppFault('compile-error', 'std::vector is not a C type');
      this.need('<');
      if (this.eat('int')) { this.need('>'); return 'vector<int>'; }
      if (this.eat('vector')) {
        this.need('<'); this.need('int');
        if (!this.eat('>>')) { this.need('>'); this.need('>'); }
        return 'vector<vector<int>>';
      }
      throw new CppFault('unsupported', 'Only vector<int> and vector<vector<int>> are modeled');
    }
    if (t === 'array') {
      if (this.language === 'c') throw new CppFault('compile-error', 'std::array is not a C type');
      this.need('<'); this.need('int'); this.need(',');
      const size = this.take();
      if (!/^\d+$/.test(size) || Number(size) > 16384) throw new CppFault('unsupported', 'Only bounded array<int,N> sizes are modeled');
      this.need('>');
      return `array<int,${Number(size)}>`;
    }
    if (t === 'long') { if (!this.eat('long')) throw new CppFault('unsupported', 'Plain long width is target-dependent'); t = 'long long'; }
    if (t !== 'int' && t !== 'long long' && t !== 'bool' && t !== 'char' && t !== 'string' && t !== 'double' && t !== 'void' && t !== 'size_t')
      throw new CppFault('unsupported', `Type ${t} is not modeled`);
    if (t === 'string' && this.language === 'c') throw new CppFault('compile-error', 'std::string is not a C type');
    return t;
  }
  private isType(): boolean { return this.aliases.has(this.peek()) || ['int', 'long', 'bool', 'char', 'double', 'void', 'const', 'string', 'vector', 'array', 'deque', 'stack', 'queue', 'priority_queue', 'size_t', 'struct'].includes(this.peek()) ||
    this.peek() === 'std' && this.peek(1) === '::' && ['string', 'vector', 'array', 'deque', 'stack', 'queue', 'priority_queue'].includes(this.peek(2)); }
  private pointerType(type: TypeName): TypeName {
    if (type.startsWith('struct ')) return `pointer:${type.slice('struct '.length)}`;
    if (['int', 'long long', 'bool', 'char', 'size_t'].includes(type)) return `pointer:scalar:${type}`;
    throw new CppFault('unsupported', `Pointers to ${type} are not modeled`);
  }
  private declarator(type: TypeName, parameter = false): Decl {
    if (this.eat('*')) type = this.pointerType(type);
    const reference = this.eat('&');
    if (reference && !['int', 'long long', 'bool', 'char', 'size_t', 'vector<int>', 'deque<int>'].includes(type) && !type.startsWith('array<int,'))
      throw new CppFault('unsupported', `References to ${type} are not modeled`);
    if (reference && !parameter && !['int', 'long long', 'bool', 'char', 'size_t'].includes(type))
      throw new CppFault('unsupported', `Local references to ${type} are not modeled`);
    if (reference && this.language === 'c') throw new CppFault('compile-error', 'References are not C syntax');
    const name = this.identifier();
    let array: Expr | undefined;
    let arrayParameter = false;
    if (this.eat('[')) {
      if (parameter && this.eat(']')) arrayParameter = true;
      else { array = this.expression(); this.need(']'); if (parameter) arrayParameter = true; }
    }
    let init: Initializer | undefined;
    let constructArgs: Expr[] | undefined;
    if (this.eat('=')) {
      if (this.eat('{')) { init = this.list('}', () => this.initializer()); }
      else init = this.expression(2);
    } else if (this.eat('{')) init = this.list('}', () => this.initializer());
    else if ((type.startsWith('vector<') || type === 'deque<int>') && this.eat('(')) constructArgs = this.list(')', () => this.expression(2));
    return { name, type, array, arrayParameter, reference, init, constructArgs };
  }
  private initializer(): Initializer {
    this.enter();
    try {
      if (this.eat('{')) return this.list('}', () => this.initializer());
      return this.expression(2);
    } finally { this.leave(); }
  }
  private list<T>(close: string, parse: () => T): T[] {
    const items: T[] = [];
    if (this.eat(close)) return items;
    do { items.push(parse()); if (items.length > 10000) throw new CppFault('unsupported', 'List limit exceeded'); } while (this.eat(','));
    this.need(close); return items;
  }
  private declarations(type: TypeName, first?: Decl): Decl[] {
    const list = [first ?? this.declarator(type)];
    while (this.eat(',')) list.push(this.declarator(type));
    this.need(';'); return list;
  }
  parse(): TranslationUnit {
    const functions = new Map<string, FunctionDef>();
    const globals: Decl[] = [];
    while (this.peek() !== '<eof>') {
      if (this.eat('typedef')) {
        const base = this.type();
        this.need('*');
        const alias = this.identifier();
        this.need(';');
        if (this.aliases.has(alias)) throw new CppFault('compile-error', `Duplicate typedef ${alias}`);
        this.aliases.set(alias, this.pointerType(base));
        continue;
      }
      if (this.peek() === 'struct' && this.peek(2) === '{') {
        this.take();
        const name = this.identifier();
        this.need('{');
        if (this.structs.has(name)) throw new CppFault('compile-error', `Duplicate struct ${name}`);
        const fields: Decl[] = [];
        while (!this.eat('}')) {
          if (this.peek() === '<eof>') this.need('}');
          fields.push(...this.declarations(this.type()));
          if (fields.length > 64) throw new CppFault('unsupported', 'Struct has too many fields');
        }
        this.need(';');
        if (fields.some(field => field.array || field.init || field.constructArgs || field.type.startsWith('struct ')))
          throw new CppFault('unsupported', 'Only scalar and struct-pointer fields are modeled');
        if (new Set(fields.map(field => field.name)).size !== fields.length)
          throw new CppFault('compile-error', `Duplicate field in struct ${name}`);
        this.structs.set(name, fields);
        continue;
      }
      if (this.eat('using')) {
        if (this.language === 'c') throw new CppFault('compile-error', 'using namespace is not C syntax');
        this.need('namespace'); this.need('std'); this.need(';'); continue;
      }
      let result = this.type();
      if (this.eat('*')) result = this.pointerType(result);
      const name = this.identifier();
      if (this.eat('(')) {
        const params = this.list(')', () => {
          const t = this.type();
          if (t === 'void' && this.peek() === ')') return { name: '', type: t } as Decl;
          return this.declarator(t, true);
        }).filter(p => p.name);
        if (this.eat(';')) throw new CppFault('unsupported', 'Separate function prototypes are not modeled');
        const body = this.statement();
        if (body.kind !== 'block') throw new CppFault('compile-error', 'Expected function body');
        if (functions.has(name)) throw new CppFault('unsupported', `Overloaded or duplicate function ${name}`);
        functions.set(name, { name, result, params, body });
      } else {
        // A pre-read name lets the same declarator logic handle globals.
        globals.push(...this.declarations(result, this.finishNamedDeclarator(result, name)));
      }
    }
    return { functions, globals, structs: this.structs };
  }
  private finishNamedDeclarator(type: TypeName, name: string): Decl {
    let array: Expr | undefined;
    if (this.eat('[')) { array = this.expression(); this.need(']'); }
    let init: Initializer | undefined;
    let constructArgs: Expr[] | undefined;
    if (this.eat('=')) init = this.eat('{') ? this.list('}', () => this.initializer()) : this.expression(2);
    else if (this.eat('{')) init = this.list('}', () => this.initializer());
    else if ((type.startsWith('vector<') || type === 'deque<int>') && this.eat('(')) constructArgs = this.list(')', () => this.expression(2));
    return { name, type, array, init, constructArgs };
  }
  private statement(): Stmt {
    this.enter();
    try {
      if (this.eat('{')) { const statements: Stmt[] = []; while (!this.eat('}')) { if (this.peek() === '<eof>') this.need('}'); statements.push(this.statement()); } return { kind: 'block', statements }; }
      if (['auto', 'unsigned', 'signed', 'class', 'double', 'float', 'template', 'typedef', 'enum', 'static', 'switch', 'goto', 'try', 'throw', 'namespace', 'new', 'delete'].includes(this.peek()))
        throw new CppFault('unsupported', `Declaration or construct ${this.peek()} is not modeled`);
      if (this.isType()) { const t = this.type(); return { kind: 'declaration', declarations: this.declarations(t) }; }
      if (this.eat('if')) { this.need('('); const condition = this.expression(); this.need(')'); const yes = this.statement(); const no = this.eat('else') ? this.statement() : undefined; return { kind: 'if', condition, yes, no }; }
      if (this.eat('while')) { this.need('('); const condition = this.expression(); this.need(')'); return { kind: 'while', condition, body: this.statement() }; }
      if (this.eat('do')) { const body = this.statement(); this.need('while'); this.need('('); const condition = this.expression(); this.need(')'); this.need(';'); return { kind: 'do-while', condition, body }; }
      if (this.eat('for')) {
        this.need('(');
        let init: Stmt | undefined;
        if (this.eat(';')) {} else if (this.isType()) {
          const t = this.type();
          const variable = this.declarator(t);
          if (this.eat(':')) {
            if (this.language === 'c') throw new CppFault('compile-error', 'Range-based for is not C syntax');
            if (variable.array || variable.init) throw new CppFault('unsupported', 'Range-for variable must be a plain value declaration');
            const iterable = this.expression(); this.need(')');
            return { kind: 'range-for', variable, iterable, body: this.statement() };
          }
          init = { kind: 'declaration', declarations: this.declarations(t, variable) };
        }
        else { init = { kind: 'expression', expression: this.expression() }; this.need(';'); }
        const condition = this.peek() === ';' ? undefined : this.expression(); this.need(';');
        const increment = this.peek() === ')' ? undefined : this.expression(); this.need(')');
        return { kind: 'for', init, condition, increment, body: this.statement() };
      }
      if (this.eat('return')) { const value = this.peek() === ';' ? undefined : this.expression(); this.need(';'); return { kind: 'return', value }; }
      if (this.eat('break')) { this.need(';'); return { kind: 'break' }; }
      if (this.eat('continue')) { this.need(';'); return { kind: 'continue' }; }
      const expression = this.peek() === ';' ? undefined : this.expression(); this.need(';'); return { kind: 'expression', expression };
    } finally { this.leave(); }
  }
  private expression(min = 1): Expr {
    this.enter();
    try {
      let left = this.prefix();
      for (;;) {
        if (this.peek() === '[' && 13 >= min) { this.take(); const index = this.expression(); this.need(']'); left = { kind: 'index', base: left, index }; continue; }
        if (this.peek() === '(' && 13 >= min) {
          this.take(); const args = this.list(')', () => this.expression(2));
          if (left.kind === 'name') left = { kind: 'call', name: left.name, args };
          else if (left.kind === 'member') left = { kind: 'method-call', base: left.base, name: left.name, args };
          else throw new CppFault('unsupported', 'Indirect calls are not modeled');
          continue;
        }
        if ((this.peek() === '.' || this.peek() === '->') && 13 >= min) {
          const viaPointer = this.take() === '->';
          const member = this.identifier();
          if (!viaPointer && ['length', 'size', 'begin', 'end', 'empty', 'front', 'back', 'top', 'push', 'pop', 'push_back', 'pop_back', 'push_front', 'pop_front', 'clear', 'fill', 'at', 'substr', 'find', 'rfind', 'resize', 'assign', 'append'].includes(member))
            left = left.kind === 'name' ? { kind: 'name', name: `${left.name}.${member}` } : { kind: 'member', base: left, name: member };
          else left = { kind: 'field', base: left, name: member, viaPointer };
          continue;
        }
        if (['++', '--'].includes(this.peek()) && 13 >= min) { left = { kind: 'unary', op: this.take(), arg: left, postfix: true }; continue; }
        if (this.peek() === '?' && min <= 2) { this.take(); const yes = this.expression(); this.need(':'); const no = this.expression(2); left = { kind: 'conditional', condition: left, yes, no }; continue; }
        const op = this.peek();
        if (assignments.has(op) && min <= 1) { this.take(); left = { kind: 'assign', op, left, right: this.expression(1) }; continue; }
        const bp = precedence[op] ?? -1;
        if (bp < min) break;
        this.take(); left = { kind: 'binary', op, left, right: this.expression(bp + 1) };
      }
      return left;
    } finally { this.leave(); }
  }
  private prefix(): Expr {
    const t = this.take();
    if (['+', '-', '!', '~', '++', '--', '&', '*'].includes(t)) return { kind: 'unary', op: t, arg: this.expression(12) };
    if (t === '(') {
      if (['int', 'long', 'bool', 'char', 'double', 'size_t'].includes(this.peek())) {
        const type = this.type(); this.need(')');
        return { kind: 'cast', type, arg: this.expression(12) };
      }
      const e = this.expression(); this.need(')'); return e;
    }
    if (t === 'true' || t === 'false') return { kind: 'number', value: t === 'true' ? 1n : 0n, long: false };
    if (/^\d/.test(t)) {
      if (/^\d+\.\d+$/.test(t)) return { kind: 'float', value: Number(t) };
      const match = /^(0[xX][0-9a-fA-F]+|\d+)([uUlL]*)$/.exec(t);
      if (!match) throw new CppFault('unsupported', `Numeric literal ${t} is not modeled`);
      if (/u/i.test(match[2])) throw new CppFault('unsupported', 'Unsigned integers are not modeled');
      const digits = match[1];
      if (/^0[0-9]+$/.test(digits) && /[89]/.test(digits)) throw new CppFault('compile-error', `Invalid octal literal ${digits}`);
      const value = /^0[0-7]+$/.test(digits) ? BigInt(`0o${digits.slice(1)}`) : BigInt(digits);
      if (/^0[xX]/.test(digits) && value > 2147483647n && !/l/i.test(match[2]))
        throw new CppFault('unsupported', 'Unsigned hexadecimal literal is not modeled');
      return { kind: 'number', value, long: /l/i.test(match[2]) };
    }
    if (t.startsWith('"') || t.startsWith("'")) {
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', '\\': '\\', '"': '"', "'": "'" };
      const value = t.slice(1, -1).replace(/\\(.)/g, (_m, ch: string) => {
        if (!(ch in escapes)) throw new CppFault('unsupported', `Escape \\${ch} is not modeled`);
        return escapes[ch];
      });
      if (t.startsWith("'")) {
        if ([...value].length !== 1) throw new CppFault('unsupported', 'Multicharacter literal');
        const code = BigInt(value.charCodeAt(0));
        return this.language === 'c' ? { kind: 'number', value: code, long: false } : { kind: 'char', value: code };
      }
      return { kind: 'string', value };
    }
    if (/^[A-Za-z_]\w*$/.test(t)) {
      let name = t;
      while (this.eat('::')) name += `::${this.identifier()}`;
      return { kind: 'name', name };
    }
    throw new CppFault('compile-error', `Unexpected token ${t}`);
  }
}

function verifyAst(unit: TranslationUnit): void {
  const work: { node: Expr | Stmt; depth: number }[] = [];
  const addExpr = (expr: Expr | undefined, depth: number) => { if (expr) work.push({ node: expr, depth }); };
  const addInit = (init: Initializer | undefined, depth: number): void => {
    if (Array.isArray(init)) for (const item of init) addInit(item, depth + 1);
    else addExpr(init, depth);
  };
  for (const fn of unit.functions.values()) work.push({ node: fn.body, depth: 1 });
  for (const decl of unit.globals) { addExpr(decl.array, 1); addInit(decl.init, 1); for (const arg of decl.constructArgs ?? []) addExpr(arg, 1); }
  let nodes = 0;
  while (work.length) {
    const { node, depth } = work.pop()!;
    if (++nodes > MAX_TOKENS || depth > MAX_PARSE_DEPTH) throw new CppFault('unsupported', 'AST node or depth limit exceeded');
    const next = depth + 1;
    switch (node.kind) {
      case 'block': for (const child of node.statements) work.push({ node: child, depth: next }); break;
      case 'declaration': for (const decl of node.declarations) { addExpr(decl.array, next); addInit(decl.init, next); for (const arg of decl.constructArgs ?? []) addExpr(arg, next); } break;
      case 'expression': addExpr(node.expression, next); break;
      case 'if': addExpr(node.condition, next); work.push({ node: node.yes, depth: next }); if (node.no) work.push({ node: node.no, depth: next }); break;
      case 'while': addExpr(node.condition, next); work.push({ node: node.body, depth: next }); break;
      case 'do-while': addExpr(node.condition, next); work.push({ node: node.body, depth: next }); break;
      case 'for': if (node.init) work.push({ node: node.init, depth: next }); addExpr(node.condition, next); addExpr(node.increment, next); work.push({ node: node.body, depth: next }); break;
      case 'range-for': addExpr(node.iterable, next); work.push({ node: node.body, depth: next }); break;
      case 'return': addExpr(node.value, next); break;
      case 'break': case 'continue': case 'number': case 'float': case 'char': case 'string': case 'name': break;
      case 'index': addExpr(node.base, next); addExpr(node.index, next); break;
      case 'call': for (const arg of node.args) addExpr(arg, next); break;
      case 'method-call': addExpr(node.base, next); for (const arg of node.args) addExpr(arg, next); break;
      case 'member': addExpr(node.base, next); break;
      case 'field': addExpr(node.base, next); break;
      case 'cast': addExpr(node.arg, next); break;
      case 'unary': addExpr(node.arg, next); break;
      case 'binary': addExpr(node.left, next); addExpr(node.right, next); break;
      case 'conditional': addExpr(node.condition, next); addExpr(node.yes, next); addExpr(node.no, next); break;
      case 'assign': addExpr(node.left, next); addExpr(node.right, next); break;
    }
  }
}

export function parse(source: string, language: 'cpp' | 'c' = 'cpp'): TranslationUnit {
  const unit = new Parser(lex(source, language), language).parse();
  verifyAst(unit);
  return unit;
}
