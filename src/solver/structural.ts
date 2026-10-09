import type { Language, Question } from '../core/types';

type FunctionShape = { name: string; parameters: string[]; result: string; at: number };

function functions(source: string): FunctionShape[] {
  return [...source.matchAll(/\b(int|bool|char|double|void|long long|string)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{/g)]
    .map(match => ({ result: match[1], name: match[2], at: match.index!,
      parameters: match[3].split(',').map(part => /([A-Za-z_]\w*)\s*$/.exec(part.trim())?.[1] ?? '').filter(Boolean) }));
}

function callArguments(source: string): { at: number; args: string[] }[] {
  const calls: { at: number; args: string[] }[] = [];
  for (const match of source.matchAll(/\b[A-Za-z_]\w*\s*\(/g)) {
    const start = match.index! + match[0].length;
    let depth = 0, end = -1;
    for (let i = start; i < source.length; i++) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        if (depth === 0) { end = i; break; }
        depth--;
      }
    }
    if (end < 0 || end - start > 120) continue;
    const args: string[] = [];
    let from = start; depth = 0;
    for (let i = start; i <= end; i++) {
      if (source[i] === '(' || source[i] === '[') depth++;
      else if (source[i] === ')' || source[i] === ']') depth--;
      if (i === end || source[i] === ',' && depth === 0) {
        args.push(source.slice(from, i).trim()); from = i + 1;
      }
    }
    calls.push({ at: match.index!, args });
  }
  return calls;
}

