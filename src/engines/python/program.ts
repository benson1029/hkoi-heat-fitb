import type { EngineResult, JsonValue, ProgramCase, ProgramTarget } from '../../core/types';
import { comparePythonStrings, evaluatePythonExpression, PythonTuple, supportsPythonExpressionSyntax, type PythonExpressionOptions } from './expression';

type Line = { indent: number; text: string };
type Statement =
  | { kind: 'def'; name: string; params: string[]; body: Statement[] }
  | { kind: 'if'; branches: { test: string | null; body: Statement[] }[] }
  | { kind: 'for'; target: string; iterable: string; body: Statement[] }
  | { kind: 'while'; test: string; body: Statement[] }
  | { kind: 'return'; value: string | null }
  | { kind: 'assign'; targets: string; op: string; value: string }
  | { kind: 'expr'; value: string }
  | { kind: 'break' | 'continue' | 'pass' };

class Unsupported extends Error {}
class Runtime extends Error {}
class Exhausted extends Error {}
class ReturnSignal { constructor(readonly value: unknown) {} }
class BreakSignal {}
class ContinueSignal {}
const STEP_SCALE = 5;

function stripComment(line: string): string {
  let quote: string | null = null; let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function balance(text: string): number {
  let quote: string | null = null; let escaped = false; let depth = 0;
  for (const c of text) {
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
  }
  return depth;
}

function logicalLines(source: string): Line[] {
  if (source.includes('\t') || source.includes('"""') || source.includes("'''")) throw new Unsupported('Tabs or triple strings require full Python');
  const result: Line[] = [];
  let pending = ''; let indent = 0; let depth = 0;
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const withoutComment = stripComment(raw).trimEnd();
    if (!withoutComment.trim()) continue;
    const currentIndent = raw.length - raw.trimStart().length;
    if (!pending) indent = currentIndent;
    pending += (pending ? ' ' : '') + withoutComment.trim();
    depth += balance(withoutComment);
    if (depth < 0) throw new Unsupported('Unbalanced delimiters');
    if (depth === 0 && !pending.endsWith('\\')) {
      const inline = /^(if .+): (return(?: .+)?|pass)$/.exec(pending);
      if (inline) {
        result.push({ indent, text: `${inline[1]}:` });
        result.push({ indent: indent + 4, text: inline[2] });
      } else result.push({ indent, text: pending });
      pending = '';
    } else if (pending.endsWith('\\')) pending = pending.slice(0, -1);
  }
  if (pending || depth !== 0) throw new Unsupported('Incomplete Python statement');
  return result;
}

function splitTop(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let quote: string | null = null; let escaped = false; let depth = 0; let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth--; continue; }
    if (depth === 0 && c === separator) { parts.push(text.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function findAssignment(text: string): { left: string; op: string; right: string } | null {
  let quote: string | null = null; let escaped = false; let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth--; continue; }
    if (depth || c !== '=' || '=!<>'.includes(text[i - 1] ?? '') || text[i + 1] === '=') continue;
    const operator = /(?:\/\/|\*\*|<<|>>|[+\-*/%&|^])$/.exec(text.slice(0, i));
    const op = operator ? `${operator[0]}=` : '=';
    const left = text.slice(0, i - (operator?.[0].length ?? 0)).trim();
    return { left, op, right: text.slice(i + 1).trim() };
  }
  return null;
}

