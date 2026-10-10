import type { EngineResult, Language, Observation, ProgramCase, ProgramTarget, Question } from '../core/types';
import { CheckedRuntime } from '../engines/cpp/runtime';
import { CppFault, parse } from '../engines/cpp/syntax';
import { tryRunFastPythonFunction } from '../engines/python/fast-function';
import { pythonEnginePyodide } from '../engines/python';
import { supportsFastPythonSource } from '../engines/python/program';
import { classifyBlankContext, generateCandidates } from './candidates';
import { stateAwareAssignments } from './state-aware';
import type { SolveProgress, SolveRequest, SolveResult } from './types';

const DEFAULT_MAX_CANDIDATES = 12_000;
const DEFAULT_MAX_MS = 60_000;
const DEFAULT_MAX_RESULTS = 8;

function bound(value: number | undefined, fallback: number, ceiling: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, ceiling) : fallback;
}

function allowed(answer: string, blank: Question['blanks'][number]): boolean {
  if (!answer) return false;
  const length = [...answer].filter(char => !blank.maxCharsExcludeWhitespace || !/\s/.test(char)).length;
  if (blank.maxChars !== undefined && length > blank.maxChars) return false;
  if (blank.forbiddenChars && [...answer].some(char => blank.forbiddenChars!.includes(char))) return false;
  if (blank.allowedChars && [...answer].some(char => !blank.allowedChars!.includes(char))) return false;
  const identifiers: string[] = answer.match(/[A-Za-z_]\w*/g) ?? [];
  return !blank.forbiddenIdentifiers?.some(identifier => identifiers.includes(identifier));
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || !a || !b || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

function matches(actual: Observation, expected: Observation): boolean {
  return (!Object.hasOwn(expected, 'returnValue') || sameJson(actual.returnValue, expected.returnValue))
    && (expected.stdout === undefined || actual.stdout === expected.stdout)
    && (expected.argsAfter === undefined || sameJson(actual.argsAfter, expected.argsAfter));
}

function assemble(target: ProgramTarget, answers: Record<string, string>): string {
  const body = target.source.replace(/\{\{([^{}]+)\}\}/g, (_, id: string) => answers[id] ?? '');
  return target.helperSource ? `${target.helperSource}\n${body}` : body;
}

/** Put short in-scope expressions before compositions, regardless of generator order. */
function directCandidates(target: ProgramTarget, blankId: string): string[] {
  const marker = target.source.indexOf(`{{${blankId}}}`);
  if (marker < 0) return [];
  const prefix = target.source.slice(0, marker);
  const signatures = target.language === 'python'
    ? [...prefix.matchAll(/\bdef\s+[A-Za-z_]\w*\s*\(([^)]*)\)\s*(?:->[^:\n]+)?\s*:/g)]
    : [...prefix.matchAll(/\b(?:int|long\s+long|bool|char|double|float|string|void)\s+[A-Za-z_]\w*\s*\(([^)]*)\)\s*\{/g)];
  const signature = signatures.at(-1);
  const names: string[] = [];
  if (signature) {
    for (const parameter of signature[1].split(',')) {
      const name = target.language === 'python'
        ? /^\s*([A-Za-z_]\w*)/.exec(parameter)?.[1]
        : /([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*$/.exec(parameter)?.[1];
      if (name && name !== 'void') names.push(name);
    }
  }
  const body = prefix.slice(signature ? signature.index! + signature[0].length : 0);
  if (target.language === 'python') {
    for (const match of body.matchAll(/(?:^|\n)\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)/g)) names.push(match[1]);
    for (const match of body.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) names.push(match[1]);
  } else {
    for (const match of body.matchAll(/\b(?:int|long\s+long|bool|char|double|float|string|size_t)\s*(?:[&*]\s*)?([A-Za-z_]\w*)\b/g)) names.push(match[1]);
  }
  return [...new Set([...names, '1', '0', '2', '-1'])].slice(0, 24);
}

/** Canonicalize identities only for side-effect-free integral C/C++ expressions. */
function canonicalIntegralExpression(source: string, numericNames: Set<string>): string {
  const text = source.replace(/\s+/g, '');
  const atom = '(?:[A-Za-z_]\\w*|-?\\d+)';
  const binary = new RegExp(`^(${atom})([+*/-])(${atom})$`).exec(text);
  if (!binary) return text;
  const [, left, operator, right] = binary;
  const integral = (value: string) => /^-?\d+$/.test(value) || numericNames.has(value);
  if (!integral(left) || !integral(right)) return text;
  if (operator === '+' && right === '0' || operator === '-' && right === '0'
    || operator === '*' && right === '1' || operator === '/' && right === '1') return left;
  if (operator === '+' && left === '0' || operator === '*' && left === '1') return right;
  if (operator === '+' || operator === '*') return [left, right].sort().join(operator);
  return text;
}

/** Enumerate index vectors by total rank, so no blank's candidates monopolize the budget. */
function* rankTuples(lengths: number[]): Generator<number[]> {
  const tuple = Array<number>(lengths.length).fill(0);
  const maximum = lengths.reduce((sum, length) => sum + length - 1, 0);
  function* eachAt(position: number, remaining: number): Generator<number[]> {
    if (position === lengths.length - 1) {
      if (remaining < lengths[position]) { tuple[position] = remaining; yield [...tuple]; }
      return;
    }
    for (let index = 0; index <= Math.min(remaining, lengths[position] - 1); index++) {
      tuple[position] = index;
      yield* eachAt(position + 1, remaining - index);
    }
  }
  for (let sum = 0; sum <= maximum; sum++) yield* eachAt(0, sum);
}

type Score = { passed: number; viable: boolean; unsupported: boolean; complete: boolean };

function scoreCpp(source: string, target: ProgramTarget, cases: ProgramCase[]): Score {
  let unit: ReturnType<typeof parse>;
  try { unit = parse(source, target.language as 'cpp' | 'c'); }
  catch (error) {
    return { passed: 0, viable: false, unsupported: error instanceof CppFault && error.kind === 'unsupported', complete: false };
  }
  let passed = 0;
  for (const testCase of cases) {
    let result: EngineResult;
    try {
      const runtime = new CheckedRuntime(unit, target, testCase);
      result = { kind: 'ok', observation: runtime.run(), steps: runtime.stepCount };
    } catch (error) {
      result = error instanceof CppFault
        ? { kind: error.kind, message: error.message }
        : { kind: 'internal-error', message: error instanceof Error ? error.message : String(error) };
    }
    if (result.kind === 'unsupported' || result.kind === 'internal-error') return { passed, viable: true, unsupported: true, complete: false };
    if (result.kind === 'ok' && matches(result.observation, testCase.expectedByLanguage?.[target.language] ?? testCase.expected)) passed++;
  }
  return { passed, viable: true, unsupported: false, complete: passed === cases.length };
}

async function scorePython(source: string, target: ProgramTarget, cases: ProgramCase[], usePyodide: boolean): Promise<Score> {
  if (!usePyodide && !supportsFastPythonSource(source, target))
    return { passed: 0, viable: false, unsupported: false, complete: false };
  let passed = 0;
  for (const testCase of cases) {
    const result = usePyodide ? await pythonEnginePyodide.run(source, target, testCase)
      : tryRunFastPythonFunction(source, target, testCase);
    if (!result || result.kind === 'unsupported' || result.kind === 'internal-error')
      return { passed, viable: Boolean(result), unsupported: true, complete: false };
    if (result.kind === 'ok' && matches(result.observation, testCase.expectedByLanguage?.python ?? testCase.expected)) passed++;
  }
  return { passed, viable: true, unsupported: false, complete: passed === cases.length };
}

type RankedAssignment = { indices: number[]; score: number };

/** Search a shared source template for answers to two or more blanks. The search never reads answer keys. */
export async function solveJointBlanks(
  request: SolveRequest,
  onProgress?: (progress: SolveProgress) => void,
  isCancelled: () => boolean = () => false
): Promise<SolveResult> {
  const started = performance.now();
  const found: string[] = [];
  const assignments: Record<string, string>[] = [];
  let tested = 0;
  let generated = 0;
  const progress = (): SolveProgress => ({ tested, generated, found, assignments: [...assignments], elapsedMs: Math.round(performance.now() - started) });
  const done = (status: SolveResult['status'], message?: string): SolveResult => ({ ...progress(), status, message });
  const { question } = request;
  const ids = [...new Set(request.blankIds ?? [])];
  if (question.grading.kind !== 'program' || ids.length < 2) return done('unsupported', 'Select at least two program blanks.');
  const language: Language = request.language ?? question.grading.targets[0].language;
  const target = question.grading.targets.find(item => item.language === language);
  if (!target) return done('unsupported', `No ${language} target for this question.`);
  const blanks = ids.map(id => question.blanks.find(blank => blank.id === id));
  if (blanks.some(blank => !blank || !target.source.includes(`{{${blank.id}}}`)))
    return done('unsupported', 'A selected blank has no executable source template.');
  if (question.blanks.some(blank => !ids.includes(blank.id) && !request.knownAnswers?.[blank.id]))
    return done('unsupported', 'Fill the remaining blanks in this question first.');
  const maxCandidates = bound(request.maxCandidates, DEFAULT_MAX_CANDIDATES, 250_000);
  const maxMs = bound(request.maxMs, DEFAULT_MAX_MS, 300_000);
  const maxResults = bound(request.maxResults, DEFAULT_MAX_RESULTS, 50);
  // Larger arity has a much larger product. Rank diagonals still reach each
  // dimension, while these caps keep source generation and memory bounded.
  const poolCap = ids.length <= 2 ? 250 : ids.length === 3 ? 120 : 80;
  const numericNames = new Set(language === 'python' ? [] : [...target.source.matchAll(/\b(?:int|long\s+long|char|size_t)\s*(?:[&*]\s*)?([A-Za-z_]\w*)\b/g)].map(match => match[1]));
  const pools = ids.map((id, index) => {
    const seen = new Set<string>();
    const canonicalSeen = new Set<string>();
    const pool: string[] = [];
    const add = (value: string) => {
      const canonical = language === 'python' ? value : canonicalIntegralExpression(value, numericNames);
      if (pool.length < poolCap && !seen.has(value) && !canonicalSeen.has(canonical) && allowed(value, blanks[index]!)) {
        seen.add(value); canonicalSeen.add(canonical); pool.push(value);
      }
    };
    if (request.knownAnswers?.[id]) add(request.knownAnswers[id]);
    const markerAt = target.source.indexOf(`{{${id}}}`);
    const beforeSource = target.source.slice(0, markerAt);
    const afterSource = target.source.slice(markerAt + `{{${id}}}`.length);
    const controlHead = /^\s*\(/.test(afterSource) && /(?:^|\n)\s*$/.test(beforeSource);
    const marker = markerAt;
    const before = marker < 0 ? '' : target.source.slice(Math.max(0, marker - 16), marker);
    const guardedOr = /\bif\s+[A-Za-z_]\w*\s*&\s*(\d+)\s*:\s*\n\s*[A-Za-z_]\w*\s*\|=\s*$/.exec(beforeSource.slice(-120));
    if (guardedOr) {
      const weight = Number(guardedOr[1]);
      if (weight > 0 && weight <= 8 && (weight & (weight - 1)) === 0) {
        // Alternating groups of bits encode each set input bit as a run of
        // ones. The short 8-bit form is useful for bounded OR accumulators.
        let mask = 0;
        for (let bit = 0; bit < 8; bit++) if (Math.floor(bit / weight) % 2 === 0) mask += 2 ** bit;
        add(String(mask));
      }
    }
    // Periodic bit masks are useful when blanks feed a bitwise accumulator.
    // They are generated from a generic 8-bit pattern family, not answer keys.
    if (/(?:\||&|\^)\s*=\s*$/.test(before)) {
      for (const mask of [0, 1, 3, 7, 15, 31, 63, 127, 255, 85, 51, 17, 5, 170, 204, 34, 10]) add(String(mask));
    }
    if (classifyBlankContext(target.source, id) !== 'statement' && !controlHead)
      for (const value of directCandidates(target, id)) add(value);
    for (const value of generateCandidates(question, id, language, request.strategy)) {
      add(value);
      if (pool.length >= poolCap) break;
    }
    return pool;
  });
  if (pools.some(pool => pool.length === 0)) return done('unsupported', 'No candidates fit one of the selected blanks.');
  if (language === 'python' && request.pythonRuntime !== 'pyodide') {
    const probe = assemble(target, { ...request.knownAnswers, ...Object.fromEntries(ids.map(id => [id, '0'])) });
    if (probe.length > 200_000 || !supportsFastPythonSource(probe, target))
      return done('unsupported', 'This Python program needs a language feature outside the fast solver.');
  }
  const seen = new Set<string>();
  const seenAssignments = new Set<string>();
  const promising: RankedAssignment[] = [];
  let anySupported = false;
  const cases = question.grading.cases;
  const evaluateAnswers = async (answers: Record<string, string>, indices?: number[]): Promise<boolean> => {
    const key = JSON.stringify(ids.map(id => answers[id]));
    if (seen.has(key)) return false;
    seen.add(key);
    const source = assemble(target, answers);
    generated++;
    const result = language === 'python' ? await scorePython(source, target, cases, request.pythonRuntime === 'pyodide')
      : scoreCpp(source, target, cases);
    if (!result.unsupported) anySupported = true;
    tested++;
    if (result.complete) {
      const canonical = JSON.stringify(ids.map(id => language === 'python' ? answers[id]
        : canonicalIntegralExpression(answers[id], numericNames)));
      if (!seenAssignments.has(canonical)) {
        seenAssignments.add(canonical);
        assignments.push(Object.fromEntries(ids.map(id => [id, answers[id]])));
        onProgress?.(progress());
      }
    } else if (indices && result.viable && result.passed > 0) {
      promising.push({ indices, score: result.passed });
      promising.sort((a, b) => b.score - a.score || a.indices.reduce((sum, n) => sum + n, 0) - b.indices.reduce((sum, n) => sum + n, 0));
      if (promising.length > 16) promising.length = 16;
    }
    return true;
  };
  const evaluate = (indices: number[]): Promise<boolean> => {
    const answers = { ...request.knownAnswers };
    ids.forEach((id, index) => { answers[id] = pools[index][indices[index]]; });
    return evaluateAnswers(answers, indices);
  };
  const pauseIfNeeded = async (newTrial: boolean) => {
    if (newTrial && tested % 32 === 0) {
      onProgress?.(progress());
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  };
  // Shared expressions can fill two slots, but first give the ordinary rank
  // traversal a budget so this shortcut does not crowd out distinct answers.
  const shared = ids.length === 2 && maxCandidates >= 200
    ? pools[0].map((value, first) => ({ first, second: pools[1].indexOf(value) }))
      .filter(item => item.second >= 0)
      .sort((a, b) => Math.max(a.first, a.second) - Math.max(b.first, b.second)
        || a.first + a.second - b.first - b.second)
      .slice(0, 64) : [];
  let sharedDone = false;
  let stateDone = false;
  // Fair rank-order traversal gives each blank's early and later candidates a
  // chance. Every 256 trials, use observations from real cases to search one
  // coordinate around promising assignments before returning to the diagonal.
  for (const indices of rankTuples(pools.map(pool => pool.length))) {
    if (isCancelled()) return done('cancelled');
    if (performance.now() - started >= maxMs || tested >= maxCandidates) return done('limit');
    await pauseIfNeeded(await evaluate(indices));
    if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
    if (!stateDone && tested >= 128 && request.pythonRuntime !== 'pyodide' && request.maxMs !== undefined && maxMs >= 5_000 && maxCandidates >= 500) {
      stateDone = true;
      const seeds = promising.slice(0, 2).map(item => item.indices);
      if (!seeds.length) seeds.push(Array(ids.length).fill(0));
      for (const seed of seeds) {
        if (isCancelled()) return done('cancelled');
        const anchors = { ...request.knownAnswers, ...Object.fromEntries(ids.map((id, index) => [id, pools[index][seed[index]]])) };
        const guided = await stateAwareAssignments(question, language, ids, anchors, {
          maxRuns: Math.min(100, Math.floor(maxCandidates / 10)),
          deadline: performance.now() + Math.min((maxMs - (performance.now() - started)) * 0.3, 5_000),
          isCancelled
        });
        for (const answers of guided) {
          if (isCancelled()) return done('cancelled');
          if (performance.now() - started >= maxMs || tested >= maxCandidates) return done('limit');
          await pauseIfNeeded(await evaluateAnswers(answers));
          if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
        }
      }
    }
    if (!sharedDone && shared.length && tested >= 128) {
      sharedDone = true;
      for (const pair of shared) {
        if (isCancelled()) return done('cancelled');
        if (performance.now() - started >= maxMs || tested >= maxCandidates) return done('limit');
        await pauseIfNeeded(await evaluate([pair.first, pair.second]));
        if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
      }
    }
    if (tested > 0 && tested % 256 === 0 && promising.length > 0) {
      for (const seed of promising.slice(0, 4)) {
        for (let dimension = 0; dimension < ids.length; dimension++) {
          for (let index = 0; index < pools[dimension].length; index++) {
            if (isCancelled()) return done('cancelled');
            if (performance.now() - started >= maxMs || tested >= maxCandidates) return done('limit');
            const neighbor = [...seed.indices];
            neighbor[dimension] = index;
            await pauseIfNeeded(await evaluate(neighbor));
            if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
          }
        }
      }
    }
  }
  return done(anySupported ? 'complete' : 'unsupported', anySupported ? undefined : 'This program needs a language feature outside the solver.');
}
