import type { EngineResult, JsonValue, ProgramCase, ProgramTarget } from '../../core/types';
import { PROBE_PREFIX, type ProbeHandler, type ProbeValue } from '../../core/probe';
import { comparePythonStrings, evaluatePythonExpression, PythonDict, PythonSet, PythonTuple, supportsPythonExpressionSyntax, type PythonExpressionOptions } from './expression';

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

function hasTopLevelFor(text: string): boolean {
  let quote: string | null = null; let escaped = false; let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && quote) { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth--; continue; }
    if (depth === 0 && text.startsWith(' for ', i)) return true;
  }
  return false;
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
    const listLiteral = /^\[([^\[\]]*)\]$/.exec(trimmed);
    if (listLiteral && !hasTopLevelFor(listLiteral[1])) return !listLiteral[1].trim() || splitTop(listLiteral[1]).every(validExpression);
    const generator = /^(any|all|sum|min|max)\((.+) for ([A-Za-z_]\w*) in (.+?)(?: if (.+))?\)$/.exec(trimmed);
    if (generator) return validExpression(generator[2]) && validExpression(generator[4]) && (!generator[5] || validExpression(generator[5]));
    const comprehension = /^\[(.+) for ([A-Za-z_]\w*) in (.+?)(?: if (.+))?\]$/.exec(trimmed);
    if (comprehension) return validExpression(comprehension[1]) && validExpression(comprehension[3]) && (!comprehension[4] || validExpression(comprehension[4]));
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
  if (value instanceof PythonDict || value instanceof PythonSet) return value.entries.size > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function asJson(value: unknown): value is JsonValue {
  if (value instanceof PythonTuple) return false;
  if (value instanceof PythonDict || value instanceof PythonSet) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(asJson);
  if (value && typeof value === 'object' && !('builtin' in value)) return Object.values(value).every(asJson);
  return false;
}

function normalizeTuple(value: unknown): unknown {
  if (value instanceof PythonTuple) return value.values.map(normalizeTuple);
  if (value instanceof PythonSet) return value;
  if (value instanceof PythonDict) {
    const entries = value.keys().map((key) => {
      if (key instanceof PythonTuple) throw new Unsupported('JSON cannot encode tuple dictionary keys');
      const label = key === null ? 'null' : key === true ? 'true' : key === false ? 'false' : String(key);
      return [label, normalizeTuple(value.get(key).value)] as const;
    });
    return Object.fromEntries(entries);
  }
  if (Array.isArray(value)) return value.map(normalizeTuple);
  if (value && typeof value === 'object' && !('builtin' in value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeTuple(item)]));
  return value;
}

function pythonize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pythonize);
  if (value && typeof value === 'object') {
    const result = new PythonDict();
    for (const [key, item] of Object.entries(value)) result.set(key, pythonize(item));
    return result;
  }
  return value;
}

