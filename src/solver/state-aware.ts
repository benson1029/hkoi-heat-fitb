import type { Blank, EngineResult, Language, Observation, ProgramCase, ProgramTarget, Question } from '../core/types';
import { probeName, type ProbeState, type ProbeValue } from '../core/probe';
import { CheckedRuntime } from '../engines/cpp/runtime';
import { parse } from '../engines/cpp/syntax';
import { supportsFastPythonSource, tryRunPythonProgram } from '../engines/python/program';
import { classifyBlankContext } from './candidates';

type Visit = ProbeState & { choice: number | boolean; branchIndex?: number };
type Run = { visits: Visit[]; distance: number; passed: boolean };
type Sample = { variables: Record<string, ProbeValue>; wanted: boolean };
type Term = { text: string; read: (variables: Record<string, ProbeValue>) => number | undefined };
type Choice = { text: string; evaluate: (variables: Record<string, ProbeValue>) => number | boolean | undefined };
type Predicate = { text: string; values: (boolean | undefined)[]; errors: number;
  evaluate: (variables: Record<string, ProbeValue>) => boolean | undefined };

function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => sameJson(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

function expectedFor(testCase: ProgramCase, language: Language): Observation {
  return testCase.expectedByLanguage?.[language] ?? testCase.expected;
}

function matches(actual: Observation, expected: Observation): boolean {
  return (!Object.hasOwn(expected, 'returnValue') || sameJson(actual.returnValue, expected.returnValue))
    && (expected.stdout === undefined || actual.stdout === expected.stdout)
    && (expected.argsAfter === undefined || sameJson(actual.argsAfter, expected.argsAfter));
}

function editDistance(a: string[], b: string[]): number {
  if (a.length > 128 || b.length > 128) return Math.abs(a.length - b.length) * 3 +
    a.slice(0, 128).filter((word, index) => word !== b[index]).length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(
      next[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    previous = next;
  }
  return previous[b.length];
}

function distance(result: EngineResult | undefined, expected: Observation): number {
  if (!result || result.kind !== 'ok') return 10_000;
  const actual = result.observation;
  if (matches(actual, expected)) return 0;
  let score = 0;
  if (Object.hasOwn(expected, 'returnValue') && !sameJson(actual.returnValue, expected.returnValue)) {
    if (typeof actual.returnValue === 'number' && typeof expected.returnValue === 'number')
      score += Math.min(1_000, Math.abs(actual.returnValue - expected.returnValue)) + 1;
    else score += 20;
  }
  if (expected.stdout !== undefined && actual.stdout !== expected.stdout) {
    const words = (text: string) => text.trim() ? text.trim().split(/\s+/) : [];
    score += editDistance(words(actual.stdout ?? ''), words(expected.stdout)) + 1;
  }
  if (expected.argsAfter !== undefined && !sameJson(actual.argsAfter, expected.argsAfter)) score += 20;
  return score;
}

function instrument(target: ProgramTarget, probeIds: string[], anchors: Record<string, string>): string {
  const selected = new Set(probeIds);
  const body = target.source.replace(/\{\{([^{}]+)\}\}/g, (_marker, id: string) =>
    selected.has(id) ? `${probeName(id)}()` : anchors[id] ?? '0');
  return target.helperSource ? `${target.helperSource}\n${body}` : body;
}

function snapshotRun(target: ProgramTarget, testCase: ProgramCase, source: string,
  cppUnit: ReturnType<typeof parse> | undefined, branchIds: Set<string>, overrides: Map<number, boolean>, defaultChoice: boolean,
  policy?: (state: ProbeState) => number | boolean | undefined): Run {
  const visits: Visit[] = [];
  let ordinal = 0;
  const probe = (state: ProbeState): number => {
    const branchIndex = branchIds.has(state.blankId) ? ordinal++ : undefined;
    const choice = policy ? policy(state) ?? 0 : branchIndex === undefined ? Number(defaultChoice)
      : overrides.get(branchIndex) ?? defaultChoice;
    if (visits.length < 512) visits.push({ ...state, choice, branchIndex });
    return typeof choice === 'boolean' ? Number(choice) : choice;
  };
  let result: EngineResult | undefined;
  if (cppUnit) {
    try {
      const runtime = new CheckedRuntime(cppUnit, target, testCase, probe);
      result = { kind: 'ok', observation: runtime.run(), steps: runtime.stepCount };
    } catch { result = undefined; }
  } else result = tryRunPythonProgram(source, target, testCase, probe);
  const expected = expectedFor(testCase, target.language);
  return { visits, distance: distance(result, expected), passed: Boolean(result?.kind === 'ok' && matches(result.observation, expected)) };
}

function truth(value: number | undefined): boolean | undefined { return value === undefined ? undefined : value !== 0; }
function scalar(value: ProbeValue | undefined): number | undefined {
  if (typeof value === 'boolean') return Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function numericTerms(samples: Sample[], source: string, blankId: string, language: Language): Term[] {
  const marker = source.indexOf(`{{${blankId}}}`);
  const nearby = source.slice(Math.max(0, marker - 150), marker + 150);
  const names = [...new Set(samples.flatMap(sample => Object.keys(sample.variables)))].filter(name =>
    samples.every(sample => scalar(sample.variables[name]) !== undefined))
    .sort((a, b) => Number(nearby.includes(b)) - Number(nearby.includes(a)) || a.length - b.length).slice(0, 12);
  const terms: Term[] = names.map(name => ({ text: name, read: variables => scalar(variables[name]) }));
  const numbers = [...new Set([0, 1, 2, -1, ...[...source.matchAll(/(?<![\w.])-?\d+(?![\w.])/g)]
    .map(match => Number(match[0])).filter(value => value >= -9 && value <= 20).slice(0, 8)])];
  for (const number of numbers) terms.push({ text: String(number), read: () => number });
  for (const name of names.slice(0, 8)) {
    for (const offset of [-1, 1]) terms.push({ text: `${name}${offset < 0 ? '' : '+'}${offset}`,
      read: variables => { const value = scalar(variables[name]); return value === undefined ? undefined : value + offset; } });
    terms.push({ text: `${name}/2`, read: variables => {
      const value = scalar(variables[name]); return value === undefined ? undefined
        : language === 'python' ? value / 2 : Math.trunc(value / 2);
    } });
    terms.push({ text: `${name}*2`, read: variables => {
      const value = scalar(variables[name]); return value === undefined || !Number.isSafeInteger(value * 2)
        ? undefined : value * 2;
    } });
  }
  for (const left of names.slice(0, 6)) for (const right of names.slice(0, 6)) {
    if (left === right) continue;
    for (const op of ['+', '-'] as const) terms.push({ text: `${left}${op}${right}`, read: variables => {
      const a = scalar(variables[left]), b = scalar(variables[right]);
      if (a === undefined || b === undefined) return undefined;
      const value = op === '+' ? a + b : a - b;
      return Number.isSafeInteger(value) ? value : undefined;
    } });
    terms.push({ text: `${left}%${right}`, read: variables => {
      const a = scalar(variables[left]), b = scalar(variables[right]);
      if (a === undefined || b === undefined || b === 0) return undefined;
      return language === 'python' ? ((a % b) + b) % b : a % b;
    } });
  }
  const arrays = [...new Set(samples.flatMap(sample => Object.entries(sample.variables)
    .filter(([, value]) => Array.isArray(value)).map(([name]) => name)))].slice(0, 3);
  for (const array of arrays) for (const index of names.slice(0, 7)) {
    terms.push({ text: `${array}[${index}]`, read: variables => {
      const values = variables[array], position = scalar(variables[index]);
      if (!Array.isArray(values) || position === undefined) return undefined;
      const at = language === 'python' && position < 0 ? values.length + position : position;
      return at >= 0 && at < values.length ? scalar(values[at]) : undefined;
    } });
  }
  return terms.filter(term => term.text.length <= 28).slice(0, 120);
}

function predicateScore(values: (boolean | undefined)[], samples: Sample[]): number {
  return values.reduce((score, value, index) => score + (value === undefined ? 2 : Number(value !== samples[index].wanted)), 0);
}

function fits(text: string, blank: Blank): boolean {
  const length = [...text].filter(char => !blank.maxCharsExcludeWhitespace || !/\s/.test(char)).length;
  return (blank.maxChars === undefined || length <= blank.maxChars)
    && (!blank.forbiddenChars || [...text].every(char => !blank.forbiddenChars!.includes(char)))
    && (!blank.allowedChars || [...text].every(char => blank.allowedChars!.includes(char)));
}

function synthesize(samples: Sample[], source: string, blankId: string, language: Language, blank: Blank):
  { ranked: Predicate[]; atoms: Predicate[] } {
  if (!samples.length) return { ranked: [], atoms: [] };
  const terms = numericTerms(samples, source, blankId, language);
  const predicates: Predicate[] = [];
  const add = (text: string, evaluate: Predicate['evaluate']) => {
    const values = samples.map(sample => evaluate(sample.variables));
    if (fits(text, blank) && values.some(value => value !== undefined))
      predicates.push({ text, values, errors: predicateScore(values, samples), evaluate });
  };
  for (const term of terms) add(term.text, variables => truth(term.read(variables)));
  const comparisons = ['==', '!=', '<', '<=', '>', '>='];
  const basic = terms.slice(0, 28);
  const constants = terms.filter(term => /^-?\d+$/.test(term.text)).slice(0, 7);
  const derived = terms.filter(term => !basic.includes(term));
  const pairs: [Term, Term][] = [];
  for (const left of basic) for (const right of [...basic, ...constants])
    if (left.text !== right.text && !(/^-?\d+$/.test(left.text) && /^-?\d+$/.test(right.text))) pairs.push([left, right]);
  for (const left of derived) for (const right of [...basic.slice(0, 12), ...constants])
    if (left.text !== right.text) pairs.push([left, right]);
  for (const [left, right] of pairs) for (const op of comparisons) {
    const text = `${left.text}${op}${right.text}`;
    if (!fits(text, blank)) continue;
    add(text, variables => {
      const a = left.read(variables), b = right.read(variables);
      if (a === undefined || b === undefined) return undefined;
      switch (op) {
        case '==': return a === b;
        case '!=': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        default: return a >= b;
      }
    });
  }
  // Truth vectors are a ranking cache for this probe batch only. The ordinary
  // grammar search remains independent, so later states cannot erase answers.
  const byVector = new Map<string, Predicate>();
  for (const predicate of predicates) {
    const key = predicate.values.map(value => value === undefined ? '?' : Number(value)).join('');
    const previous = byVector.get(key);
    if (!previous || predicate.text.length < previous.text.length) byVector.set(key, predicate);
  }
  const allAtoms = [...byVector.values()].sort((a, b) => a.errors - b.errors || a.text.length - b.text.length);
  const shortAtoms = [...allAtoms].sort((a, b) => a.text.length - b.text.length || a.errors - b.errors);
  const structuralAtoms = shortAtoms.filter(item => /[%\[]/.test(item.text));
  const atoms: Predicate[] = [];
  const atomTexts = new Set<string>();
  for (let index = 0; atoms.length < 180 && index < allAtoms.length; index++) {
    for (const item of [allAtoms[index], shortAtoms[index], structuralAtoms[index]]) {
      if (item && !atomTexts.has(item.text)) { atomTexts.add(item.text); atoms.push(item); }
    }
  }
  const compound: Predicate[] = [];
  const combine = (a: Predicate, b: Predicate, op: 'and' | 'or') => {
    const joiner = language === 'python' ? ` ${op} ` : op === 'and' ? '&&' : '||';
    const text = `${a.text}${joiner}${b.text}`;
    if (!fits(text, blank)) return;
    const evaluate: Predicate['evaluate'] = variables => {
      const left = a.evaluate(variables), right = b.evaluate(variables);
      if (op === 'and') return left === false || right === false ? false
        : left === undefined || right === undefined ? undefined : true;
      return left === true || right === true ? true
        : left === undefined || right === undefined ? undefined : false;
    };
    const values = samples.map(sample => evaluate(sample.variables));
    compound.push({ text, values, errors: predicateScore(values, samples), evaluate });
  };
  const compositionAtoms = atoms.slice(0, 35);
  for (let i = 0; i < compositionAtoms.length; i++) for (let j = i + 1; j < compositionAtoms.length; j++) {
    combine(compositionAtoms[i], compositionAtoms[j], 'and'); combine(compositionAtoms[i], compositionAtoms[j], 'or');
  }
  const ranked = [...atoms, ...compound].sort((a, b) => a.errors - b.errors || a.text.length - b.text.length);
  const seen = new Set<string>();
  const results: Predicate[] = [];
  for (const item of ranked) {
    if (seen.has(item.text)) continue;
    seen.add(item.text); results.push(item);
    if (results.length >= 32) break;
  }
  return { ranked: results, atoms };
}

/** Instrument selected expression sites together; use statement answers as anchors. */
export async function stateAwareAssignments(question: Question, language: Language, selectedIds: string[],
  anchors: Record<string, string>, options: { maxRuns: number; deadline: number; isCancelled?: () => boolean }): Promise<Record<string, string>[]> {
  if (question.grading.kind !== 'program') return [];
  const target = question.grading.targets.find(item => item.language === language);
  if (!target) return [];
  const cases = question.grading.cases;
  const probeIds = selectedIds.filter(id => classifyBlankContext(target.source, id) !== 'statement');
  const conditionIds = probeIds.filter(id => classifyBlankContext(target.source, id) === 'condition');
  const branchIds = new Set(conditionIds);
  if (!probeIds.length || probeIds.some(id => !/^[A-Za-z_]\w*$/.test(id))) return [];
  if (probeIds.some(id => `${target.helperSource ?? ''}\n${target.source}`.includes(probeName(id)))) return [];
  const source = instrument(target, probeIds, anchors);
  let cppUnit: ReturnType<typeof parse> | undefined;
  if (language === 'python') {
    if (!supportsFastPythonSource(source, target)) return [];
  } else {
    try { cppUnit = parse(source, language); } catch { return []; }
  }
  const samples = new Map(probeIds.map(id => [id, [] as Sample[]]));
  let runs = 0;
  for (const testCase of cases) {
    if (runs >= options.maxRuns || performance.now() >= options.deadline || options.isCancelled?.()) break;
    let best: Run | undefined;
    for (const defaultChoice of [false, true]) {
      if (runs >= options.maxRuns || performance.now() >= options.deadline || options.isCancelled?.()) break;
      let overrides = new Map<number, boolean>();
      let current = snapshotRun(target, testCase, source, cppUnit, branchIds, overrides, defaultChoice); runs++;
      if (!best || current.distance < best.distance) best = current;
      for (let round = 0; round < 12 && !current.passed && branchIds.size > 0; round++) {
        if (runs >= options.maxRuns || performance.now() >= options.deadline || options.isCancelled?.()) break;
        let improved: { run: Run; overrides: Map<number, boolean> } | undefined;
        const indices = current.visits.flatMap(visit => visit.branchIndex === undefined ? [] : [visit.branchIndex]).slice(0, 24);
        for (const index of indices) {
          if (runs >= options.maxRuns || performance.now() >= options.deadline || options.isCancelled?.()) break;
          const variant = new Map(overrides);
          const previous = current.visits.find(visit => visit.branchIndex === index)!;
          variant.set(index, !Boolean(previous.choice));
          const run = snapshotRun(target, testCase, source, cppUnit, branchIds, variant, defaultChoice); runs++;
          if (runs % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
          if (!improved || run.distance < improved.run.distance) improved = { run, overrides: variant };
          if (run.passed) break;
        }
        if (!improved || improved.run.distance >= current.distance) break;
        current = improved.run; overrides = improved.overrides;
        if (!best || current.distance < best.distance) best = current;
      }
      if (best?.passed) break;
    }
    if (best) for (const id of probeIds) {
      const visits = best.visits.filter(visit => visit.blankId === id);
      const perCase = Math.max(8, Math.floor(256 / cases.length));
      const stride = Math.max(1, Math.ceil(visits.length / perCase));
      for (let index = 0; index < visits.length; index += stride) {
        const visit = visits[index];
        samples.get(id)!.push({ variables: visit.variables, wanted: Boolean(visit.choice) });
      }
    }
  }
  if (options.isCancelled?.()) return [];
  const synthesized = new Map(probeIds.map(id => [id, synthesize(samples.get(id) ?? [], target.source, id, language,
    question.blanks.find(blank => blank.id === id)!)]));
  const pools = conditionIds.map(id => synthesized.get(id)!.ranked.map(predicate => predicate.text));
  if (probeIds.some(id => !samples.get(id)?.length) || pools.some(pool => !pool.length)) return [];
  const candidateSources = new Map(probeIds.map(id => {
    const blank = question.blanks.find(item => item.id === id)!;
    if (branchIds.has(id)) return [id, synthesized.get(id)!.atoms as Choice[]] as const;
    const terms: Choice[] = numericTerms(samples.get(id)!, target.source, id, language)
      .filter(term => fits(term.text, blank)).map(term => ({ text: term.text, evaluate: term.read }));
    const used = new Set(terms.map(term => term.text));
    return [id, [...terms, ...synthesized.get(id)!.atoms.filter(item => !used.has(item.text))] as Choice[]] as const;
  }));
  const falsePredicate: Predicate = { text: '0', values: [], errors: 0, evaluate: () => false };
  const maxProgramChecks = Math.min(600, Math.max(80, options.maxRuns * 3));
  let programChecks = 0;
  const evaluated = new Map<string, number>();
  const scorePolicy = (policy: Record<string, Choice>): number => {
    const key = JSON.stringify(probeIds.map(id => policy[id]?.text ?? '0'));
    const cached = evaluated.get(key);
    if (cached !== undefined) return cached;
    if (programChecks >= maxProgramChecks || performance.now() >= options.deadline) return Infinity;
    programChecks++;
    let score = 0;
    for (const testCase of cases) {
      const result = snapshotRun(target, testCase, source, cppUnit, branchIds, new Map(), false, state =>
        policy[state.blankId]?.evaluate(state.variables) ?? 0);
      score += result.distance;
    }
    evaluated.set(key, score);
    return score;
  };
  const bestByBlank = new Map<string, { predicate: Choice; score: number }[]>();
  for (const id of probeIds) {
    const choices: { predicate: Choice; score: number }[] = [];
    const reference = Object.fromEntries([...bestByBlank].map(([otherId, items]) => [otherId, items[0]?.predicate ?? falsePredicate]));
    for (const predicate of candidateSources.get(id) ?? []) {
      if (programChecks >= maxProgramChecks || performance.now() >= options.deadline || options.isCancelled?.()) break;
      choices.push({ predicate, score: scorePolicy({ ...reference, [id]: predicate }) });
      if (programChecks % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const errors = (choice: Choice) => 'errors' in choice ? (choice as Predicate).errors : 0;
    choices.sort((a, b) => a.score - b.score || errors(a.predicate) - errors(b.predicate)
      || a.predicate.text.length - b.predicate.text.length);
    bestByBlank.set(id, choices.slice(0, 12));
  }
  const combine = (left: Predicate, right: Predicate, op: 'and' | 'or', blank: Blank): Predicate | undefined => {
    const joiner = language === 'python' ? ` ${op} ` : op === 'and' ? '&&' : '||';
    const text = `${left.text}${joiner}${right.text}`;
    if (!fits(text, blank)) return undefined;
    const evaluate: Predicate['evaluate'] = variables => {
      const a = left.evaluate(variables), b = right.evaluate(variables);
      if (op === 'and') return a === false || b === false ? false : a === undefined || b === undefined ? undefined : true;
      return a === true || b === true ? true : a === undefined || b === undefined ? undefined : false;
    };
    return { text, evaluate, values: [], errors: 0 };
  };
  for (const id of conditionIds) {
    const leaders = bestByBlank.get(id) ?? [];
    const atoms = synthesized.get(id)!.atoms;
    const short = [...atoms].sort((a, b) => a.text.length - b.text.length || a.errors - b.errors);
    const ordered: Predicate[] = [];
    for (let index = 0; index < Math.max(atoms.length, short.length); index++) {
      if (atoms[index]) ordered.push(atoms[index]);
      if (short[index]) ordered.push(short[index]);
    }
    const seen = new Set<string>();
    const other = Object.fromEntries(probeIds.filter(otherId => otherId !== id)
      .map(otherId => [otherId, bestByBlank.get(otherId)?.[0]?.predicate ?? falsePredicate]));
    const blank = question.blanks.find(item => item.id === id)!;
    for (const leader of leaders.slice(0, 5)) for (const atom of ordered) for (const op of ['and', 'or'] as const) {
      if (programChecks >= maxProgramChecks || performance.now() >= options.deadline || options.isCancelled?.()) break;
      if (leader.predicate.text === atom.text) continue;
      const predicate = combine(leader.predicate as Predicate, atom, op, blank);
      if (!predicate || seen.has(predicate.text)) continue;
      seen.add(predicate.text);
      const score = scorePolicy({ ...other, [id]: predicate });
      if (programChecks % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      leaders.push({ predicate, score });
      leaders.sort((a, b) => a.score - b.score || a.predicate.text.length - b.predicate.text.length);
      if (leaders.length > 16) leaders.length = 16;
    }
    bestByBlank.set(id, leaders);
  }
  const guided: Record<string, string>[] = [];
  const bestPools = probeIds.map(id => bestByBlank.get(id)?.slice(0, 8).map(item => item.predicate) ?? []);
  const choose = (at: number, policy: Record<string, Choice>) => {
    if (guided.length >= 32 || performance.now() >= options.deadline) return;
    if (at === probeIds.length) {
      if (scorePolicy(policy) === 0) guided.push({ ...anchors,
        ...Object.fromEntries(probeIds.map(id => [id, policy[id].text])) });
      return;
    }
    for (const predicate of bestPools[at]) choose(at + 1, { ...policy, [probeIds[at]]: predicate });
  };
  choose(0, {});
  if (options.isCancelled?.()) return [];
  const assignments: Record<string, string>[] = [];
  const indices = Array(pools.length).fill(0);
  for (let sum = 0; conditionIds.length > 0 && sum <= pools.reduce((total, pool) => total + pool.length - 1, 0)
      && assignments.length < 128; sum++) {
    const visit = (at: number, remaining: number) => {
      if (assignments.length >= 128) return;
      if (at === pools.length) {
        if (remaining === 0) assignments.push({ ...anchors,
          ...Object.fromEntries(conditionIds.map((id, index) => [id, pools[index][indices[index]]])) });
        return;
      }
      for (let index = 0; index < pools[at].length && index <= remaining; index++) {
        indices[at] = index; visit(at + 1, remaining - index);
      }
    };
    visit(0, sum);
  }
  const seen = new Set<string>();
  return [...guided, ...assignments].filter(assignment => {
    if (selectedIds.some(id => typeof assignment[id] !== 'string')) return false;
    const key = JSON.stringify(probeIds.map(id => assignment[id]));
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 128);
}