class Parser {
  private index = 0;
  constructor(private readonly lines: Line[]) {}
  parse(): Statement[] {
    if (!this.lines.length) return [];
    if (this.lines[0].indent !== 0) throw new Unsupported('Unexpected indentation');
    const body = this.block(0);
    if (this.index !== this.lines.length) throw new Unsupported('Unexpected indentation');
    return body;
  }
  private nested(parent: number): Statement[] {
    const next = this.lines[this.index];
    if (!next || next.indent <= parent) throw new Unsupported('Expected indented block');
    return this.block(next.indent);
  }
  private block(indent: number): Statement[] {
    const result: Statement[] = [];
    while (this.index < this.lines.length && this.lines[this.index].indent === indent) {
      const text = this.lines[this.index++].text;
      const def = /^def ([A-Za-z_]\w*)\((.*)\)(?:\s*->\s*[^:]+)?\s*:$/.exec(text);
      if (def) {
        const params = def[2].trim() ? splitTop(def[2]).map((entry) => {
          const parsed = /^([A-Za-z_]\w*)(?:\s*:\s*.+)?$/.exec(entry);
          if (!parsed) throw new Unsupported('Function parameter requires full Python');
          return parsed[1];
        }) : [];
        result.push({ kind: 'def', name: def[1], params, body: this.nested(indent) });
        continue;
      }
      const ifMatch = /^if (.*):$/.exec(text);
      if (ifMatch) {
        const branches: { test: string | null; body: Statement[] }[] = [{ test: ifMatch[1], body: this.nested(indent) }];
        while (this.lines[this.index]?.indent === indent) {
          const elif = /^elif (.*):$/.exec(this.lines[this.index].text);
          if (elif) { this.index++; branches.push({ test: elif[1], body: this.nested(indent) }); continue; }
          if (this.lines[this.index].text === 'else:') { this.index++; branches.push({ test: null, body: this.nested(indent) }); }
          break;
        }
        result.push({ kind: 'if', branches });
        continue;
      }
      const forMatch = /^for (.+) in (.+):$/.exec(text);
      if (forMatch) { result.push({ kind: 'for', target: forMatch[1], iterable: forMatch[2], body: this.nested(indent) }); continue; }
      const whileMatch = /^while (.+):$/.exec(text);
      if (whileMatch) { result.push({ kind: 'while', test: whileMatch[1], body: this.nested(indent) }); continue; }
      if (text === 'return' || text.startsWith('return ')) { result.push({ kind: 'return', value: text === 'return' ? null : text.slice(7) }); continue; }
      if (text === 'break' || text === 'continue' || text === 'pass') { result.push({ kind: text }); continue; }
      const assignment = findAssignment(text);
      if (assignment) { result.push({ kind: 'assign', targets: assignment.left, op: assignment.op, value: assignment.right }); continue; }
      if (/^(?:import|from|class|try|except|with|async|global|nonlocal|del|raise)\b/.test(text) || text.endsWith(':')) throw new Unsupported('Statement requires full Python');
      result.push({ kind: 'expr', value: text });
    }
    return result;
  }
}

/** Syntax-only preflight. Runtime failures (for example a zero-filled blank) do not affect this result. */
export function supportsFastPythonSource(source: string, target: ProgramTarget): boolean {
  if (target.language !== 'python') return false;
  let statements: Statement[];
  try { statements = new Parser(logicalLines(source)).parse(); }
  catch { return false; }
  const validExpression = (text: string): boolean => {
    const trimmed = text.trim();
    const generator = /^(any|all)\((.+) for ([A-Za-z_]\w*) in (.+)\)$/.exec(trimmed);
    if (generator) return validExpression(generator[2]) && validExpression(generator[4]);
    const comprehension = /^\[(.+) for ([A-Za-z_]\w*) in (.+)\]$/.exec(trimmed);
    if (comprehension) return validExpression(comprehension[1]) && validExpression(comprehension[3]);
    const parts = splitTop(trimmed);
    if (parts.length > 1) return parts.every(validExpression);
    return supportsPythonExpressionSyntax(trimmed);
  };
  const validTarget = (text: string): boolean => splitTop(text).every((targetText) => {
    if (/^[A-Za-z_]\w*$/.test(targetText)) return true;
    const indexed = /^(.+)\[(.+)\]$/.exec(targetText);
    return !!indexed && validExpression(indexed[1]) && validExpression(indexed[2]);
  });
  const valid = (body: Statement[]): boolean => body.every((statement) => {
    switch (statement.kind) {
      case 'def': return valid(statement.body);
      case 'if': return statement.branches.every((branch) => (branch.test === null || validExpression(branch.test)) && valid(branch.body));
      case 'for': return validTarget(statement.target) && validExpression(statement.iterable) && valid(statement.body);
      case 'while': return validExpression(statement.test) && valid(statement.body);
      case 'return': return statement.value === null || validExpression(statement.value);
      case 'assign': return validTarget(statement.targets) && validExpression(statement.value);
      case 'expr': {
        const printed = /^print\((.*)\)$/.exec(statement.value);
        if (!printed) return validExpression(statement.value);
        return !printed[1].trim() || splitTop(printed[1]).every((entry) => {
          if (entry.startsWith('end=') || entry.startsWith('sep=')) return validExpression(entry.slice(4));
          return validExpression(entry.startsWith('*') ? entry.slice(1) : entry);
        });
      }
      default: return true;
    }
  });
  return valid(statements);
}

