import type { Language, Question } from '../core/types';

type Kind = 'number' | 'boolean' | 'collection';
type Context = 'statement' | 'arguments' | 'condition' | 'expression';
type Node = { text: string; kind: Kind; precedence: number; depth: number; root?: string; values?: unknown[] };

const PRECEDENCE: Record<string, number> = {
  '||': 1, or: 1, '&&': 2, and: 2, '|': 3, '^': 4, '&': 5,
  '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7,
  '+': 8, '-': 8, '*': 9, '/': 9, '%': 9
};
const COMMUTATIVE = new Set(['+', '*', '&', '|', '^', '==', '!=']);
const MAX_POOL = 120_000;
const MAX_BUCKET = 5_000;
const MAX_PER_ROOT = 350;
const MAX_DEPTH = 5;

function variables(source: string, language: Language): { name: string; kind: Kind }[] {
  const found: { name: string; kind: Kind }[] = [];
  const add = (name: string, kind: Kind) => {
    if (!found.some(item => item.name === name)) found.push({ name, kind });
  };
  if (language === 'python') {
    for (const match of source.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)) for (const part of match[1].split(',')) {
      const name = /^\s*([A-Za-z_]\w*)/.exec(part)?.[1];
      if (name) add(name, /:\s*list\s*\[/.test(part) ? 'collection' : /:\s*bool\b/.test(part) ? 'boolean' : 'number');
    }
    for (const match of source.matchAll(/(?:^|\n)\s*([A-Za-z_]\w*)\s*(?::\s*[^=\n]+)?=(?!=)|\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) add(match[1] ?? match[2], 'number');
  } else {
    for (const match of source.matchAll(/\b(vector\s*<[^>]+>|array\s*<[^>]+>|int|long|short|double|float|bool|char)\s*(?:[&*]\s*)?([A-Za-z_]\w*)\s*(?=[,)=;\[])/g)) {
      add(match[2], /^(?:vector|array)/.test(match[1]) ? 'collection' : match[1] === 'bool' ? 'boolean' : 'number');
    }
  }
  return found.slice(0, 12);
}

function scalarHelpers(source: string, language: Language, blankId: string): { name: string; arity: number }[] {
  const markerAt = source.indexOf(`{{${blankId}}}`);
  const prefix = markerAt < 0 ? source : source.slice(0, markerAt);
  const regex = language === 'python'
    ? /\bdef\s+([A-Za-z_]\w*)\s*\(([^()]*)\)/g
    : /\b(?:int|bool|double|float|char)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)/g;
  const declarations = [...prefix.matchAll(regex)];
  const active = declarations.at(-1)?.[1];
  return declarations.filter(match => match[1] !== active && !/\b(?:vector|array|list)\b/.test(match[2]))
    .map(match => ({ name: match[1], arity: match[2].trim() ? match[2].split(',').length : 0 }))
    .filter(item => item.arity >= 1 && item.arity <= 2).slice(0, 4);
}

function pureReturnSamples(question: Question, source: string, blankId: string, names: string[]): Record<string, unknown>[] | undefined {
  if (question.grading.kind !== 'program' || !question.grading.cases.length || question.grading.cases.some(testCase => !testCase.args)) return undefined;
  // Signature pruning is only safe for sampled scalar values with exact JS representations.
  if (question.grading.cases.some(testCase => testCase.args!.some(value =>
    typeof value !== 'number' && typeof value !== 'boolean'
    || typeof value === 'number' && (!Number.isSafeInteger(value) || Math.abs(value) > 2_147_483_647)))) return undefined;
  const marker = `{{${blankId}}}`;
  if (!new RegExp(`\\breturn\\s+\\{\\{${blankId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\}`).test(source)) return undefined;
  const before = source.slice(0, source.indexOf(marker));
  const signature = /\b(?:def|int|bool|double|float|long|short)\s+\w+\s*\(([^)]*)\)/.exec(before)?.[1];
  if (!signature) return undefined;
  const parameters = signature.split(',').map(part => /([A-Za-z_]\w*)\s*(?::[^,]+)?\s*$/.exec(part.trim())?.[1]).filter((name): name is string => Boolean(name));
  if (!parameters.length || parameters.some(name => !names.includes(name))) return undefined;
  return question.grading.cases.slice(0, 8).map(testCase => Object.fromEntries(parameters.map((name, index) => [name, testCase.args?.[index]])));
}