/** Synchronous, conservative paper runner; undefined means Pyodide must decide. */
export function tryRunPythonProgram(source: string, target: ProgramTarget, testCase: ProgramCase,
  probe?: ProbeHandler): EngineResult | undefined {
  if (target.language !== 'python') return undefined;
  let body: Statement[];
  try { body = new Parser(logicalLines(source)).parse(); }
  catch { return undefined; }
  const globals: Record<string, unknown> = Object.create(null);
  const functions = new Map<string, Extract<Statement, { kind: 'def' }>>();
  const args = pythonize(structuredClone(testCase.args ?? [])) as unknown[];
  const meter = { steps: 0 };
  const budget = Math.max(1, Math.floor(testCase.maxSteps / STEP_SCALE));
  const stdin = (testCase.stdin ?? '').split('\n');
  let inputAt = 0; let stdout = '';
  const tick = () => { if (++meter.steps > budget) throw new Exhausted(); };
  const scopeVars = (locals: Record<string, unknown>) => ({ ...globals, ...locals });
  const probeVariables = (locals: Record<string, unknown>): Record<string, ProbeValue> => {
    const variables: Record<string, ProbeValue> = Object.create(null);
    for (const [name, value] of Object.entries(scopeVars(locals))) {
      if (value === null || typeof value === 'boolean' || typeof value === 'string'
        || typeof value === 'number' && Number.isFinite(value)) variables[name] = value;
      else if (Array.isArray(value) && value.length <= 256) variables[name] = value.map(item =>
        item === null || typeof item === 'boolean' || typeof item === 'string'
        || typeof item === 'number' && Number.isFinite(item) ? item : undefined);
    }
    return variables;
  };
  const pyString = (value: unknown): string => {
    if (value !== null && typeof value === 'object') throw new Unsupported('Printing containers requires full Python');
    return value === null ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value);
  };
  const sequence = (value: unknown): unknown[] | null => {
    if (Array.isArray(value)) return value;
    if (value instanceof PythonTuple) return value.values;
    if (typeof value === 'string') return [...value];
    if (value instanceof PythonDict) return value.keys();
    return null;
  };
  const ordered = (values: unknown[], key: unknown = null): unknown[] | null => {
    if (key !== null && typeof key !== 'function') return null;
    const decorated = values.map((item) => ({ item, key: key === null ? item : key(item) }));
    if (!decorated.every((v) => typeof v.key === 'number') && !decorated.every((v) => typeof v.key === 'string')) return null;
    decorated.sort((a, b) => typeof a.key === 'string' && typeof b.key === 'string' ? comparePythonStrings(a.key, b.key) : (a.key as number) - (b.key as number));
    values.splice(0, values.length, ...decorated.map((entry) => entry.item));
    return values;
  };

  const call = (name: string, values: unknown[], receiver: unknown, locals: Record<string, unknown>, kwargs: Record<string, unknown> = {}): { handled: true; value: unknown } | { handled: false } => {
    tick();
    if (probe && receiver === undefined && name.startsWith(PROBE_PREFIX) && values.length === 0 && Object.keys(kwargs).length === 0)
      return { handled: true, value: probe({ blankId: name.slice(PROBE_PREFIX.length), variables: probeVariables(locals) }) };
    const keywords = Object.keys(kwargs);
    const user = functions.get(name);
    if (receiver === undefined && user) {
      if (values.length + keywords.length !== user.params.length || values.length > user.params.length || keywords.some((key) => !user.params.includes(key) || user.params.indexOf(key) < values.length)) throw new Runtime('TypeError: wrong number of arguments');
      const frame: Record<string, unknown> = Object.create(null);
      user.params.forEach((param, index) => { frame[param] = values[index]; });
      for (const keyword of keywords) frame[keyword] = kwargs[keyword];
      try { execute(user.body, frame); return { handled: true, value: null }; }
      catch (error) { if (error instanceof ReturnSignal) return { handled: true, value: error.value }; throw error; }
    }
    if (keywords.length && !['sort', 'sorted', 'min', 'max'].includes(name)) return { handled: false };
    const keyFunction = (): ((item: unknown) => unknown) | null | undefined => {
      const key = kwargs.key;
      if (key === undefined || key === null) return null;
      if (typeof key === 'function') return key as (item: unknown) => unknown;
      if (key && typeof key === 'object' && 'builtin' in key) return (item) => {
        const result = call(String(key.builtin), [item], undefined, locals);
        if (!result.handled) throw new Unsupported('Key function requires full Python');
        return result.value;
      };
      return undefined;
    };
    if (receiver !== undefined) {
      if (name === 'split' && typeof receiver === 'string' && values.length <= 1) {
        if (!values.length) return { handled: true, value: receiver.trim() ? receiver.trim().split(/\s+/u) : [] };
        if (typeof values[0] === 'string' && values[0] !== '') return { handled: true, value: receiver.split(values[0]) };
      }
      if (name === 'sort' && Array.isArray(receiver) && !values.length && keywords.every((key) => key === 'reverse' || key === 'key') && (keywords.includes('reverse') === false || typeof kwargs.reverse === 'boolean')) {
        const key = keyFunction(); if (key === undefined || !ordered(receiver, key)) return { handled: false };
        if (kwargs.reverse) receiver.reverse();
        return { handled: true, value: null };
      }
      if (name === 'append' && Array.isArray(receiver) && values.length === 1) { receiver.push(values[0]); return { handled: true, value: null }; }
      if (name === 'insert' && Array.isArray(receiver) && values.length === 2 && Number.isSafeInteger(values[0])) {
        const index = values[0] as number;
        receiver.splice(Math.max(0, Math.min(receiver.length, index < 0 ? receiver.length + index : index)), 0, values[1]);
        return { handled: true, value: null };
      }
      if (receiver instanceof PythonDict) {
        if (name === 'get' && values.length >= 1 && values.length <= 2) { const result = receiver.get(values[0]); return { handled: true, value: result.found ? result.value : values.length === 2 ? values[1] : null }; }
        if (name === 'keys' && !values.length) return { handled: true, value: receiver.keys() };
        if (name === 'values' && !values.length) return { handled: true, value: receiver.values() };
        if (name === 'items' && !values.length) return { handled: true, value: receiver.keys().map((key) => new PythonTuple([key, receiver.get(key).value])) };
        if (name === 'copy' && !values.length) { const copy = new PythonDict(); receiver.keys().forEach((key) => copy.set(key, receiver.get(key).value)); return { handled: true, value: copy }; }
      }
      if (receiver instanceof PythonSet) {
        if (name === 'add' && values.length === 1) { if (!receiver.add(values[0])) return { handled: false }; return { handled: true, value: null }; }
      }
      if (name === 'extend' && Array.isArray(receiver) && values.length === 1) {
        const items = sequence(values[0]); if (!items) return { handled: false };
        receiver.push(...items); return { handled: true, value: null };
      }
      if (name === 'reverse' && Array.isArray(receiver) && !values.length) { receiver.reverse(); return { handled: true, value: null }; }
      if (name === 'copy' && Array.isArray(receiver) && !values.length) return { handled: true, value: [...receiver] };
      if (name === 'clear' && Array.isArray(receiver) && !values.length) { receiver.length = 0; return { handled: true, value: null }; }
      if (name === 'count' && values.length === 1 && (Array.isArray(receiver) || receiver instanceof PythonTuple)) {
        const items = sequence(receiver)!;
        return { handled: true, value: items.filter((item) => {
          const result = evaluatePythonExpression('a == b', { a: item, b: values[0] }, budget, { meter });
          if (result.kind !== 'ok') throw new Unsupported('List count comparison requires full Python');
          return result.value;
        }).length };
      }
      if ((name === 'index' || name === 'remove') && (Array.isArray(receiver) || (name === 'index' && receiver instanceof PythonTuple)) && values.length >= 1 && values.length <= (name === 'index' ? 3 : 1)) {
        const items = sequence(receiver)!;
        if (values.slice(1).some((value) => !Number.isSafeInteger(value))) return { handled: false };
        const bound = (value: number) => Math.max(0, Math.min(items.length, value < 0 ? items.length + value : value));
        const start = values.length >= 2 ? bound(values[1] as number) : 0;
        const stop = values.length >= 3 ? bound(values[2] as number) : items.length;
        for (let index = start; index < stop; index++) {
          const result = evaluatePythonExpression('a == b', { a: items[index], b: values[0] }, budget, { meter });
          if (result.kind !== 'ok') return { handled: false };
          if (result.value) {
            if (name === 'index') return { handled: true, value: index };
            if (Array.isArray(receiver)) { receiver.splice(index, 1); return { handled: true, value: null }; }
          }
        }
        throw new Runtime(name === 'index' ? 'ValueError: value is not in sequence' : 'ValueError: list.remove(x): x not in list');
      }
      if (name === 'count' && typeof receiver === 'string' && values.length === 1 && typeof values[0] === 'string') {
        if (values[0] === '') return { handled: true, value: [...receiver].length + 1 };
        return { handled: true, value: receiver.split(values[0]).length - 1 };
      }
      if (['find', 'rfind', 'index', 'rindex'].includes(name) && typeof receiver === 'string' && values.length >= 1 && values.length <= 3 && typeof values[0] === 'string') {
        if (values.slice(1).some((value) => !Number.isSafeInteger(value))) return { handled: false };
        const letters = [...receiver]; const needle = [...values[0]];
        const bound = (value: number) => Math.max(0, Math.min(letters.length, value < 0 ? letters.length + value : value));
        const start = values.length >= 2 ? bound(values[1] as number) : 0;
        const stop = values.length >= 3 ? bound(values[2] as number) : letters.length;
        let found = -1;
        const emptyNeedleBeyondEnd = needle.length === 0 && values.length >= 2 && (values[1] as number) > letters.length;
        for (let index = start; !emptyNeedleBeyondEnd && index <= stop - needle.length; index++) {
          if (needle.every((letter, offset) => letter === letters[index + offset])) {
            found = index;
            if (name === 'find' || name === 'index') break;
          }
        }
        if (found < 0 && (name === 'index' || name === 'rindex')) throw new Runtime('ValueError: substring not found');
        return { handled: true, value: found };
      }
      if (name === 'pop' && Array.isArray(receiver) && values.length <= 1) {
        const index = values.length ? values[0] : -1;
        if (!Number.isSafeInteger(index) || !receiver.length) throw new Runtime('IndexError: pop index out of range');
        const at = (index as number) < 0 ? receiver.length + (index as number) : index as number;
        if (at < 0 || at >= receiver.length) throw new Runtime('IndexError: pop index out of range');
        return { handled: true, value: receiver.splice(at, 1)[0] };
      }
      if (name === 'lower' && typeof receiver === 'string' && !values.length) return { handled: true, value: receiver.toLowerCase() };
      if (name === 'upper' && typeof receiver === 'string' && !values.length) return { handled: true, value: receiver.toUpperCase() };
      if (name === 'strip' && typeof receiver === 'string' && values.length <= 1) {
        if (!values.length) return { handled: true, value: receiver.trim() };
        if (typeof values[0] !== 'string') return { handled: false };
        const chars = new Set(values[0]); const letters = [...receiver];
        while (letters.length && chars.has(letters[0])) letters.shift();
        while (letters.length && chars.has(letters[letters.length - 1])) letters.pop();
        return { handled: true, value: letters.join('') };
      }
      if (name === 'join' && typeof receiver === 'string' && values.length === 1) {
        const items = sequence(values[0]);
        if (!items || !items.every((item) => typeof item === 'string')) return { handled: false };
        return { handled: true, value: items.join(receiver) };
      }
      if ((name === 'startswith' || name === 'endswith') && typeof receiver === 'string' && values.length === 1 && typeof values[0] === 'string')
        return { handled: true, value: name === 'startswith' ? receiver.startsWith(values[0]) : receiver.endsWith(values[0]) };
      if (name === 'replace' && typeof receiver === 'string' && values.length >= 2 && values.length <= 3 && typeof values[0] === 'string' && typeof values[1] === 'string') {
        const limit = values.length === 3 ? values[2] : Infinity;
        if (limit !== Infinity && !Number.isSafeInteger(limit)) return { handled: false };
        const count = (limit as number) < 0 ? Infinity : limit as number;
        if (values[0] === '') {
          const letters = [...receiver]; let result = ''; let used = 0;
          for (let i = 0; i <= letters.length; i++) { if (used < count) { result += values[1]; used++; } if (i < letters.length) result += letters[i]; }
          return { handled: true, value: result };
        }
        let result = receiver; let at = 0; let used = 0;
        while (used < count) { const found = result.indexOf(values[0], at); if (found < 0) break; result = result.slice(0, found) + values[1] + result.slice(found + values[0].length); at = found + values[1].length; used++; }
        return { handled: true, value: result };
      }
      return { handled: false };
    }
    if (name === 'input' && !values.length) {
      if (inputAt >= stdin.length || (inputAt === stdin.length - 1 && stdin[inputAt] === '')) throw new Runtime('EOFError: EOF when reading a line');
      return { handled: true, value: stdin[inputAt++].replace(/\r$/, '') };
    }
    if (name === 'abs' && values.length === 1 && typeof values[0] === 'number') return { handled: true, value: Math.abs(values[0]) };
    if (name === 'int' && !values.length) return { handled: true, value: 0 };
    if (name === 'float' && !values.length) return { handled: true, value: 0 };
    if (name === 'bool' && !values.length) return { handled: true, value: false };
    if (name === 'str' && !values.length) return { handled: true, value: '' };
    if (name === 'len' && values.length === 1) {
      if (values[0] instanceof PythonSet) return { handled: true, value: values[0].entries.size };
      const items = sequence(values[0]); if (items) return { handled: true, value: items.length };
    }
    if (name === 'int' && values.length >= 1 && values.length <= 2 && typeof values[0] === 'string') {
      const text = values[0].trim();
      const requestedBase = values.length === 2 ? values[1] : 10;
      if (!Number.isSafeInteger(requestedBase)) return { handled: false };
      if (requestedBase !== 0 && ((requestedBase as number) < 2 || (requestedBase as number) > 36)) throw new Runtime('ValueError: int() base must be >= 2 and <= 36, or 0');
      const sign = text.startsWith('-') ? -1n : 1n;
      let digits = /^[+-]/.test(text) ? text.slice(1) : text;
      let base = requestedBase as number;
      const prefix = /^0([box])/i.exec(digits);
      const prefixBase = prefix ? { b: 2, o: 8, x: 16 }[prefix[1].toLowerCase() as 'b' | 'o' | 'x'] : undefined;
      if (base === 0) base = prefixBase ?? 10;
      if (prefixBase === base) digits = digits.slice(2).replace(/^_/, '');
      if (!/^[0-9a-z](?:_?[0-9a-z])*$/.test(digits.toLowerCase())) throw new Runtime('ValueError: invalid literal for int');
      if (requestedBase === 0 && !prefixBase && /^0[0-9_]*[1-9]/.test(digits)) throw new Runtime('ValueError: invalid literal for int');
      let number = 0n;
      for (const digit of digits.toLowerCase().replace(/_/g, '')) {
        tick();
        const value = parseInt(digit, 36);
        if (value >= base) throw new Runtime('ValueError: invalid literal for int');
        number = number * BigInt(base) + BigInt(value);
      }
      number *= sign;
      if (!Number.isSafeInteger(Number(number))) return { handled: false };
      return { handled: true, value: Number(number) };
    }
    if (name === 'range' && values.length >= 1 && values.length <= 3 && values.every(Number.isSafeInteger)) {
      const start = values.length === 1 ? 0 : values[0] as number;
      const stop = values.length === 1 ? values[0] as number : values[1] as number;
      const stride = values.length === 3 ? values[2] as number : 1;
      if (stride === 0) throw new Runtime('ValueError: range() arg 3 must not be zero');
      const size = Math.max(0, Math.ceil((stop - start) / stride));
      if (!Number.isFinite(size) || size > budget) throw new Exhausted();
      if (size && !Number.isSafeInteger(start + (size - 1) * stride)) return { handled: false };
      return { handled: true, value: Array.from({ length: size }, (_, index) => start + index * stride) };
    }
    if (name === 'list' && !values.length) return { handled: true, value: [] };
    if (name === 'list' && values.length === 1) { const items = sequence(values[0]); if (items) return { handled: true, value: [...items] }; }
    if (name === 'tuple' && !values.length) return { handled: true, value: new PythonTuple([]) };
    if (name === 'tuple' && values.length === 1) { const items = sequence(values[0]); if (items) return { handled: true, value: new PythonTuple([...items]) }; }
    if (name === 'dict' && !values.length) return { handled: true, value: new PythonDict() };
    if (name === 'dict' && values.length === 1) {
      const dictionary = values[0];
      if (dictionary instanceof PythonDict) { const copy = new PythonDict(); dictionary.keys().forEach((key) => copy.set(key, dictionary.get(key).value)); return { handled: true, value: copy }; }
      const pairs = sequence(values[0]);
      if (pairs) {
        const result = new PythonDict();
        for (const pair of pairs) { const entry = sequence(pair); if (!entry || entry.length !== 2 || !result.set(entry[0], entry[1])) return { handled: false }; }
        return { handled: true, value: result };
      }
    }
    if (name === 'set' && !values.length) return { handled: true, value: new PythonSet() };
    if (name === 'set' && values.length === 1) {
      const items = values[0] instanceof PythonSet ? values[0].values() : sequence(values[0]);
      if (items) { const result = new PythonSet(); for (const item of items) if (!result.add(item)) return { handled: false }; return { handled: true, value: result }; }
    }
    if (name === 'sorted' && values.length === 1 && keywords.every((key) => key === 'reverse' || key === 'key') && (keywords.includes('reverse') === false || typeof kwargs.reverse === 'boolean')) {
      const items = values[0] instanceof PythonSet ? values[0].values() : sequence(values[0]); const key = keyFunction();
      if (items && key !== undefined) { const result = ordered([...items], key); if (result) return { handled: true, value: kwargs.reverse ? result.reverse() : result }; }
    }
    if (name === 'reversed' && values.length === 1) { const items = sequence(values[0]); if (items) return { handled: true, value: [...items].reverse() }; }
    if (name === 'enumerate' && values.length >= 1 && values.length <= 2) {
      const items = sequence(values[0]); const start = values.length === 2 ? values[1] : 0;
      if (items && Number.isSafeInteger(start) && Number.isSafeInteger((start as number) + items.length)) return { handled: true, value: items.map((item, index) => new PythonTuple([(start as number) + index, item])) };
    }
    if (name === 'zip' && values.length <= 4) {
      const items = values.map(sequence);
      if (items.every((item): item is unknown[] => item !== null)) return { handled: true, value: Array.from({ length: items.length ? Math.min(...items.map((item) => item.length)) : 0 }, (_, index) => new PythonTuple(items.map((item) => item[index]))) };
    }
    if (name === 'map' && values.length === 2 && values[0] && typeof values[0] === 'object' && 'builtin' in values[0] && Array.isArray(values[1])) {
      const fn = String(values[0].builtin);
      return { handled: true, value: values[1].map((item) => {
        const result = call(fn, [item], undefined, locals);
        if (!result.handled) throw new Unsupported('map function requires full Python');
        return result.value;
      }) };
    }
    if (name === 'map' && values.length === 2 && typeof values[0] === 'function') {
      const items = sequence(values[1]); if (items) return { handled: true, value: items.map((item) => { tick(); return (values[0] as (value: unknown) => unknown)(item); }) };
    }
    if (name === 'filter' && values.length === 2 && (values[0] === null || typeof values[0] === 'function')) {
      const items = sequence(values[1]);
      if (items) return { handled: true, value: items.filter((item) => { tick(); return truthy(values[0] === null ? item : (values[0] as (value: unknown) => unknown)(item)); }) };
    }
    if ((name === 'min' || name === 'max') && values.length >= 1 && keywords.every((key) => key === 'key' || key === 'default')) {
      const items = values.length === 1 ? (values[0] instanceof PythonSet ? values[0].values() : sequence(values[0])) : values;
      const key = keyFunction();
      if (items && key !== undefined) {
        if (keywords.includes('default') && values.length !== 1) return { handled: false };
        if (!items.length) {
          if (keywords.includes('default')) return { handled: true, value: kwargs.default };
          throw new Runtime(`ValueError: ${name}() arg is an empty sequence`);
        }
        let best = items[0]; let bestKey = key === null ? best : key(best);
        for (let index = 1; index < items.length; index++) {
          const item = items[index]; const itemKey = key === null ? item : key(item);
          const numeric = (value: unknown): value is number | boolean => typeof value === 'number' || typeof value === 'boolean';
          let comparison: number;
          if (numeric(bestKey) && numeric(itemKey)) comparison = Number(itemKey) - Number(bestKey);
          else if (typeof bestKey === 'string' && typeof itemKey === 'string') comparison = comparePythonStrings(itemKey, bestKey);
          else return { handled: false };
          if ((name === 'min' && comparison < 0) || (name === 'max' && comparison > 0)) { best = item; bestKey = itemKey; }
        }
        return { handled: true, value: best };
      }
    }
    if (name === 'sum' && values.length >= 1 && values.length <= 2) {
      const items = sequence(values[0]); const start = values.length === 2 ? values[1] : 0;
      if (items && typeof start === 'number' && items.every((item) => typeof item === 'number')) {
        let result = start;
        for (const item of items) {
          result += item as number;
          if (!Number.isFinite(result) || (Number.isInteger(result) && !Number.isSafeInteger(result))) return { handled: false };
        }
        return { handled: true, value: result };
      }
    }
    if (name === 'str' && values.length === 1 && (values[0] === null || ['string', 'number', 'boolean'].includes(typeof values[0]))) return { handled: true, value: pyString(values[0]) };
    if (name === 'float' && values.length === 1) {
      if (typeof values[0] === 'number' || typeof values[0] === 'boolean') return { handled: true, value: Number(values[0]) };
      if (typeof values[0] === 'string') {
        const text = values[0].trim();
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Runtime('ValueError: could not convert string to float');
        const result = Number(text); if (Number.isFinite(result)) return { handled: true, value: result };
      }
    }
    if (name === 'chr' && values.length === 1 && Number.isSafeInteger(values[0])) {
      const codepoint = values[0] as number;
      if (codepoint < 0 || codepoint > 0x10ffff) throw new Runtime('ValueError: chr() arg not in range');
      return { handled: true, value: String.fromCodePoint(codepoint) };
    }
    if (name === 'ord' && values.length === 1 && typeof values[0] === 'string') {
      const letters = [...values[0]]; if (letters.length !== 1) throw new Runtime('TypeError: ord() expected a character');
      return { handled: true, value: letters[0].codePointAt(0)! };
    }
    if (name === 'pow' && values.length >= 2 && values.length <= 3 && values.every((item) => typeof item === 'number')) {
      const [base, exponent, modulus] = values as number[];
      if (values.length === 2) { const result = base ** exponent; if (Number.isFinite(result) && (!Number.isInteger(result) || Number.isSafeInteger(result))) return { handled: true, value: result }; }
      else if ([base, exponent, modulus].every(Number.isSafeInteger) && exponent >= 0 && modulus !== 0) {
        let x = BigInt(base); let n = BigInt(exponent); const m = BigInt(modulus); let result = 1n;
        while (n > 0n) { tick(); if (n & 1n) result = result * x % m; x = x * x % m; n >>= 1n; }
        const normalized = (result % m + m) % m;
        if (Number.isSafeInteger(Number(normalized))) return { handled: true, value: Number(normalized) };
      }
    }
    if (name === 'divmod' && values.length === 2 && values.every(Number.isSafeInteger)) {
      const a = BigInt(values[0] as number); const b = BigInt(values[1] as number);
      if (b === 0n) throw new Runtime('ZeroDivisionError: integer division or modulo by zero');
      let q = a / b; if (a % b !== 0n && (a < 0n) !== (b < 0n)) q--;
      const r = a - q * b;
      if (Number.isSafeInteger(Number(q)) && Number.isSafeInteger(Number(r))) return { handled: true, value: new PythonTuple([Number(q), Number(r)]) };
    }
    if (['bin', 'oct', 'hex'].includes(name) && values.length === 1 && Number.isSafeInteger(values[0])) {
      const number = BigInt(values[0] as number); const prefix = name === 'bin' ? '0b' : name === 'oct' ? '0o' : '0x'; const radix = name === 'bin' ? 2 : name === 'oct' ? 8 : 16;
      return { handled: true, value: `${number < 0n ? '-' : ''}${prefix}${(number < 0n ? -number : number).toString(radix)}` };
    }
    if (name === 'all' && values.length === 1) { const items = sequence(values[0]); if (items) return { handled: true, value: items.every(truthy) }; }
    if (name === 'any' && values.length === 1) { const items = sequence(values[0]); if (items) return { handled: true, value: items.some(truthy) }; }
    if (name === 'round' && values.length === 1 && typeof values[0] === 'number') {
      const n = values[0]; const floor = Math.floor(n); const fraction = n - floor;
      return { handled: true, value: fraction < .5 ? floor : fraction > .5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1 };
    }
    return { handled: false };
  };

  const expression = (sourceText: string, locals: Record<string, unknown>): unknown => {
    const listLiteral = /^\[([^\[\]]*)\]$/.exec(sourceText.trim());
    if (listLiteral && !hasTopLevelFor(listLiteral[1])) return listLiteral[1].trim() ? splitTop(listLiteral[1]).map((part) => expression(part, locals)) : [];
    const generator = /^(any|all|sum|min|max)\((.+) for ([A-Za-z_]\w*) in (.+?)(?: if (.+))?\)$/.exec(sourceText.trim());
    if (generator) {
      const iterable = expression(generator[4], locals);
      const values = sequence(iterable);
      if (!values) throw new Unsupported('Generator iterable requires full Python');
      const produced: unknown[] = [];
      for (const item of values) {
        tick();
        const frame = { ...locals, [generator[3]]: item };
        if (generator[5] && !truthy(expression(generator[5], frame))) continue;
        const evaluated = expression(generator[2], frame);
        if (generator[1] === 'sum' || generator[1] === 'min' || generator[1] === 'max') { produced.push(evaluated); continue; }
        const value = truthy(evaluated);
        if (generator[1] === 'any' && value) return true;
        if (generator[1] === 'all' && !value) return false;
      }
      if (generator[1] === 'sum') {
        let total = 0;
        for (const value of produced) {
          if (typeof value !== 'number') throw new Unsupported('Generator sum requires numbers');
          total += value;
          if (!Number.isFinite(total) || (Number.isInteger(total) && !Number.isSafeInteger(total))) throw new Unsupported('Generator sum outside exact range');
        }
        return total;
      }
      if (generator[1] === 'min' || generator[1] === 'max') {
        if (!produced.length) throw new Runtime(`ValueError: ${generator[1]}() arg is an empty sequence`);
        const result = ordered(produced);
        if (!result) throw new Unsupported('Generator ordering requires matching scalars');
        return generator[1] === 'min' ? result[0] : result[result.length - 1];
      }
      return generator[1] === 'all';
    }
    const comprehension = /^\[(.+) for ([A-Za-z_]\w*) in (.+?)(?: if (.+))?\]$/.exec(sourceText.trim());
    if (comprehension) {
      const iterable = expression(comprehension[3], locals);
      const values = sequence(iterable);
      if (!values) throw new Unsupported('Comprehension iterable requires full Python');
      const result: unknown[] = [];
      for (const item of values) {
        tick(); const frame = { ...locals, [comprehension[2]]: item };
        if (!comprehension[4] || truthy(expression(comprehension[4], frame))) result.push(expression(comprehension[1], frame));
      }
      return result;
    }
    const parts = splitTop(sourceText);
    if (parts.length > 1) return parts.map((part) => expression(part, locals));
    const options: PythonExpressionOptions = {
      meter,
      invoke: (name, values, receiver, kwargs) => call(name, values, receiver, locals, kwargs),
      isCallableName: (name) => functions.has(name) || Boolean(probe && name.startsWith(PROBE_PREFIX)),
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
      const items = sequence(value);
      if (!items || items.length !== targets.length) throw new Runtime('ValueError: unpacking mismatch');
      targets.forEach((targetName, index) => assign(targetName, items[index], locals));
      return;
    }
    const name = /^([A-Za-z_]\w*)$/.exec(targetText);
    if (name) { locals[name[1]] = value; return; }
    const indexed = /^(.+)\[(.+)\]$/.exec(targetText);
    if (indexed) {
      const base = expression(indexed[1], locals);
      const index = expression(indexed[2], locals);
      if (base instanceof PythonDict) {
        if (!base.set(index, value)) throw new Unsupported('Dictionary assignment key requires a hashable scalar or tuple');
        return;
      }
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
          const values = sequence(iterable);
          if (!values) throw new Unsupported('For loop iterable requires full Python');
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
      if (!invocation.handled) return undefined;
      const returned = normalizeTuple(invocation.value);
      const argsAfter = normalizeTuple(args);
      if (!asJson(returned) || !asJson(argsAfter)) return undefined;
      observation.returnValue = returned;
      observation.argsAfter = argsAfter as JsonValue[];
    }
    return { kind: 'ok', observation, steps: meter.steps * STEP_SCALE };
  } catch (error) {
    if (error instanceof Runtime) return { kind: 'runtime-error', message: error.message, steps: meter.steps * STEP_SCALE };
    return undefined;
  }
}
