import type { Language, Question } from '../core/types';
import { generateDeepCandidates } from './deep';
import { generateExampleCandidates } from './synthesis';
import { generateStructuralCandidates } from './structural';
import { generatePythonStructuralCandidates } from './python-structural';
import { generateLibraryCandidates } from './libraries';

const KEYWORDS = new Set(('auto bool break case char class const continue def do double elif else false False float for if in int long None null return short static string struct switch true True typedef using void while vector array list deque queue stack std size begin end namespace include').split(' '));
const OPERATORS = ['!=', '==', '<', '<=', '>', '>=', '+', '-', '*', '/', '%', '&&', '||'];

export type BlankContext = 'statement' | 'arguments' | 'condition' | 'expression';

export function classifyBlankContext(source: string, blankId: string): BlankContext {
  const marker = `{{${blankId}}}`;
  const at = source.indexOf(marker);
  if (at < 0) return 'expression';
  const lineStart = source.lastIndexOf('\n', at - 1) + 1;
  const lineEnd = source.indexOf('\n', at + marker.length);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim();
  if (line === marker || line === `${marker};`) return 'statement';
  const before = source.slice(0, at);
  const after = source.slice(at + marker.length);
  if (/\b[A-Za-z_]\w*\s*\(\s*$/.test(before) && /^\s*\)/.test(after)) {
    if (/\b(?:if|while|for|switch)\s*\(\s*$/.test(before)) return 'condition';
    return 'arguments';
  }
  if (/\b(?:if|while)\s*$/.test(before) && /^\s*:/.test(after)) return 'condition';
  return 'expression';
}

function visibleNames(source: string): string[] {
  const withoutComments = source.replace(/\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/(["'])(?:\\.|(?!\1)[^\\])*?\1/g, ' ');
  const names = withoutComments.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? [];
  return [...new Set(names.filter(name => !KEYWORDS.has(name) && !/^\d/.test(name)))];
}

function functionNames(source: string, language: Language): string[] {
  const re = language === 'python' ? /\bdef\s+([A-Za-z_]\w*)\s*\(/g : /\b(?:int|bool|double|float|char|string|void)\s+([A-Za-z_]\w*)\s*\(/g;
  return [...source.matchAll(re)].map(match => match[1]);
}

type ParamKind = 'scalar' | 'collection' | 'string';
type HelperSignature = { name: string; arity: number; params: ParamKind[]; returnsVoid: boolean };

function paramKind(declaration: string): ParamKind {
  if (/\b(?:vector|array|deque|list|forward_list)\b|\blist\s*\[/.test(declaration)) return 'collection';
  if (/\b(?:string|str)\b/.test(declaration)) return 'string';
  return 'scalar';
}

function collectionNames(source: string): Set<string> {
  return new Set([...source.matchAll(/\b(?:vector|array|deque|list|forward_list)\s*(?:<[^>]+>|\[[^\]]+\])\s*(?:[&*]\s*)?([A-Za-z_]\w*)\b|\b([A-Za-z_]\w*)\s*:\s*list\s*\[/g)]
    .map(match => match[1] ?? match[2]));
}

function helperSignatures(source: string, language: Language, activeFunction: string): HelperSignature[] {
  const signatures: HelperSignature[] = [];
  const re = language === 'python'
    ? /\bdef\s+([A-Za-z_]\w*)\s*\(([^()]*)\)/g
    : /\b(?:int|bool|double|float|char|string|void)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)/g;
  for (const match of source.matchAll(re)) {
    if (match[1] === activeFunction) continue;
    const declarations = match[2].trim() ? match[2].split(',') : [];
    const arity = declarations.length;
    const returnsVoid = language === 'python'
      ? /^\s*->\s*None\b/.test(source.slice(match.index! + match[0].length))
      : new RegExp(`\\bvoid\\s+${match[1]}\\s*\\(`).test(source);
    if (arity > 0 && arity <= 3 && !signatures.some(item => item.name === match[1])) {
      signatures.push({ name: match[1], arity, params: declarations.map(paramKind), returnsVoid });
    }
  }
  return signatures.slice(0, 4);
}

function declaredNames(source: string, language: Language): string[] {
  const names: string[] = [];
  if (language === 'python') {
    for (const match of source.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)) {
      for (const part of match[1].split(',')) {
        const name = /^\s*([A-Za-z_]\w*)/.exec(part)?.[1];
        if (name) names.push(name);
      }
    }
    for (const match of source.matchAll(/(?:^|\n)\s*([A-Za-z_]\w*)\s*(?::\s*[^=\n]+)?=(?!=)|\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) names.push(match[1] ?? match[2]);
  } else {
    for (const match of source.matchAll(/\b(?:int|bool|double|float|char|string|long|vector\s*<[^>]+>|array\s*<[^>]+>)\s*(?:[&*]\s*)?([A-Za-z_]\w*)\s*(?=[,)=;\[])/g)) names.push(match[1]);
    for (const declaration of source.matchAll(/\b(?:int|bool|double|float|char|long)\s+([^;(){}]+);/g)) {
      for (const part of declaration[1].split(',')) {
        const name = /^\s*(?:[&*]\s*)?([A-Za-z_]\w*)/.exec(part)?.[1];
        if (name) names.push(name);
      }
    }
  }
  return [...new Set(names)];
}

function sourceAtoms(source: string, language: Language, prioritySource: string): string[] {
  const functions = functionNames(source, language);
  const names = [...new Set([...declaredNames(prioritySource, language), ...visibleNames(prioritySource),
    ...declaredNames(source, language), ...visibleNames(source)])]
    .filter(name => !functions.includes(name) && !KEYWORDS.has(name)).slice(0, 14);
  const constants = [...new Set((source.match(/(?<![\w.])-?\d+(?![\w.])/g) ?? []).filter(x => Number(x) >= -9 && Number(x) <= 9))].slice(0, 6);
  const atoms = [...names];
  const indexed = names.filter(name => new RegExp(`\\b${name}\\s*\\[|\\b(?:vector|array)\\s*<[^>]+>\\s*&?\\s*${name}\\b|\\b${name}\\s*:\\s*list\\s*\\[`).test(source));
  const indexOrder = ['i', 'j', 'k', 'idx', 'index', 'n', 'x', 'y'];
  const indices = names.filter(name => indexOrder.includes(name)).sort((a, b) => indexOrder.indexOf(a) - indexOrder.indexOf(b)).slice(0, 4);
  for (const array of indexed.slice(0, 3)) for (const index of indices) {
    atoms.push(`${array}[${index}]`);
    atoms.push(`${array}[${index}-1]`, `${array}[${index}+1]`);
  }
  for (const array of indexed.slice(0, 3)) atoms.push(`${array}[0]`, `${array}[1]`);
  atoms.push(...constants, '0', '1', '2');
  return [...new Set(atoms)];
}

/** Grammar production, ordered by common FITB shapes and then expression depth. */
export function* generateCandidates(question: Question, blankId: string, language: Language, strategy: 'templates' | 'grammar' | 'hybrid' | 'deep' | 'exhaustive' = 'hybrid'): Generator<string> {
  if (strategy === 'deep' || strategy === 'exhaustive') {
    const emitted = new Set<string>();
    let prefix = 0;
    for (const candidate of generateCandidates(question, blankId, language, 'hybrid')) {
      if (!emitted.has(candidate)) { emitted.add(candidate); yield candidate; }
      if (++prefix >= 500) break;
    }
    if (question.grading.kind !== 'program') return;
    const target = question.grading.targets.find(item => item.language === language);
    if (!target) return;
    for (const candidate of generateDeepCandidates(question, blankId, language, classifyBlankContext(target.source, blankId))) {
      if (!emitted.has(candidate)) { emitted.add(candidate); yield candidate; }
    }
    return;
  }
  if (question.grading.kind !== 'program') return;
  const target = question.grading.targets.find(item => item.language === language);
  if (!target) return;
  const source = `${target.helperSource ?? ''}\n${target.source}`.replace(/\{\{[^{}]+\}\}/g, ' ');
  const atoms = sourceAtoms(source, language, target.source.replace(/\{\{[^{}]+\}\}/g, ' '));
  const simple = atoms.filter(atom => /^[A-Za-z_]\w*$|^-?\d+$/.test(atom)).slice(0, 12);
  const markerAt = target.source.indexOf(`{{${blankId}}}`);
  const localFunctions = markerAt < 0 ? [] : functionNames(target.source.slice(0, markerAt), language);
  const activeFunction = localFunctions.at(-1) ?? (target.harness.kind === 'call' ? target.harness.function : 'main');
  const helpers = helperSignatures(`${target.helperSource ?? ''}\n${target.source}`, language, activeFunction);
  const collections = collectionNames(source);
  const context = classifyBlankContext(target.source, blankId);
  const emitted = new Set<string>();
  const blank = question.blanks.find(item => item.id === blankId);
  const cap = Math.min(blank?.maxChars ?? 40, 80);
  const extraLiterals = [...Array.from({ length: 33 }, (_, value) => String(value)),
    // Small binary masks and alternating bit patterns occur in legacy papers.
    '63', '127', '255', '51', '85', '170', '204',
    ...Array.from({ length: 9 }, (_, index) => String(-index - 1))];
  function* emit(value: string): Generator<string> {
    if (value.length <= cap && !emitted.has(value)) { emitted.add(value); yield value; }
  }
  if (strategy === 'hybrid' && language !== 'python' && blank?.forbiddenChars?.includes('-')) {
    for (const variable of simple.filter(value => /^[A-Za-z_]\w*$/.test(value)).slice(0, 6))
      yield* emit(`~${variable}+1`);
  }
  if (strategy === 'hybrid') for (const candidate of generateExampleCandidates(question, blankId, language)) yield* emit(candidate);
  if (strategy === 'hybrid' && language === 'python')
    for (const candidate of generatePythonStructuralCandidates(question, blankId)) yield* emit(candidate);
  if (strategy === 'hybrid' && language === 'python')
    for (const candidate of generateLibraryCandidates(question, blankId, language, context)) yield* emit(candidate);
  if (strategy === 'hybrid' && context !== 'statement')
    for (const candidate of generateStructuralCandidates(question, blankId, language)) yield* emit(candidate);
  const markerIndex = target.source.indexOf(`{{${blankId}}}`);
  const beforeBlank = markerIndex < 0 ? '' : target.source.slice(0, markerIndex);
  const afterBlank = markerIndex < 0 ? '' : target.source.slice(markerIndex + `{{${blankId}}}`.length);
  if (strategy === 'hybrid' && language !== 'python' && /^\s*\(/.test(afterBlank)
    && /(?:^|\n)\s*$/.test(beforeBlank)) {
    yield* emit('else if');
    yield* emit('if');
  }
  if (strategy === 'hybrid' && cap <= 4 && /\(\s*$/.test(beforeBlank) && /^\s*\)/.test(afterBlank)) {
    const variables = declaredNames(target.source, language).slice(0, 4);
    for (const a of variables) for (const b of variables) {
      if (a === b) continue;
      for (const op of ['>', '<', '==', '!=', '>=', '<=']) yield* emit(`${a}${op}${b}`);
    }
  }
  if (strategy === 'hybrid' && language !== 'python'
    && /\bfor\s*\(\s*int\s*$/.test(beforeBlank) && /^\s*\)/.test(afterBlank)) {
    const index = /\b([A-Za-z_]\w*)\s*-\s*1\s*\]/.exec(afterBlank.slice(0, 100))?.[1] ?? 'i';
    const bounds = declaredNames(target.source, language).filter(name => name !== index
      && new RegExp(`\\b${name}\\s*=\\s*[^;]*(?:size\\s*\\(|length\\s*\\()`).test(target.source));
    for (const bound of [...new Set([...bounds, 'n', 'len', 'size'])]) {
      if (!new RegExp(`\\b${bound}\\b`).test(target.source)) continue;
      for (const start of [1, 0]) {
        yield* emit(`${index}=${start};${index}<${bound};${index}++`);
        yield* emit(`${index}=${start};${index}<=${bound};${index}++`);
      }
    }
  }
  if (strategy === 'hybrid' && language !== 'python' && cap <= 4
    && /(?:\breturn\s+|[=(+*\/%^&|]\s*)[A-Za-z_]\w*\s*$/.test(beforeBlank)
    && /^\s*[;)]/.test(afterBlank)) {
    const printed = (target.source.match(/(?<![\w.])\d+(?![\w.])/g) ?? []).map(Number)
      .filter(value => value >= 0 && value <= 99);
    const numbers = [...new Set([...printed, ...Array.from({ length: 13 }, (_, i) => i)])].filter(number => number !== 0);
    for (const op of ['%', '/', '*', '+', '-', '&', '^', '|'])
      for (const number of numbers) yield* emit(`${op}${number}`);
  }
  if (strategy === 'hybrid' && language !== 'python' && (context === 'expression' || context === 'condition')) {
    const declared = declaredNames(target.source, language).filter(name => !functionNames(target.source, language).includes(name)
      && !new RegExp(`\\b${name}\\s*\\[`).test(target.source));
    const focus = [...new Set(declared)].sort((a, b) => beforeBlank.lastIndexOf(b) - beforeBlank.lastIndexOf(a)).slice(0, 6);
    const ordered = [...focus, '0', '1', '2'];
    const paramOrder = declaredNames(target.source, language).filter(name => focus.includes(name));
    for (const helper of helpers.filter(item => !item.returnsVoid && item.arity === 3)) {
      if (paramOrder.length >= 3) {
        const args = paramOrder.slice(0, 3);
        yield* emit(`-${helper.name}(${args.map(name => `-${name}`).join(',')})`);
        yield* emit(`${helper.name}(${args.join(',')})`);
      }
    }
    if (paramOrder.length >= 3) {
      const args = paramOrder.slice(0, 3);
      const ternaryHelpers = helpers.filter(item => !item.returnsVoid && item.arity === 3);
      for (let i = 0; i < ternaryHelpers.length; i++) for (let j = i + 1; j < ternaryHelpers.length; j++) {
        yield* emit(`${args.join('+')}-${ternaryHelpers[i].name}(${args.join(',')})-${ternaryHelpers[j].name}(${args.join(',')})`);
      }
    }
    for (const array of target.source.matchAll(/\b[A-Za-z_]\w*\[(\d+)\]/g)) {
      const length = Number(array[1]);
      if (!Number.isSafeInteger(length) || length < 2 || length > 100_000) continue;
      for (const index of focus.slice(0, 4)) yield* emit(`${length - 1}-${index}`);
    }
    for (const a of focus) for (const b of ordered) {
      for (const op of ['*', '%', '/', '+', '-']) {
        if ((op === '/' || op === '%') && b === '0') continue;
        yield* emit(`${a}${op}${b}`);
      }
    }
    for (const a of focus.slice(0, 4)) for (const b of focus.slice(0, 4)) {
      if (a === b) continue;
      yield* emit(`(${a}%${b}+${b})%${b}`);
      yield* emit(`${a}%${b}==0`);
    }
    for (const a of focus.slice(0, 4)) for (const b of focus.slice(0, 4)) {
      for (const c of ['0', '1', '2']) {
        yield* emit(`${a}*${b}+${c}`);
        yield* emit(`${a}*${b}-${c}`);
      }
    }
  }
  if (context === 'statement') {
    const marker = `{{${blankId}}}`;
    const lineStart = target.source.lastIndexOf('\n', markerIndex - 1) + 1;
    const lineEnd = target.source.indexOf('\n', markerIndex + marker.length);
    const line = target.source.slice(lineStart, lineEnd < 0 ? target.source.length : lineEnd).trim();
    const terminate = (statement: string) => language === 'python' || line === `${marker};` ? statement : `${statement};`;
    for (const statement of language === 'python' ? ['break', 'continue', 'pass'] : ['break', 'continue']) yield* emit(terminate(statement));
    if (language !== 'python' && new RegExp(`\\bvoid\\s+${activeFunction}\\s*\\(`).test(target.source)) yield* emit(terminate('return'));
    if (strategy === 'hybrid') for (const candidate of generateStructuralCandidates(question, blankId, language)) yield* emit(candidate);
    const variables = simple.filter(atom => /^[A-Za-z_]\w*$/.test(atom)).slice(0, 8);
    const returnAtoms = [...new Set(['0', '1', ...atoms.slice(0, 18)])];
    for (const atom of returnAtoms) yield* emit(terminate(`return ${atom}`));
    const scalarTerms = [...new Set([...variables, '1', '2'])].slice(0, 9);
    for (const a of scalarTerms) for (const b of scalarTerms) {
      if (b === '0') continue;
      for (const op of ['/', '-', '+', '*']) yield* emit(terminate(`return ${a}${op}${b}`));
    }
    if (activeFunction && activeFunction !== 'main') {
      for (const atom of returnAtoms.slice(0, 12)) yield* emit(terminate(`return ${activeFunction}(${atom})`));
      for (const a of variables) for (const b of scalarTerms) if (b !== '0') {
        yield* emit(terminate(`return ${activeFunction}(${a}/${b})`));
      }
    }
    for (const name of variables) {
      const statements = language === 'python'
        ? [`${name}+=1`, `${name}-=1`, `${name}=0`, `${name}=1`]
        : [`${name}++`, `++${name}`, `${name}--`, `--${name}`, `${name}+=1`, `${name}-=1`, `${name}=0`, `${name}=1`];
      for (const statement of statements) yield* emit(terminate(statement));
    }
    for (const indexed of atoms.filter(atom => /^[A-Za-z_]\w*\[[^\]]+\]$/.test(atom)).slice(0, 12)) {
      for (const statement of [`${indexed}++`, `++${indexed}`, `${indexed}+=1`, `${indexed}=${indexed}+1`])
        yield* emit(terminate(statement));
    }
    for (const helper of helpers) {
      if (helper.arity === 1) for (const a of variables) yield* emit(terminate(`${helper.name}(${a})`));
      if (helper.arity === 2) for (const a of variables.slice(0, 5)) for (const b of variables.slice(0, 5)) yield* emit(terminate(`${helper.name}(${a},${b})`));
    }
    if (strategy === 'hybrid' && language !== 'python')
      for (const candidate of generateLibraryCandidates(question, blankId, language, context)) yield* emit(candidate);
    return;
  }
  if (context === 'arguments') {
    const callName = /\b([A-Za-z_]\w*)\s*\(\s*$/.exec(beforeBlank)?.[1];
    const arity = helpers.find(helper => helper.name === callName)?.arity ?? (callName === 'range' ? 2 : 0);
    const variables = simple.filter(atom => /^[A-Za-z_]\w*$/.test(atom)).slice(0, 6);
    if (arity === 2) {
      for (const a of variables) for (const b of variables) {
        yield* emit(`${a},${b}`);
        yield* emit(`${a},${b}+1`);
        yield* emit(`${a},${b}-1`);
      }
      for (const end of variables) {
        yield* emit(`1,${end}`);
        yield* emit(`0,${end}`);
      }
      if (callName !== 'range') return;
    }
  }
  if (language === 'python' && /\brange\s*\(\s*$/.test(beforeBlank)) {
    for (const end of simple.filter(atom => /^[A-Za-z_]\w*$/.test(atom)).slice(0, 5)) {
      yield* emit(`1,${end}`);
      yield* emit(`0,${end}`);
      yield* emit(`1,${end}+1`);
      yield* emit(`0,${end}-1`);
    }
  }
  for (const atom of atoms) yield* emit(atom);
  if (strategy === 'hybrid') for (const atom of simple.filter(value => /^[A-Za-z_]\w*$/.test(value)).slice(0, 8)) yield* emit(`-${atom}`);
  // A short blank often asks for a literal; try those before
  // expanding expressions. Longer blanks retain the original expression order.
  if (cap <= 3) for (const literal of extraLiterals) yield* emit(literal);
  if (strategy !== 'templates') {
    const scalars = simple.filter(atom => /^[A-Za-z_]\w*$/.test(atom) && !collections.has(atom)).slice(0, 7);
    for (const variable of scalars) {
      yield* emit(`${variable}-1`);
      yield* emit(`${variable}+1`);
    }
    if (/\[\s*$/.test(beforeBlank) && /^\s*\]/.test(afterBlank)) {
      for (const a of scalars) for (const b of scalars) if (a !== b) {
        yield* emit(`${a}-${b}+1`);
        yield* emit(`${a}+${b}-1`);
        yield* emit(`${a}-${b}-1`);
        yield* emit(`${a}+${b}+1`);
      }
    }
  }
  if (strategy !== 'templates' && helpers.length) {
    const variableArgs = simple.filter(atom => /^[A-Za-z_]\w*$/.test(atom)).slice(0, 5);
    const argPool = [...variableArgs, '0', '1', '2'].slice(0, 7);
    const argsFor = (helper: HelperSignature, index: number) => helper.params[index] === 'collection'
      ? variableArgs.filter(name => collections.has(name))
      : helper.params[index] === 'scalar' ? argPool.filter(name => !collections.has(name)) : variableArgs.filter(name => !collections.has(name));
    const calls: string[] = [];
    const addCall = (name: string, args: string[]) => {
      const call = `${name}(${args.join(',')})`;
      if (call.length <= cap && !calls.includes(call)) calls.push(call);
    };
    for (const helper of helpers) {
      if (helper.arity === 1) for (const a of argsFor(helper, 0)) addCall(helper.name, [a]);
      if (helper.arity === 2) for (const a of argsFor(helper, 0)) for (const b of argsFor(helper, 1)) addCall(helper.name, [a, b]);
      if (helper.arity === 3) for (const a of argsFor(helper, 0).slice(0, 4)) for (const b of argsFor(helper, 1).slice(0, 4)) for (const c of argsFor(helper, 2).slice(0, 4)) addCall(helper.name, [a, b, c]);
    }
    if (strategy === 'hybrid') for (const helper of helpers.filter(item => item.arity === 1 && item.params[0] === 'scalar' && !item.returnsVoid)) {
      const variables = variableArgs.filter(name => !collections.has(name)).slice(0, 4);
      for (const a of variables) for (const b of variables) {
        if (a === b) continue;
        yield* emit(`${helper.name}(${a}-${b}*${b})`);
        yield* emit(`${helper.name}(${a}+${b}*${b})`);
        yield* emit(`${helper.name}(${a}*${a}-${b})`);
      }
    }
    for (const call of calls) yield* emit(call);
    // A helper can take a computed argument, including a reordered or repeated input.
    for (const helper of helpers.filter(item => item.arity === 3 && item.params.every(kind => kind === 'scalar'))) for (const a of variableArgs.filter(name => !collections.has(name)).slice(0, 4)) for (const b of variableArgs.filter(name => !collections.has(name)).slice(0, 4)) {
      if (a === b) continue;
      for (const computed of [`${a}+${b}`, `${a}-${b}`, `${b}-${a}`]) {
        yield* emit(`${helper.name}(${a},${b},${computed})`);
        yield* emit(`${helper.name}(${computed},${a},${b})`);
      }
    }
    // Compositions include helper calls used as arguments to another helper.
    const unary = helpers.filter(item => item.arity === 1 && !item.returnsVoid && item.params[0] === 'scalar');
    for (const outer of unary) for (const inner of calls.slice(0, 70)) yield* emit(`${outer.name}(${inner})`);
    for (const outer of helpers.filter(item => item.arity === 2 && !item.returnsVoid && item.params.every(kind => kind === 'scalar'))) for (const inner of calls.slice(0, 30)) for (const a of variableArgs.filter(name => !collections.has(name)).slice(0, 3)) {
      yield* emit(`${outer.name}(${inner},${a})`);
      yield* emit(`${outer.name}(${a},${inner})`);
    }
    // Shift an argument before calling a helper; these often expose boundary cases.
    for (const helper of unary) for (const a of variableArgs.filter(name => !collections.has(name)).slice(0, 5)) for (const delta of ['-1', '+1', '-2', '+2']) {
      yield* emit(`${helper.name}(${a}${delta})`);
    }
    for (const helper of unary) for (const a of variableArgs.filter(name => !collections.has(name)).slice(0, 4)) for (const scale of ['2', '3']) for (const offset of ['-1', '-2', '+1', '+2']) {
      yield* emit(`${helper.name}(${a}*${scale}${offset})`);
    }
  }
  if (strategy === 'hybrid' && language !== 'python')
    for (const candidate of generateLibraryCandidates(question, blankId, language, context)) yield* emit(candidate);
  if (strategy !== 'templates') {
    const indexed = atoms.filter(atom => atom.includes('[')).slice(0, 8);
    for (const a of indexed) for (const b of indexed) {
      if (a === b) continue;
      yield* emit(`${a}-${b}`);
      yield* emit(`${a}+${b}`);
    }
    for (const a of indexed) for (const b of simple.slice(0, 8)) {
      yield* emit(`${a}+${b}`);
      yield* emit(`${a}-${b}`);
      yield* emit(`${b}-${a}`);
    }
    for (const a of indexed) for (const b of simple.slice(0, 8)) for (const op of ['==', '!=', '<', '>', '<=', '>=']) {
      yield* emit(`${a}${op}${b}`);
      yield* emit(`${b}${op}${a}`);
    }
  }
  if (strategy !== 'templates') {
    const variables = simple.filter(atom => /^[A-Za-z_]\w*$/.test(atom)).slice(0, 6);
    for (const arithmetic of ['+', '-']) for (const a of variables) for (const b of variables) {
      if (a === b) continue;
      for (const comparison of ['>', '<', '==', '!=', '>=', '<=']) for (const c of variables) {
        yield* emit(`${a}${arithmetic}${b}${comparison}${c}`);
      }
    }
  }
  if (strategy !== 'grammar') {
    for (const a of simple) {
      yield* emit(language === 'python' ? `not ${a}` : `!${a}`);
      yield* emit(`-${a}`);
    }
    // Common contest answers: one comparison or one arithmetic operation.
    for (const op of OPERATORS) {
      const printedOp = language === 'python' ? op === '&&' ? ' and ' : op === '||' ? ' or ' : op : op;
      for (const a of simple) for (const b of simple) if (a !== b) yield* emit(`${a}${printedOp}${b}`);
    }
  }
  if (strategy !== 'templates') {
    const terms = atoms.slice(0, 12);
    for (const op of OPERATORS) {
      const printedOp = language === 'python' ? op === '&&' ? ' and ' : op === '||' ? ' or ' : op : op;
      for (const a of terms) for (const b of terms) if (a !== b) yield* emit(`${a}${printedOp}${b}`);
    }
    // One nested expression is enough for many conditions and loop bounds.
    const constants = ['0', '1', '2'];
    for (const a of terms) for (const b of constants) for (const op of ['+', '-']) {
      yield* emit(`${a}${op}${b}`);
      for (const c of terms.slice(0, 6)) for (const cmp of ['==', '!=', '<', '>', '<=', '>=']) yield* emit(`${a}${op}${b}${cmp}${c}`);
    }
    for (const fn of functionNames(source, language).slice(0, 3)) for (const a of terms.slice(0, 6)) for (const b of constants) {
      yield* emit(`${fn}(${a}-${b})`);
      yield* emit(`${fn}(${a}+${b})`);
    }
  }
  if (cap > 3) for (const literal of extraLiterals) yield* emit(literal);
}