function compute(op: string, a: unknown, b: unknown, language: Language): unknown {
  if ((typeof a !== 'number' && typeof a !== 'boolean') || (typeof b !== 'number' && typeof b !== 'boolean')) return undefined;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    if (op === '&&' || op === 'and') return Boolean(a) && Boolean(b);
    if (op === '||' || op === 'or') return Boolean(a) || Boolean(b);
    return undefined;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return undefined;
  let result: unknown;
  switch (op) {
    case '+': result = a + b; break;
    case '-': result = a - b; break;
    case '*': result = a * b; break;
    case '/': result = b === 0 ? undefined : language === 'python' ? a / b : Math.trunc(a / b); break;
    case '%': result = b === 0 ? undefined : language === 'python' ? ((a % b) + b) % b : a % b; break;
    // JS bitwise operators truncate to 32 bits; do not use them to prune C++/Python expressions.
    case '&': case '|': case '^': return undefined;
    case '==': result = a === b; break;
    case '!=': result = a !== b; break;
    case '<': result = a < b; break;
    case '<=': result = a <= b; break;
    case '>': result = a > b; break;
    case '>=': result = a >= b; break;
    case '&&': case 'and': result = Boolean(a) && Boolean(b); break;
    case '||': case 'or': result = Boolean(a) || Boolean(b); break;
  }
  return typeof result === 'number' && (!Number.isFinite(result) || !Number.isSafeInteger(result)
    || language !== 'python' && Math.abs(result) > 2_147_483_647) ? undefined : result;
}

function operand(node: Node, precedence: number, right: boolean, op: string): string {
  return node.precedence < precedence || right && node.precedence === precedence && !COMMUTATIVE.has(op)
    ? `(${node.text})` : node.text;
}

function binary(op: string, left: Node, right: Node, language: Language): Node | undefined {
  if (left.kind === 'collection' || right.kind === 'collection') return undefined;
  if (COMMUTATIVE.has(op) && left.text > right.text) [left, right] = [right, left];
  if (left.text === right.text && ['-', '/', '%', '!=', '<', '>', '<=', '>='].includes(op)) return undefined;
  if ((op === '+' || op === '-') && right.text === '0' || op === '*' && (right.text === '1' || left.text === '1')) return undefined;
  if (['/', '%'].includes(op) && right.text === '0') return undefined;
  const precedence = PRECEDENCE[op];
  const text = `${operand(left, precedence, false, op)}${op}${operand(right, precedence, true, op)}`;
  const kind: Kind = ['==', '!=', '<', '<=', '>', '>=', '&&', '||', 'and', 'or'].includes(op) ? 'boolean' : 'number';
  const values = left.values && right.values ? left.values.map((a, index) => compute(op, a, right.values![index], language)) : undefined;
  return { text, kind, precedence, depth: Math.max(left.depth, right.depth) + 1, root: op, values };
}

