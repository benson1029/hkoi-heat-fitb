import type { RecordSortComparatorGrading } from './types';

type Values = [number, number, number, number];
type Expr = { kind: 'value'; slot: number } | { kind: 'number'; value: number } |
  { kind: 'unary'; op: '!' | '-' | '+'; child: Expr } |
  { kind: 'binary'; op: string; left: Expr; right: Expr };

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function checkRecordSortComparator(spec: RecordSortComparatorGrading, answer: string): string | null {
  if (answer.length > 500) return 'The condition is too long.';
  let source = answer.trim().replace(/;$/, '');
  const array = escapeRegex(spec.arrayName), index = escapeRegex(spec.indexName);
  for (let field = 0; field < 2; field++) {
    const name = escapeRegex(spec.fields[field]);
    for (const [offset, side] of [['\\s*\\+\\s*1', 'R'], ['', 'L']] as const) {
      const pattern = new RegExp(`${array}\\s*\\[\\s*${index}${offset}\\s*\\]\\s*\\.\\s*${name}\\b`, 'g');
      source = source.replace(pattern, `${side}${field}`);
    }
  }
  const compact = source.replace(/\s+/g, '');
  const tokens = compact.match(/L[01]|R[01]|\d+|&&|\|\||==|!=|<=|>=|[()+\-!<>]/g) ?? [];
  if (tokens.join('') !== compact || tokens.length > 200) return 'Use a C condition comparing the printed record fields.';
  let at = 0, depth = 0;
  function primary(): Expr {
    if (++depth > 30) throw new Error('Condition is too deeply nested.');
    const token = tokens[at++];
    let node: Expr;
    if (/^[LR][01]$/.test(token ?? '')) node = { kind: 'value', slot: ({ L0: 0, L1: 1, R0: 2, R1: 3 } as Record<string, number>)[token] };
    else if (/^\d+$/.test(token ?? '')) node = { kind: 'number', value: Number(token) };
    else if (token === '(') {
      node = or();
      if (tokens[at++] !== ')') throw new Error('Missing closing parenthesis.');
    } else throw new Error('Expected a field or parenthesized condition.');
    depth--;
    return node;
  }
  function unary(): Expr {
    const op = tokens[at];
    if (op === '!' || op === '-' || op === '+') { at++; return { kind: 'unary', op, child: unary() }; }
    return primary();
  }
  function additive(): Expr {
    let node = unary();
    while (tokens[at] === '+' || tokens[at] === '-') {
      const op = tokens[at++]; node = { kind: 'binary', op, left: node, right: unary() };
    }
    return node;
  }
  function compare(): Expr {
    let node = additive();
    const op = tokens[at];
    if (['<', '>', '<=', '>=', '==', '!='].includes(op)) { at++; node = { kind: 'binary', op, left: node, right: additive() }; }
    return node;
  }
  function and(): Expr {
    let node = compare();
    while (tokens[at] === '&&') { at++; node = { kind: 'binary', op: '&&', left: node, right: compare() }; }
    return node;
  }
  function or(): Expr {
    let node = and();
    while (tokens[at] === '||') { at++; node = { kind: 'binary', op: '||', left: node, right: and() }; }
    return node;
  }
  let tree: Expr;
  try { tree = or(); if (at !== tokens.length) throw new Error('Unexpected trailing syntax.'); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  function evaluate(node: Expr, values: Values): number {
    if (node.kind === 'value') return values[node.slot];
    if (node.kind === 'number') return node.value;
    if (node.kind === 'unary') {
      const child = evaluate(node.child, values);
      return node.op === '!' ? Number(!child) : node.op === '-' ? -child : child;
    }
    const left = evaluate(node.left, values), right = evaluate(node.right, values);
    switch (node.op) {
      case '+': return left + right;
      case '-': return left - right;
      case '<': return Number(left < right);
      case '>': return Number(left > right);
      case '<=': return Number(left <= right);
      case '>=': return Number(left >= right);
      case '==': return Number(left === right);
      case '!=': return Number(left !== right);
      case '&&': return Number(Boolean(left) && Boolean(right));
      case '||': return Number(Boolean(left) || Boolean(right));
      default: return NaN;
    }
  }
  const samples = [-1000, -17, -1, 0, 1, 17, 1000];
  for (const leftFirst of samples) for (const leftSecond of samples) for (const rightFirst of samples) for (const rightSecond of samples) {
    const comparison = leftFirst === rightFirst ? leftSecond - rightSecond : leftFirst - rightFirst;
    const shouldSwap = spec.order === 'descending' ? comparison < 0 : comparison > 0;
    if (Boolean(evaluate(tree, [leftFirst, leftSecond, rightFirst, rightSecond])) !== shouldSwap) {
      return 'The condition sorts some records in the wrong order.';
    }
  }
  return null;
}