/** Source-derived C/C++ completions for array, call, and loop shapes. The grader validates every emitted program. */
export function* generateStructuralCandidates(question: Question, blankId: string, language: Language): Generator<string> {
  if (question.grading.kind !== 'program' || language === 'python') return;
  const target = question.grading.targets.find(item => item.language === language);
  if (!target) return;
  const marker = `{{${blankId}}}`;
  const at = target.source.indexOf(marker);
  if (at < 0) return;
  const blank = question.blanks.find(item => item.id === blankId);
  const maxChars = Math.min(blank?.maxChars ?? 80, 100);
  const source = `${target.helperSource ?? ''}\n${target.source}`;
  const markerAt = source.indexOf(marker);
  const clean = source.replace(/\{\{[^{}]+\}\}/g, ' ')
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
  const shapes = functions(clean);
  const active = [...shapes].reverse().find(shape => shape.at < markerAt);
  const globalEnd = shapes[0]?.at ?? markerAt;
  const visibleSource = `${clean.slice(0, Math.min(globalEnd, markerAt))}\n${active ? clean.slice(active.at, markerAt) : ''}`;
  const declarations = [...visibleSource.matchAll(/\b(?:int|bool|char|double|long long|string)\s+([^;(){}]+);/g)]
    .flatMap(match => match[1].split(',').map(part => /^\s*(?:[&*]\s*)?([A-Za-z_]\w*)(?:\s*\[\s*(\d+)\s*\])?/.exec(part))
      .filter((item): item is RegExpExecArray => Boolean(item)));
  const declared = [...visibleSource.matchAll(/\b(?:int|bool|char|double|long long|string)\s+(?:[&*]\s*)?([A-Za-z_]\w*)\s*(?=[,;)=\[])/g)]
    .map(match => match[1]).concat(declarations.map(match => match[1]));
  const vars = [...new Set(declared)];
  const otherFunctions = shapes.filter(shape => shape.name !== active?.name && shape.name !== 'main');
  const arrayDeclarations = declarations.filter(match => match[2])
    .map(match => ({ name: match[1], capacity: Number(match[2]) }));
  const knownScalars = vars.filter(name => !arrayDeclarations.some(array => array.name === name) && !shapes.some(shape => shape.name === name));
  const seen = new Set<string>();
  function* emit(raw: string): Generator<string> {
    const candidate = raw.replace(/\s+/g, '');
    const length = [...candidate].filter(char => !blank?.maxCharsExcludeWhitespace || !/\s/.test(char)).length;
    if (!candidate || candidate.includes('{{') || length > maxChars || seen.has(candidate)) return;
    const identifiers: string[] = candidate.match(/[A-Za-z_]\w*/g) ?? [];
    if (blank?.forbiddenIdentifiers?.some(identifier => identifiers.includes(identifier))) return;
    if (blank?.allowedChars && [...candidate].some(char => !blank.allowedChars!.includes(char))) return;
    if (blank?.forbiddenChars && [...candidate].some(char => blank.forbiddenChars!.includes(char))) return;
    seen.add(candidate); yield candidate;
  }

  const before = target.source.slice(0, at);
  const after = target.source.slice(at + marker.length);
  // Preserve a boolean accumulator while testing the element visited by the
  // surrounding loop, including a vector passed as a function parameter.
  const assigned = /\b([A-Za-z_]\w*)\s*=\s*$/.exec(before)?.[1];
  if (assigned && new RegExp(`\\bbool\\s+${assigned}\\b`).test(visibleSource)) {
    const collections = [...new Set([...arrayDeclarations.map(item => item.name),
      ...[...visibleSource.matchAll(/\bvector\s*<\s*int\s*>\s*(?:[&*]\s*)?([A-Za-z_]\w*)/g)].map(match => match[1])])];
    const indices = knownScalars.filter(name => /^(?:i|j|k|idx|index|pos)$/.test(name));
    for (const collection of collections) for (const index of indices) {
      yield* emit(`${assigned}&&${collection}[${index}]`);
      yield* emit(`${assigned}||${collection}[${index}]`);
    }
  }

  // Reuse printed, intact expressions near the hole. In code completion the
  // same index or bound is often used in the following statement.
  const fragments: { at: number; text: string }[] = [];
  for (const call of callArguments(clean)) for (const arg of call.args) {
    if (/^[A-Za-z_0-9+*\/%&|^<>=!()[\] .-]+$/.test(arg) && arg.length < 70)
      fragments.push({ at: call.at, text: arg });
  }
  for (const match of clean.matchAll(/\b(?:return|while)\s*(?:\(\s*)?([A-Za-z_]\w*(?:\s*[-+*\/%&|^<>=!]\s*[A-Za-z_0-9]+){1,5})/g))
    fragments.push({ at: match.index!, text: match[1] });
  fragments.sort((a, b) => Math.abs(a.at - markerAt) - Math.abs(b.at - markerAt));
  for (const fragment of fragments.slice(0, 100)) {
    const names = fragment.text.match(/[A-Za-z_]\w*/g) ?? [];
    if (names.every(name => vars.includes(name) || ['true', 'false'].includes(name))) yield* emit(fragment.text);
    if (seen.size >= 35) break;
  }

  const standalone = /(?:^|[;{}])\s*$/.test(before) && /^\s*;/.test(after)
    || /(?:^|\n)\s*$/.test(before) && /^\s*(?:;|\n)/.test(after);
  const trailingSemicolon = /^\s*;/.test(after);
  const statement = (body: string) => trailingSemicolon ? body.replace(/;$/, '') : body.endsWith(';') ? body : `${body};`;

  // Three-assignment swap is a common printed C/C++ completion with an
  // existing temporary, two indices, and a global array.
  if (standalone && active?.name === 'swap' && active.parameters.length === 2 && arrayDeclarations.length) {
    const [left, right] = active.parameters;
    const temporary = knownScalars.find(name => name !== left && name !== right &&
      new RegExp(`\\b(?:int|char)\\s+${name}\\s*;`).test(clean.slice(active.at, markerAt)));
    if (temporary) for (const array of arrayDeclarations.slice(0, 2)) {
      yield* emit(statement(`${temporary}=${array.name}[${left}];${array.name}[${left}]=${array.name}[${right}];${array.name}[${right}]=${temporary}`));
    }
  }

  // A helper's composition is often requested as a single statement blank.
  // Use parameters and numeric constants already printed in this source.
  if (standalone && active?.parameters.length === 1) {
    const parameter = active.parameters[0];
    const constants = [...new Set([...clean.matchAll(/\b\d{2,5}\b/g)].map(match => match[0]))].slice(0, 4);
    for (const helper of otherFunctions.filter(shape => shape.parameters.length === 1 && shape.result === 'void').slice(0, 3)) {
      for (const value of constants) {
        yield* emit(statement(`${helper.name}(${value});${helper.name}(${parameter});${helper.name}(${value})`));
        yield* emit(statement(`${helper.name}(${parameter});${helper.name}(${value});${helper.name}(${parameter})`));
      }
    }
  }

  // Complete a partial for-header using its printed array extent and the
  // multiplication in the loop body. This retains a bound below the extent.
  if (/\bfor\s*\(\s*$/.test(before) && /^\s*;/.test(after)) {
    const bodyProduct = /\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\*\s*([A-Za-z_]\w*)\s*\]/.exec(after);
    if (bodyProduct) {
      const [, array, factor, index] = bodyProduct;
      const capacity = arrayDeclarations.find(item => item.name === array)?.capacity;
      if (capacity && capacity > 2 && knownScalars.includes(factor) && knownScalars.includes(index)) {
        for (const initial of [2, 1, 0]) {
          yield* emit(`${index}=${initial};${index}<=${capacity - 1}/${factor}`);
          yield* emit(`${index}=${initial};${index}<${capacity}/${factor}`);
        }
      }
    }
  }

  // Combine a scalar accumulator with one visible single-argument helper.
  for (const helper of otherFunctions.filter(shape => shape.parameters.length === 1 && shape.result !== 'void').slice(0, 4)) {
    for (const index of knownScalars.slice(0, 8)) {
      const call = `${helper.name}(${index})`;
      yield* emit(call);
      for (const accumulator of knownScalars.slice(0, 8)) {
        if (accumulator === index) continue;
        yield* emit(`${accumulator}+${call}`);
        yield* emit(`${accumulator}-${call}`);
      }
    }
  }

  // Indexed expressions and arithmetic built only from visible arrays and
  // identifiers. Bounds and types are checked by the program runtime.
  const indices = knownScalars.filter(name => /^(?:i|j|k|x|y|idx|index|pos)$/.test(name)).slice(0, 5);
  for (const array of arrayDeclarations.slice(0, 3)) for (const index of indices) {
    yield* emit(`${array.name}[${index}]`);
    for (const offset of ['-1', '+1']) yield* emit(`${array.name}[${index}${offset}]`);
  }
  for (const left of indices) for (const right of indices) if (left !== right) {
    yield* emit(`${left}*${right}`);
    yield* emit(`${left}-${right}-1`);
  }
  if (/\b(?:abs|labs)\s*\(|#\s*include\s*<\s*(?:cstdlib|stdlib\.h|cmath|math\.h)\s*>/.test(source)) {
    for (const variable of knownScalars.slice(0, 3)) for (let center = 0; center <= 9; center++) {
      yield* emit(`abs(${variable}-${center})`);
      for (let peak = 1; peak <= 9; peak++) {
        yield* emit(`${peak}-abs(${variable}-${center})`);
        yield* emit(`${peak}+abs(${variable}-${center})`);
      }
    }
  }
  if (indices.length) {
    const bounds = [...new Set([...knownScalars.filter(name => /^(?:n|m|len|size)$/.test(name)),
      ...arrayDeclarations.map(item => String(item.capacity))])].slice(0, 4);
    for (const index of indices) for (const bound of bounds) {
      yield* emit(`(${index}+1)%${bound}`);
      yield* emit(`(${index}+${bound}-1)%${bound}`);
      yield* emit(`(${index}+${bound})%${bound}`);
    }
  }
  if (standalone) for (const index of indices) {
    for (const initial of ['0', '1', '2']) yield* emit(statement(`${index}=${initial}`));
  }
}