function truthy(value: unknown): boolean {
  if (value === null || value === false || value === 0 || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof PythonTuple) return value.values.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function asJson(value: unknown): value is JsonValue {
  if (value instanceof PythonTuple) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(asJson);
  if (value && typeof value === 'object' && !('builtin' in value)) return Object.values(value).every(asJson);
  return false;
}

/** Synchronous, conservative paper runner; undefined means Pyodide must decide. */
export function tryRunPythonProgram(source: string, target: ProgramTarget, testCase: ProgramCase): EngineResult | undefined {
  if (target.language !== 'python') return undefined;
  let body: Statement[];
  try { body = new Parser(logicalLines(source)).parse(); }
  catch { return undefined; }
  const globals: Record<string, unknown> = Object.create(null);
  const functions = new Map<string, Extract<Statement, { kind: 'def' }>>();
  const args = structuredClone(testCase.args ?? []);
  const meter = { steps: 0 };
  const budget = Math.max(1, Math.floor(testCase.maxSteps / STEP_SCALE));
  const stdin = (testCase.stdin ?? '').split('\n');
  let inputAt = 0; let stdout = '';
  const tick = () => { if (++meter.steps > budget) throw new Exhausted(); };
  const scopeVars = (locals: Record<string, unknown>) => ({ ...globals, ...locals });
  const pyString = (value: unknown): string => {
    if (value !== null && typeof value === 'object') throw new Unsupported('Printing containers requires full Python');
    return value === null ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value);
  };

  const call = (name: string, values: unknown[], receiver: unknown, locals: Record<string, unknown>): { handled: true; value: unknown } | { handled: false } => {
    tick();
    const user = functions.get(name);
    if (receiver === undefined && user) {
      if (values.length !== user.params.length) throw new Runtime('TypeError: wrong number of arguments');
      const frame: Record<string, unknown> = Object.create(null);
      user.params.forEach((param, index) => { frame[param] = values[index]; });
      try { execute(user.body, frame); return { handled: true, value: null }; }
      catch (error) { if (error instanceof ReturnSignal) return { handled: true, value: error.value }; throw error; }
    }
    if (receiver !== undefined) {
      if (name === 'split' && typeof receiver === 'string' && values.length <= 1) {
        if (!values.length) return { handled: true, value: receiver.trim() ? receiver.trim().split(/\s+/u) : [] };
        if (typeof values[0] === 'string' && values[0] !== '') return { handled: true, value: receiver.split(values[0]) };
      }
      if (name === 'sort' && Array.isArray(receiver) && !values.length) {
        if (!receiver.every((v) => typeof v === 'number') && !receiver.every((v) => typeof v === 'string')) return { handled: false };
        receiver.sort((a, b) => typeof a === 'string' && typeof b === 'string' ? comparePythonStrings(a, b) : a < b ? -1 : a > b ? 1 : 0);
        return { handled: true, value: null };
      }
      if (name === 'append' && Array.isArray(receiver) && values.length === 1) { receiver.push(values[0]); return { handled: true, value: null }; }
      if (name === 'pop' && Array.isArray(receiver) && values.length <= 1) {
        const index = values.length ? values[0] : -1;
        if (!Number.isSafeInteger(index) || !receiver.length) throw new Runtime('IndexError: pop index out of range');
        const at = (index as number) < 0 ? receiver.length + (index as number) : index as number;
        if (at < 0 || at >= receiver.length) throw new Runtime('IndexError: pop index out of range');
        return { handled: true, value: receiver.splice(at, 1)[0] };
      }
      if (name === 'lower' && typeof receiver === 'string' && !values.length) return { handled: true, value: receiver.toLowerCase() };
      if (name === 'upper' && typeof receiver === 'string' && !values.length) return { handled: true, value: receiver.toUpperCase() };
      return { handled: false };
    }
    if (name === 'input' && !values.length) {
      if (inputAt >= stdin.length || (inputAt === stdin.length - 1 && stdin[inputAt] === '')) throw new Runtime('EOFError: EOF when reading a line');
      return { handled: true, value: stdin[inputAt++].replace(/\r$/, '') };
    }
    if (name === 'int' && values.length === 1 && typeof values[0] === 'string') {
      const text = values[0].trim();
      if (!/^[+-]?\d(?:_?\d)*$/.test(text)) throw new Runtime('ValueError: invalid literal for int');
      const number = Number(text.replace(/_/g, ''));
      if (!Number.isSafeInteger(number)) return { handled: false };
      return { handled: true, value: number };
    }
    if (name === 'range' && values.length >= 1 && values.length <= 3 && values.every(Number.isSafeInteger)) {
      const start = values.length === 1 ? 0 : values[0] as number;
      const stop = values.length === 1 ? values[0] as number : values[1] as number;
      const stride = values.length === 3 ? values[2] as number : 1;
      if (stride === 0) throw new Runtime('ValueError: range() arg 3 must not be zero');
      const size = Math.max(0, Math.ceil((stop - start) / stride));
      if (!Number.isFinite(size) || size > budget) throw new Exhausted();
      return { handled: true, value: Array.from({ length: size }, (_, index) => start + index * stride) };
    }
    if (name === 'list' && values.length === 1 && (Array.isArray(values[0]) || typeof values[0] === 'string' || values[0] instanceof PythonTuple)) return { handled: true, value: [...(values[0] instanceof PythonTuple ? values[0].values : values[0])] };
    if (name === 'sorted' && values.length === 1 && (Array.isArray(values[0]) || typeof values[0] === 'string')) {
      const items = [...values[0]];
      if (!items.every((v) => typeof v === 'number') && !items.every((v) => typeof v === 'string')) return { handled: false };
      return { handled: true, value: items.sort((a, b) => typeof a === 'string' && typeof b === 'string' ? comparePythonStrings(a, b) : a < b ? -1 : a > b ? 1 : 0) };
    }
    if (name === 'map' && values.length === 2 && values[0] && typeof values[0] === 'object' && 'builtin' in values[0] && Array.isArray(values[1])) {
      const fn = String(values[0].builtin);
      return { handled: true, value: values[1].map((item) => {
        const result = call(fn, [item], undefined, locals);
        if (!result.handled) throw new Unsupported('map function requires full Python');
        return result.value;
      }) };
    }
    if ((name === 'min' || name === 'max') && values.length === 1 && Array.isArray(values[0]) && values[0].length && values[0].every((x) => typeof x === 'number')) return { handled: true, value: name === 'min' ? Math.min(...values[0]) : Math.max(...values[0]) };
    if (name === 'all' && values.length === 1 && Array.isArray(values[0])) return { handled: true, value: values[0].every(truthy) };
    if (name === 'any' && values.length === 1 && Array.isArray(values[0])) return { handled: true, value: values[0].some(truthy) };
    if (name === 'round' && values.length === 1 && typeof values[0] === 'number') {
      const n = values[0]; const floor = Math.floor(n); const fraction = n - floor;
      return { handled: true, value: fraction < .5 ? floor : fraction > .5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1 };
    }
    return { handled: false };
  };

  const expression = (sourceText: string, locals: Record<string, unknown>): unknown => {
    const generator = /^(any|all)\((.+) for ([A-Za-z_]\w*) in (.+)\)$/.exec(sourceText.trim());
    if (generator) {
      const iterable = expression(generator[4], locals);
      const values = iterable instanceof PythonTuple ? iterable.values : iterable;
      if (!Array.isArray(values)) throw new Unsupported('Generator iterable requires full Python');
      for (const item of values) {
        tick();
        const value = truthy(expression(generator[2], { ...locals, [generator[3]]: item }));
        if (generator[1] === 'any' && value) return true;
        if (generator[1] === 'all' && !value) return false;
      }
      return generator[1] === 'all';
    }
    const comprehension = /^\[(.+) for ([A-Za-z_]\w*) in (.+)\]$/.exec(sourceText.trim());
    if (comprehension) {
      const iterable = expression(comprehension[3], locals);
      if (!Array.isArray(iterable)) throw new Unsupported('Comprehension iterable requires full Python');
      return iterable.map((item) => { tick(); const frame = { ...locals, [comprehension[2]]: item }; return expression(comprehension[1], frame); });
    }
    const parts = splitTop(sourceText);
    if (parts.length > 1) return parts.map((part) => expression(part, locals));
    const options: PythonExpressionOptions = {
      meter,
      invoke: (name, values, receiver) => call(name, values, receiver, locals),
      isCallableName: (name) => functions.has(name),
      shouldRethrow: (error) => error instanceof Unsupported || error instanceof Runtime || error instanceof Exhausted,
    };
    const result = evaluatePythonExpression(sourceText, scopeVars(locals), budget, options);
    if (result.kind === 'ok') return result.value;
    if (result.kind === 'step-limit') throw new Exhausted();
    if (result.kind === 'runtime-error') throw new Runtime(result.message);
    throw new Unsupported(result.message);
  };

  const assign = (targetText: string, value: unknown, locals: Record<string, unknown>): void => {
    const targets = splitTop(targetText);
    if (targets.length > 1) {
      if (!Array.isArray(value) || value.length !== targets.length) throw new Runtime('ValueError: unpacking mismatch');
      targets.forEach((targetName, index) => assign(targetName, value[index], locals));
      return;
    }
    const name = /^([A-Za-z_]\w*)$/.exec(targetText);
    if (name) { locals[name[1]] = value; return; }
    const indexed = /^(.+)\[(.+)\]$/.exec(targetText);
    if (indexed) {
      const base = expression(indexed[1], locals);
      const index = expression(indexed[2], locals);
      if (!Array.isArray(base) || !Number.isSafeInteger(index)) throw new Unsupported('Indexed assignment requires a list');
      const at = (index as number) < 0 ? base.length + (index as number) : index as number;
      if (at < 0 || at >= base.length) throw new Runtime('IndexError: list assignment index out of range');
      base[at] = value;
      return;
    }
    throw new Unsupported('Assignment target requires full Python');
  };

  const print = (callText: string, locals: Record<string, unknown>): boolean => {
    const match = /^print\((.*)\)$/.exec(callText);
    if (!match) return false;
    const entries = match[1].trim() ? splitTop(match[1]) : [];
    const values: unknown[] = [];
    let separator = ' '; let end = '\n';
    for (const entry of entries) {
      if (entry.startsWith('end=')) { const value = expression(entry.slice(4), locals); if (typeof value !== 'string') throw new Unsupported('print end requires a string'); end = value; }
      else if (entry.startsWith('sep=')) { const value = expression(entry.slice(4), locals); if (typeof value !== 'string') throw new Unsupported('print sep requires a string'); separator = value; }
      else if (entry.startsWith('*')) { const value = expression(entry.slice(1), locals); if (!Array.isArray(value)) throw new Unsupported('print unpack requires a list'); values.push(...value); }
      else values.push(expression(entry, locals));
    }
    stdout += values.map(pyString).join(separator) + end;
    if (new TextEncoder().encode(stdout).length > 100_000) throw new Exhausted();
    tick();
    return true;
  };

  const execute = (statements: Statement[], locals: Record<string, unknown>): void => {
    for (const statement of statements) {
      tick();
      switch (statement.kind) {
        case 'def': functions.set(statement.name, statement); break;
        case 'if': {
          for (const branch of statement.branches) {
            if (branch.test === null || truthy(expression(branch.test, locals))) { execute(branch.body, locals); break; }
          }
          break;
        }
        case 'for': {
          const iterable = expression(statement.iterable, locals);
          const values = typeof iterable === 'string' ? [...iterable] : iterable;
          if (!Array.isArray(values)) throw new Unsupported('For loop iterable requires full Python');
          for (const item of values) {
            tick(); assign(statement.target, item, locals);
            try { execute(statement.body, locals); }
            catch (error) { if (error instanceof BreakSignal) break; if (error instanceof ContinueSignal) continue; throw error; }
          }
          break;
        }
        case 'while':
          while (truthy(expression(statement.test, locals))) {
            tick();
            try { execute(statement.body, locals); }
            catch (error) { if (error instanceof BreakSignal) break; if (error instanceof ContinueSignal) continue; throw error; }
          }
          break;
        case 'return': throw new ReturnSignal(statement.value === null ? null : expression(statement.value, locals));
        case 'assign': {
          const value = expression(statement.value, locals);
          if (statement.op === '=') assign(statement.targets, value, locals);
          else {
            const previous = expression(statement.targets, locals);
            if (Array.isArray(previous)) {
              if (statement.op !== '+=' || !Array.isArray(value)) throw new Unsupported('Mutable augmented assignment requires full Python');
              previous.push(...value);
              assign(statement.targets, previous, locals);
              break;
            }
            const variables = { ...scopeVars(locals), __left: previous, __right: value };
            const opResult = evaluatePythonExpression(`__left ${statement.op.slice(0, -1)} __right`, variables, budget, { meter });
            if (opResult.kind !== 'ok') throw new Unsupported('Augmented assignment requires full Python');
            assign(statement.targets, opResult.value, locals);
          }
          break;
        }
        case 'expr': if (!print(statement.value, locals)) expression(statement.value, locals); break;
        case 'break': throw new BreakSignal();
        case 'continue': throw new ContinueSignal();
        case 'pass': break;
      }
    }
  };

  try {
    execute(body, globals);
    const observation: { returnValue?: JsonValue; argsAfter?: JsonValue[]; stdout: string } = { stdout };
    if (target.harness.kind === 'call') {
      const invocation = call(target.harness.function, args, undefined, globals);
      if (!invocation.handled || !asJson(invocation.value) || !asJson(args)) return undefined;
      observation.returnValue = invocation.value;
      observation.argsAfter = args;
    }
    return { kind: 'ok', observation, steps: meter.steps * STEP_SCALE };
  } catch (error) {
    if (error instanceof Runtime) return { kind: 'runtime-error', message: error.message, steps: meter.steps * STEP_SCALE };
    return undefined;
  }
}