/** Type-directed, increasing-length grammar. The pool is finite; a separate exhaustive mode has no such cap. */
export function* generateDeepCandidates(question: Question, blankId: string, language: Language, context: Context): Generator<string> {
  if (question.grading.kind !== 'program') return;
  const target = question.grading.targets.find(item => item.language === language);
  if (!target) return;
  const maxChars = Math.min(question.blanks.find(item => item.id === blankId)?.maxChars ?? 48, 48);
  const source = target.source.replace(/\{\{[^{}]+\}\}/g, ' ');
  const vars = variables(source, language);
  const helpers = scalarHelpers(`${target.helperSource ?? ''}\n${target.source}`, language, blankId);
  const samples = pureReturnSamples(question, target.source, blankId, vars.map(item => item.name));
  const buckets: Node[][] = Array.from({ length: maxChars + 1 }, () => []);
  const bucketCounts = Array.from({ length: maxChars + 1 }, () => new Map<string, number>());
  const seen = new Set<string>();
  const signaturePool = new Set<string>();
  const pool: Node[] = [];
  const basis: Node[] = [];
  const basisCounts = new Map<string, number>();
  const base: Node[] = [];
  let queued = 0;
  const enqueue = (node: Node) => {
    const cost = node.text.length;
    const root = node.root ?? 'atom';
    if (cost < 1 || cost > maxChars || node.depth > MAX_DEPTH || seen.has(node.text)
      || queued >= MAX_POOL || buckets[cost].length >= MAX_BUCKET
      || (bucketCounts[cost].get(root) ?? 0) >= MAX_PER_ROOT) return;
    seen.add(node.text);
    buckets[cost].push(node);
    bucketCounts[cost].set(root, (bucketCounts[cost].get(root) ?? 0) + 1);
    queued++;
  };
  for (const item of vars) {
    const node: Node = { text: item.name, kind: item.kind, precedence: 100, depth: 0,
      values: samples?.map(sample => sample[item.name]) };
    base.push(node); enqueue(node);
  }
  const printed = [...new Set(source.match(/(?<![\w.])-?\d+(?![\w.])/g) ?? [])].filter(value => value.length <= 3);
  for (const value of [...printed, ...Array.from({ length: 17 }, (_, index) => String(index)), '-1', '-2', '-3', '-4']) {
    const node: Node = { text: value, kind: 'number', precedence: 100, depth: 0,
      values: samples?.map(() => Number(value)) };
    base.push(node); enqueue(node);
  }
  for (const value of language === 'python' ? ['True', 'False'] : ['true', 'false']) enqueue({ text: value, kind: 'boolean', precedence: 100, depth: 0,
    values: samples?.map(() => value === 'True' || value === 'true') });
  // Seed useful depth-three grammar productions before the broad closure. This
  // keeps modular predicates reachable even when short-expression buckets fill.
  const numericVars = base.filter(node => node.kind === 'number' && /^[A-Za-z_]\w*$/.test(node.text)).slice(0, 5);
  const zero = base.find(node => node.text === '0');
  const modulus = base.find(node => node.text === '2');
  const predicates: Node[] = [];
  if (zero && modulus) for (const variable of numericVars) {
    const remainder = binary('%', variable, modulus, language);
    if (!remainder) continue;
    for (const comparison of ['==', '!=']) {
      const predicate = binary(comparison, remainder, zero, language);
      if (predicate && predicate.text.length <= maxChars) { predicates.push(predicate); enqueue(predicate); yield predicate.text; }
    }
  }
  for (const left of predicates) for (const right of predicates) {
    if (left.text >= right.text) continue;
    for (const connective of language === 'python' ? ['and', 'or'] : ['&&', '||']) {
      const combined = binary(connective, left, right, language);
      if (combined && combined.text.length <= maxChars) { enqueue(combined); yield combined.text; }
    }
  }
  const operations = language === 'python'
    ? ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&', '|', '^', 'and', 'or']
    : ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&', '|', '^', '&&', '||'];
  const markerAt = target.source.indexOf(`{{${blankId}}}`);
  const before = markerAt < 0 ? '' : target.source.slice(0, markerAt);
  const callName = /\b([A-Za-z_]\w*)\s*\(\s*$/.exec(before)?.[1];
  for (let cost = 1; cost <= maxChars; cost++) {
    const bucket = buckets[cost];
    for (let index = 0; index < bucket.length; index++) {
      const node = bucket[index];
      if (context === 'statement') {
        for (const variable of vars.filter(item => item.kind !== 'collection').slice(0, 6)) {
          yield `${variable.name}=${node.text}`;
          yield `${variable.name}+=${node.text}`;
        }
      } else if (context === 'arguments' && callName) {
        for (const argument of base.filter(item => item.kind !== 'collection').slice(0, 12)) {
          yield `${node.text},${argument.text}`;
          yield `${argument.text},${node.text}`;
        }
      } else yield node.text;
      const signature = node.values && node.values.every(value => value !== undefined)
        ? `${node.kind}:${JSON.stringify(node.values)}` : undefined;
      if (signature && signaturePool.has(signature)) continue;
      if (signature) signaturePool.add(signature);
      pool.push(node);
      const basisKey = `${cost}:${node.root ?? 'atom'}:${node.depth}`;
      if ((basisCounts.get(basisKey) ?? 0) < 8 && basis.length < 500) {
        basis.push(node);
        basisCounts.set(basisKey, (basisCounts.get(basisKey) ?? 0) + 1);
      }
      if (node.depth >= MAX_DEPTH) continue;
      if (node.kind !== 'collection') {
        enqueue({ text: language === 'python' ? `not ${node.text}` : `!${operand(node, 10, false, '!')}`,
          kind: 'boolean', precedence: 10, depth: node.depth + 1, root: 'unary-not',
          values: node.values?.map(value => !value) });
        if (node.kind === 'number') enqueue({ text: `-${operand(node, 10, false, '-')}`,
          kind: 'number', precedence: 10, depth: node.depth + 1, root: 'unary-minus',
          values: node.values?.map(value => typeof value === 'number' ? -value : undefined) });
        for (const array of vars.filter(item => item.kind === 'collection').slice(0, 3)) {
          enqueue({ text: `${array.name}[${node.text}]`, kind: 'number', precedence: 100, depth: node.depth + 1, root: 'index',
            values: samples?.map((sample, sampleIndex) => {
              const values = sample[array.name];
              const at = node.values?.[sampleIndex];
              return Array.isArray(values) && typeof at === 'number' && Number.isInteger(at) ? values.at(at) : undefined;
            }) });
        }
        for (const helper of helpers) {
          if (helper.arity === 1) enqueue({ text: `${helper.name}(${node.text})`, kind: 'number', precedence: 100,
            depth: node.depth + 1, root: 'call' });
          if (helper.arity === 2) for (const argument of base.filter(item => item.kind === 'number').slice(0, 12)) {
            enqueue({ text: `${helper.name}(${node.text},${argument.text})`, kind: 'number', precedence: 100,
              depth: node.depth + 1, root: 'call' });
            enqueue({ text: `${helper.name}(${argument.text},${node.text})`, kind: 'number', precedence: 100,
              depth: node.depth + 1, root: 'call' });
          }
        }
      }
      const partners = [...base.slice(0, 18), ...basis.slice(0, 180)];
      for (const other of partners) for (const op of operations) {
        const first = binary(op, node, other, language);
        if (first) enqueue(first);
        if (!COMMUTATIVE.has(op)) {
          const second = binary(op, other, node, language);
          if (second) enqueue(second);
        }
      }
      if (queued >= MAX_POOL && cost >= 4) return;
    }
  }
}
