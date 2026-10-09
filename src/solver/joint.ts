import type { EngineResult, Language, Observation, ProgramCase, ProgramTarget, Question } from '../core/types';
import { CheckedRuntime } from '../engines/cpp/runtime';
import { CppFault, parse } from '../engines/cpp/syntax';
import { tryRunFastPythonFunction } from '../engines/python/fast-function';
import { supportsFastPythonSource } from '../engines/python/program';
import { generateCandidates } from './candidates';
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

function scorePython(source: string, target: ProgramTarget, cases: ProgramCase[]): Score {
  if (!supportsFastPythonSource(source, target))
    return { passed: 0, viable: false, unsupported: false, complete: false };
  let passed = 0;
  for (const testCase of cases) {
    const result = tryRunFastPythonFunction(source, target, testCase);
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
  const pools = ids.map((id, index) => {
    const seen = new Set<string>();
    const pool: string[] = [];
    const add = (value: string) => {
      if (pool.length < poolCap && !seen.has(value) && allowed(value, blanks[index]!)) {
        seen.add(value); pool.push(value);
      }
    };
    if (request.knownAnswers?.[id]) add(request.knownAnswers[id]);
    const marker = target.source.indexOf(`{{${id}}}`);
    const before = marker < 0 ? '' : target.source.slice(Math.max(0, marker - 16), marker);
    // Periodic bit masks are useful when blanks feed a bitwise accumulator.
    // They are generated from a generic 8-bit pattern family, not answer keys.
    if (/(?:\||&|\^)\s*=\s*$/.test(before)) {
      for (const mask of [0, 1, 3, 7, 15, 31, 63, 127, 255, 85, 51, 17, 5, 170, 204, 34, 10]) add(String(mask));
    }
    for (const value of generateCandidates(question, id, language, request.strategy)) {
      add(value);
      if (pool.length >= poolCap) break;
    }
    return pool;
  });
  if (pools.some(pool => pool.length === 0)) return done('unsupported', 'No candidates fit one of the selected blanks.');
  if (language === 'python') {
    const probe = assemble(target, { ...request.knownAnswers, ...Object.fromEntries(ids.map(id => [id, '0'])) });
    if (probe.length > 200_000 || !supportsFastPythonSource(probe, target))
      return done('unsupported', 'This Python program needs a language feature outside the fast solver.');
  }
  const seen = new Set<string>();
  const promising: RankedAssignment[] = [];
  let anySupported = false;
  const cases = question.grading.cases;
  const evaluate = (indices: number[]): boolean => {
    const key = indices.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    const answers = { ...request.knownAnswers };
    ids.forEach((id, index) => { answers[id] = pools[index][indices[index]]; });
    const source = assemble(target, answers);
    generated++;
    const result = language === 'python' ? scorePython(source, target, cases) : scoreCpp(source, target, cases);
    if (!result.unsupported) anySupported = true;
    tested++;
    if (result.complete) {
      assignments.push(Object.fromEntries(ids.map(id => [id, answers[id]])));
      onProgress?.(progress());
    } else if (result.viable && result.passed > 0) {
      promising.push({ indices, score: result.passed });
      promising.sort((a, b) => b.score - a.score || a.indices.reduce((sum, n) => sum + n, 0) - b.indices.reduce((sum, n) => sum + n, 0));
      if (promising.length > 16) promising.length = 16;
    }
    return true;
  };
  const pauseIfNeeded = async (newTrial: boolean) => {
    if (newTrial && tested % 32 === 0) {
      onProgress?.(progress());
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  };
  // Fair rank-order traversal gives each blank's early and later candidates a
  // chance. Every 256 trials, use observations from real cases to search one
  // coordinate around promising assignments before returning to the diagonal.
  for (const indices of rankTuples(pools.map(pool => pool.length))) {
    if (isCancelled()) return done('cancelled');
    if (performance.now() - started >= maxMs || tested >= maxCandidates) return done('limit');
    await pauseIfNeeded(evaluate(indices));
    if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
    if (tested > 0 && tested % 256 === 0 && promising.length > 0) {
      for (const seed of promising.slice(0, 4)) {
        for (let dimension = 0; dimension < ids.length; dimension++) {
          for (let index = 0; index < pools[dimension].length; index++) {
            if (isCancelled()) return done('cancelled');
            if (performance.now() - started >= maxMs || tested >= maxCandidates) return done('limit');
            const neighbor = [...seed.indices];
            neighbor[dimension] = index;
            await pauseIfNeeded(evaluate(neighbor));
            if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
          }
        }
      }
    }
  }
  return done(anySupported ? 'complete' : 'unsupported', anySupported ? undefined : 'This program needs a language feature outside the solver.');
}
