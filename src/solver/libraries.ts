import type { Language, Question } from '../core/types';
import type { BlankContext } from './candidates';

const IDENTIFIER = /^[A-Za-z_]\w*$/;

function unique(values: string[]): string[] { return [...new Set(values)]; }

/** Short standard-library expressions built from names visible in this question. */
export function* generateLibraryCandidates(
  question: Question, blankId: string, language: Language, context: BlankContext
): Generator<string> {
  if (question.grading.kind !== 'program') return;
  const target = question.grading.targets.find(item => item.language === language);
  if (!target) return;
  const marker = `{{${blankId}}}`;
  const at = target.source.indexOf(marker);
  if (at < 0) return;
  const blank = question.blanks.find(item => item.id === blankId);
  const cap = blank?.maxChars ?? 80;
  const after = target.source.slice(at + marker.length);
  const source = `${target.helperSource ?? ''}\n${target.source}`.replace(/\{\{[^{}]+\}\}/g, ' ');
  const clean = source.replace(/\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(["'])(?:\\.|(?!\1)[^\\])*?\1/g, ' ');
  const seen = new Set<string>();
  function* emit(value: string): Generator<string> {
    const length = [...value].filter(char => !blank?.maxCharsExcludeWhitespace || !/\s/.test(char)).length;
    if (!value || length > cap || seen.has(value)) return;
    if (blank?.allowedChars && [...value].some(char => !blank.allowedChars!.includes(char))) return;
    if (blank?.forbiddenChars && [...value].some(char => blank.forbiddenChars!.includes(char))) return;
    const identifiers: string[] = value.match(/[A-Za-z_]\w*/g) ?? [];
    if (blank?.forbiddenIdentifiers?.some(name => identifiers.includes(name))) return;
    seen.add(value);
    yield value;
  }

  if (language === 'python') {
    const parameters = [...clean.matchAll(/\bdef\s+\w+\s*\(([^)]*)\)/g)]
      .flatMap(match => match[1].split(',').map(part => /^\s*([A-Za-z_]\w*)/.exec(part)?.[1] ?? ''));
    const assigned = [...clean.matchAll(/(?:^|\n)\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)/g)]
      .map(match => match[1]);
    const loopNames = [...clean.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g)].map(match => match[1]);
    const names = unique([...parameters, ...assigned, ...loopNames]).filter(name => IDENTIFIER.test(name)).slice(0, 12);
    const collections = unique([
      ...[...clean.matchAll(/\b([A-Za-z_]\w*)\s*:\s*(?:list|tuple|str)\b/g)].map(match => match[1]),
      ...[...clean.matchAll(/\b([A-Za-z_]\w*)\s*=\s*(?:\[|list\s*\(|tuple\s*\()/g)].map(match => match[1]),
      ...[...clean.matchAll(/\b([A-Za-z_]\w*)\s*\[/g)].map(match => match[1]).filter(name => names.includes(name))
    ]).slice(0, 5);
    const scalars = names.filter(name => !collections.includes(name)).slice(0, 6);
    const strings = unique([
      ...[...clean.matchAll(/\b([A-Za-z_]\w*)\s*:\s*str\b/g)].map(match => match[1]),
      ...[...clean.matchAll(/\b([A-Za-z_]\w*)\s*=\s*["']/g)].map(match => match[1])
    ]).slice(0, 4);
    const lists = collections.filter(name => !strings.includes(name));
    if (context === 'statement') {
      for (const list of lists) {
        yield* emit(`${list}.sort()`);
        yield* emit(`${list}.reverse()`);
        yield* emit(`${list}.clear()`);
        for (const value of [...scalars.slice(0, 4), '0', '1']) {
          yield* emit(`${list}.append(${value})`);
          yield* emit(`${list}.remove(${value})`);
        }
        yield* emit(`${list}.pop()`);
      }
      return;
    }
    for (const sequence of collections) {
      yield* emit(`len(${sequence})`);
      for (const functionName of ['min', 'max', 'sum', 'sorted', 'list', 'tuple', 'reversed', 'enumerate', 'any', 'all'])
        yield* emit(`${functionName}(${sequence})`);
      yield* emit(`list(reversed(${sequence}))`);
      yield* emit(`tuple(sorted(${sequence}))`);
      for (const value of [...scalars.slice(0, 4), '0', '1']) {
        yield* emit(`${sequence}.count(${value})`);
        yield* emit(`${value} in ${sequence}`);
        yield* emit(`${value} not in ${sequence}`);
      }
    }
    for (const left of collections.slice(0, 3)) for (const right of collections.slice(0, 3)) {
      if (left === right) continue;
      yield* emit(`zip(${left},${right})`);
      yield* emit(`list(zip(${left},${right}))`);
    }
    for (const text of strings) {
      for (const functionName of ['lower', 'upper', 'strip', 'isdigit', 'isalpha']) yield* emit(`${text}.${functionName}()`);
      for (const value of [...strings, ...scalars].slice(0, 5)) yield* emit(`${text}.find(${value})`);
    }
    for (const value of scalars) {
      for (const functionName of ['abs', 'int', 'float', 'bool', 'str', 'round']) yield* emit(`${functionName}(${value})`);
      for (const exponent of ['2', '3']) {
        yield* emit(`pow(${value},${exponent})`);
        yield* emit(`${value}**${exponent}`);
      }
      for (const other of scalars) {
        if (value === other) continue;
        for (const functionName of ['min', 'max', 'pow', 'divmod']) yield* emit(`${functionName}(${value},${other})`);
        yield* emit(`${value}//${other}`);
      }
    }
    if (scalars.length >= 2) for (const predicate of scalars.slice(0, 3)) {
      yield* emit(`${scalars[0]} if ${predicate} else ${scalars[1]}`);
    }
    return;
  }

  const typed = [...clean.matchAll(/\b(?:int|long|short|bool|char|double|float|string|vector\s*<[^>]+>|array\s*<[^>]+>|deque\s*<[^>]+>|list\s*<[^>]+>)\s*(?:[&*]\s*)?([A-Za-z_]\w*)\b/g)]
    .map(match => match[1]);
  const containers = unique([
    ...[...clean.matchAll(/\b(?:vector|array|deque|list|forward_list|string)\s*(?:<[^>]+>)?\s*(?:[&*]\s*)?([A-Za-z_]\w*)\b/g)].map(match => match[1]),
    ...[...clean.matchAll(/\b([A-Za-z_]\w*)\s*\[/g)].map(match => match[1]).filter(name => typed.includes(name))
  ]).slice(0, 5);
  const scalars = unique(typed).filter(name => !containers.includes(name)).slice(0, 6);
  const vectorLike = containers.filter(name => new RegExp(`\\b(?:vector|array)\\s*<[^>]+>\\s*(?:[&*]\\s*)?${name}\\b`).test(clean));
  const strings = containers.filter(name => new RegExp(`\\bstring\\s*(?:[&*]\\s*)?${name}\\b`).test(clean));
  const statement = (body: string) => /^\s*;/.test(after) ? body : `${body};`;
  if (language === 'c') {
    if (context !== 'statement') for (const value of scalars)
      for (const functionName of ['abs', 'sqrt', 'floor', 'ceil', 'round']) yield* emit(`${functionName}(${value})`);
    return;
  }
  if (context === 'statement') {
    for (const text of strings) {
      yield* emit(statement(`${text}.pop_back()`));
      yield* emit(statement(`${text}.clear()`));
      for (const value of [...scalars.slice(0, 3), ...strings.slice(0, 2)]) {
        yield* emit(statement(`${text}.push_back(${value})`));
        yield* emit(statement(`${text}.append(${value})`));
      }
    }
    for (const collection of vectorLike) {
      for (const functionName of ['sort', 'reverse'])
        yield* emit(statement(`${functionName}(${collection}.begin(),${collection}.end())`));
      for (const value of [...scalars.slice(0, 4), '0', '1']) {
        yield* emit(statement(`fill(${collection}.begin(),${collection}.end(),${value})`));
        yield* emit(statement(`${collection}.push_back(${value})`));
        yield* emit(statement(`${collection}.resize(${value})`));
      }
      for (const oldValue of scalars.slice(0, 2)) for (const newValue of scalars.slice(0, 2))
        if (oldValue !== newValue) yield* emit(statement(`replace(${collection}.begin(),${collection}.end(),${oldValue},${newValue})`));
      for (const count of scalars.slice(0, 3)) for (const value of scalars.slice(0, 3))
        yield* emit(statement(`${collection}.assign(${count},${value})`));
      for (const amount of ['1', '2']) yield* emit(statement(`rotate(${collection}.begin(),${collection}.begin()+${amount},${collection}.end())`));
      yield* emit(statement(`${collection}.pop_back()`));
      yield* emit(statement(`${collection}.clear()`));
    }
    for (const left of scalars) for (const right of scalars) if (left !== right) yield* emit(statement(`swap(${left},${right})`));
    return;
  }
  for (const collection of containers) {
    for (const method of ['size', 'length', 'empty', 'front', 'back']) yield* emit(`${collection}.${method}()`);
    for (const index of [...scalars.slice(0, 4), '0', '1']) yield* emit(`${collection}.at(${index})`);
  }
  for (const collection of vectorLike) {
    for (const functionName of ['is_sorted', 'min_element', 'max_element']) {
      const call = `${functionName}(${collection}.begin(),${collection}.end())`;
      yield* emit(call);
      if (functionName !== 'is_sorted') yield* emit(`*${call}`);
    }
    for (const value of [...scalars.slice(0, 4), '0', '1']) {
      for (const functionName of ['count', 'find', 'binary_search', 'lower_bound', 'upper_bound'])
        yield* emit(`${functionName}(${collection}.begin(),${collection}.end(),${value})`);
    }
  }
  for (const value of scalars) {
    for (const functionName of ['abs', 'sqrt', 'floor', 'ceil', 'round']) yield* emit(`${functionName}(${value})`);
    for (const exponent of ['2', '3']) yield* emit(`pow(${value},${exponent})`);
    for (const other of scalars) if (value !== other)
      for (const functionName of ['min', 'max']) yield* emit(`${functionName}(${value},${other})`);
  }
}
