import type { Question } from '../core/types';

type FunctionShape = { name: string; params: string[]; at: number };

function functions(source: string): FunctionShape[] {
  return [...source.matchAll(/\bdef\s+([A-Za-z_]\w*)\s*\(([^()]*)\)/g)].map(match => ({
    name: match[1], at: match.index!, params: match[2].split(',')
      .map(part => /^\s*([A-Za-z_]\w*)/.exec(part)?.[1] ?? '').filter(Boolean)
  }));
}

function cleanSource(source: string): string {
  return source.replace(/\{\{[^{}]+\}\}/g, ' ')
    .replace(/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
}

/** Python completions made solely from names, functions, and expression shapes printed in the question. */
export function* generatePythonStructuralCandidates(question: Question, blankId: string): Generator<string> {
  if (question.grading.kind !== 'program') return;
  const target = question.grading.targets.find(item => item.language === 'python');
  if (!target) return;
  const marker = `{{${blankId}}}`;
  const at = target.source.indexOf(marker);
  if (at < 0) return;
  const blank = question.blanks.find(item => item.id === blankId);
  const cap = Math.min(blank?.maxChars ?? 80, 100);
  const source = `${target.helperSource ?? ''}\n${target.source}`;
  const markerAt = source.indexOf(marker);
  const clean = cleanSource(source);
  const visible = clean.slice(0, markerAt);
  const shapes = functions(visible);
  const active = shapes.at(-1);
  const helpers = functions(clean).filter(item => item.name !== active?.name);
  const local = active ? visible.slice(active.at) : visible;
  const params = active?.params ?? [];
  const assignments = [...local.matchAll(/(?:^|\n)\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)/g)].map(match => match[1]);
  const loops = [...local.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+range\s*\(/g)].map(match => match[1]);
  const names = [...new Set([...params, ...assignments, ...loops])];
  const scalars = names.filter(name => !new RegExp(`\\b${name}\\s*:\\s*(?:list|str)\\b`).test(local)
    && !new RegExp(`\\b${name}\\s*=\\s*(?:\\[|list\\s*\\()`).test(local));
  const lists = [...new Set([
    ...[...local.matchAll(/\b([A-Za-z_]\w*)\s*:\s*list\s*\[/g)].map(match => match[1]),
    ...[...local.matchAll(/\b([A-Za-z_]\w*)\s*=\s*\[/g)].map(match => match[1]),
    ...[...local.matchAll(/\b([A-Za-z_]\w*)\s*=\s*list\s*\(/g)].map(match => match[1]),
    ...[...local.matchAll(/\b([A-Za-z_]\w*)\s*\[/g)].map(match => match[1]).filter(name => names.includes(name))
  ])];
  const strings = params.filter(name => new RegExp(`\\b${name}\\s*:\\s*str\\b`).test(local));
  const line = target.source.slice(target.source.lastIndexOf('\n', at - 1) + 1,
    target.source.indexOf('\n', at) < 0 ? undefined : target.source.indexOf('\n', at));
  const before = target.source.slice(0, at);
  const after = target.source.slice(at + marker.length);
  const standalone = line.trim() === marker;
  const seen = new Set<string>();
  function* emit(value: string): Generator<string> {
    const length = [...value].filter(char => !blank?.maxCharsExcludeWhitespace || !/\s/.test(char)).length;
    if (!value || value.includes('{{') || length > cap || seen.has(value)) return;
    if (blank?.forbiddenChars && [...value].some(char => blank.forbiddenChars!.includes(char))) return;
    if (blank?.allowedChars && [...value].some(char => !blank.allowedChars!.includes(char))) return;
    const identifiers: string[] = value.match(/[A-Za-z_]\w*/g) ?? [];
    if (blank?.forbiddenIdentifiers?.some(name => identifiers.includes(name))) return;
    seen.add(value); yield value;
  }

  // The arguments to a printed helper usually come from the surrounding loop.
  const call = /\b([A-Za-z_]\w*)\s*\(\s*$/.exec(before)?.[1];
  const helper = helpers.find(item => item.name === call);
  if (helper?.params.length === 2) {
    const near = [...loops].reverse().slice(0, 3);
    for (const index of near) for (const other of near) {
      if (index === other) continue;
      yield* emit(`${index},${other}`);
      yield* emit(`${other},${index}`);
      yield* emit(`${other},${other}+1`);
      yield* emit(`${other},${other}-1`);
      yield* emit(`${index},${index}+1`);
      yield* emit(`${index},${index}-1`);
    }
  }

  if (/\brange\s*\(\s*$/.test(before)) {
    for (const bound of scalars.slice(0, 8)) {
      for (const start of ['0', '1']) {
        yield* emit(`${start},${bound}`);
        yield* emit(`${start},${bound}+1`);
        yield* emit(`${start},${bound}-1`);
      }
    }
  }

  // A following two-dimensional access identifies the exact row and column
  // indices; derive its bounds from len(array) and len(array[0]).
  for (const access of [...after.matchAll(/\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]\s*\[\s*([A-Za-z_]\w*)\s*\]/g)].slice(0, 3)) {
    const [, array, row, col] = access;
    const rowBound = [...local.matchAll(/\b([A-Za-z_]\w*)\s*=\s*len\s*\(\s*([A-Za-z_]\w*)\s*\)/g)]
      .find(match => match[2] === array)?.[1];
    const colBound = [...local.matchAll(/\b([A-Za-z_]\w*)\s*=\s*len\s*\(\s*([A-Za-z_]\w*)\s*\[\s*0\s*\]\s*\)/g)]
      .find(match => match[2] === array)?.[1];
    if (rowBound && colBound) {
      yield* emit(`0<=${row}<${rowBound} and 0<=${col}<${colBound}`);
      yield* emit(`0<=${row} and ${row}<${rowBound} and 0<=${col} and ${col}<${colBound}`);
    }
  }

  // Reuse indices and adjacent elements visible in the source. Slices model
  // deletion, shift, and recursive list transformations without answer hints.
  const indices = [...new Set([...loops, ...scalars.filter(name => /^(?:i|j|k|l|r|idx|index|x|y)$/.test(name))])].slice(0, 6);
  const indexed: string[] = [];
  for (const array of lists.slice(0, 5)) {
    for (const index of ['0', '1', '-1', ...indices]) {
      indexed.push(`${array}[${index}]`);
      if (/^[A-Za-z_]\w*$/.test(index)) {
        indexed.push(`${array}[${index}-1]`, `${array}[${index}+1]`);
      }
    }
    for (const index of indices.slice(0, 4)) {
      yield* emit(`${array}[:${index}]+${array}[${index}+1:]`);
      yield* emit(`${array}[:${index}]+${array}[${index}+1]`);
      yield* emit(`${array}[${index}:]`);
      yield* emit(`${array}[:${index}]`);
    }
    for (const slice of [`${array}[1:]`, `${array}[:-1]`, `${array}[:1]`, `${array}[-1:]`]) yield* emit(slice);
  }
  for (const element of indexed) yield* emit(element);
  const receiver = /\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]\s*=\s*$/.exec(before);
  if (receiver && lists.includes(receiver[1])) {
    const [, array, index] = receiver;
    yield* emit(`${array}[${index}-1]+${array}[${index}]`);
    yield* emit(`${array}[${index}]+${array}[${index}-1]`);
    yield* emit(`${array}[${index}]-${array}[${index}-1]`);
    for (const other of lists.filter(name => name !== array).slice(0, 3)) {
      yield* emit(`${other}[${index}]-${other}[${index}-1]`);
      yield* emit(`${other}[${index}]+${other}[${index}-1]`);
    }
    // Generalize an already printed base-case product to adjacent indices.
    for (const base of [...local.matchAll(/\b([A-Za-z_]\w*)\s*\[\s*0\s*\]\s*=\s*([A-Za-z_]\w*)\s*\[\s*0\s*\]\s*\*\s*([A-Za-z_]\w*)\s*\[\s*0\s*\]/g)]) {
      if (base[1] !== array || !lists.includes(base[2]) || !lists.includes(base[3])) continue;
      const product = (offset: string) => `${base[2]}[${index}${offset}]*${base[3]}[${index}${offset}]`;
      yield* emit(`${product('')}-${product('-1')}`);
      yield* emit(`${product('')}+${product('-1')}`);
    }
  }

  // A nested array of dimensions n by m commonly needs both index bounds.
  for (const a of indices.slice(0, 4)) for (const b of indices.slice(0, 4)) {
    if (a === b) continue;
    if (new RegExp(`\\b${a}\\s*=\\s*${b}\\s*\\+`).test(local)) {
      for (const bound of scalars.filter(name => /^(?:n|m|K|N|M)$/.test(name)).slice(0, 3))
        yield* emit(`0<=${a}<${bound}`);
    }
  }
  const derived = [...local.matchAll(/\b([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\+\s*([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]/g)];
  for (const match of derived.slice(0, 4)) {
    const [, , left, array, index] = match;
    yield* emit(`${left}+${array}[${index}]`);
    yield* emit(`${left}-${array}[${index}]`);
  }
  if (lists.length >= 2 && indices.length) for (const index of indices.slice(0, 3)) {
    for (const a of lists.slice(0, 3)) for (const b of lists.slice(0, 3)) {
      if (a === b) continue;
      yield* emit(`${a}[${index}]*${b}[${index}]`);
      yield* emit(`${a}[${index}-1]*${b}[${index}]`);
    }
  }

  // Text transformations use the printed string parameter and leading
  // literal characters already present in the source.
  for (const name of strings) {
    yield* emit(`${name}[1:]`);
    yield* emit(`${name}[::-1]`);
    yield* emit(`${name}.lower()`);
    yield* emit(`${name}.upper()`);
    for (const literal of [...new Set([...source.matchAll(/["']([A-Za-z])["']/g)].map(match => match[0]))].slice(0, 6))
      yield* emit(`${literal}+${name}[1:]`);
  }

  // Standalone holes can mutate an indexed element or a string. The source
  // identifies the mutable receiver; the runtime checks bounds and effects.
  if (standalone) {
    for (const element of indexed.slice(0, 20)) {
      yield* emit(`${element}+=1`);
      yield* emit(`${element}+=${element.replace(/\[([^\]]+)\]$/, '[$1-1]')}`);
      for (const value of [...scalars.slice(0, 4), '0']) yield* emit(`${element}=${value}`);
    }
    for (const name of strings) for (const literal of [...new Set([...source.matchAll(/["']([A-Za-z])["']/g)].map(match => match[0]))].slice(0, 6))
      yield* emit(`${name}=${literal}+${name}[1:]`);
  }

  // The generic generator handles scalar grammar; this module concentrates
  // on collection and helper shapes that are expensive to discover there.
}
