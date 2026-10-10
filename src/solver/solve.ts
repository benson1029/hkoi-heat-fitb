import type { Language } from '../core/types';
import { tryRunFastPythonFunction } from '../engines/python/fast-function';
import { pythonEnginePyodide } from '../engines/python';
import { supportsFastPythonSource } from '../engines/python/program';
import { parse } from '../engines/cpp/syntax';
import { CheckedRuntime } from '../engines/cpp/runtime';
import { classifyBlankContext, generateCandidates } from './candidates';
import { solveJointBlanks } from './joint';
import { solveExhaustive } from './exhaustive';
import { stateAwareAssignments } from './state-aware';
import type { SolveProgress, SolveRequest, SolveResult } from './types';

const DEFAULT_MAX_CANDIDATES = 1200;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MAX_MS = 8000;

function bound(value: number | undefined, fallback: number, ceiling: number): number {
  return Number.isSafeInteger(value) && value! > 0 ? Math.min(value!, ceiling) : fallback;
}

function answerAllowed(answer: string, blank: SolveRequest['question']['blanks'][number]): boolean {
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

function assemble(source: string, answers: Record<string, string>): string {
  return source.replace(/\{\{([^{}]+)\}\}/g, (_, blankId: string) => answers[blankId] ?? '');
}

/** Solves only a single program blank. It never consults answer sheets or accepted-answer lists. */
export async function solveProgramBlank(
  request: SolveRequest,
  onProgress?: (progress: SolveProgress) => void,
  isCancelled: () => boolean = () => false
): Promise<SolveResult> {
  const started = performance.now();
  const { question } = request;
  const blankId = request.blankId ?? request.blankIds?.[0];
  const found: string[] = [];
  let tested = 0;
  let generated = 0;
  const progress = (): SolveProgress => ({ tested, generated, found: [...found], elapsedMs: Math.round(performance.now() - started) });
  const done = (status: SolveResult['status'], message?: string): SolveResult => ({ ...progress(), status, message });
  if (question.grading.kind !== 'program') return done('unsupported', 'Automatic search currently supports program questions.');
  if (!blankId) return done('unsupported', 'Select a blank to search.');
  const blank = question.blanks.find(item => item.id === blankId);
  if (!blank || !question.grading.targets.some(target => target.source.includes(`{{${blankId}}}`)))
    return done('unsupported', 'This blank has no executable source template.');
  if (question.blanks.some(item => item.id !== blankId && !request.knownAnswers?.[item.id]))
    return done('unsupported', 'Fill the other blanks in this question first.');
  const language: Language = request.language ?? question.grading.targets[0].language;
  if (!question.grading.targets.some(target => target.language === language)) return done('unsupported', `No ${language} target for this question.`);
  const maxCandidates = bound(request.maxCandidates, DEFAULT_MAX_CANDIDATES, 250_000);
  const maxResults = bound(request.maxResults, DEFAULT_MAX_RESULTS, 50);
  const maxMs = bound(request.maxMs, DEFAULT_MAX_MS, 300_000);
  const answers = { ...request.knownAnswers };
  const pythonTarget = language === 'python' ? question.grading.targets.find(target => target.language === 'python') : undefined;
  const cppTarget = language !== 'python' ? question.grading.targets.find(target => target.language === language) : undefined;
  if (pythonTarget && pythonTarget.source.length + (pythonTarget.helperSource?.length ?? 0) > 200_000)
    return done('unsupported', 'Python source is too large for automatic search.');
  if (pythonTarget && request.pythonRuntime !== 'pyodide') {
    const context = classifyBlankContext(pythonTarget.source, blankId);
    const neutral = context === 'statement' ? 'pass' : context === 'condition' ? 'True' : '0';
    const probe = `${pythonTarget.helperSource ? `${pythonTarget.helperSource}\n` : ''}${assemble(pythonTarget.source, { ...answers, [blankId]: neutral })}`;
    if (!supportsFastPythonSource(probe, pythonTarget))
      return done('unsupported', 'This Python program needs the full runtime; automatic search supports the fast subset only.');
  }
  const guided = request.pythonRuntime !== 'pyodide' && request.maxMs !== undefined && maxMs >= 5_000 && maxCandidates >= 500
    ? (await stateAwareAssignments(question, language, [blankId], answers, {
      maxRuns: Math.min(160, Math.floor(maxCandidates / 4)),
      deadline: started + Math.min(maxMs * 0.5, 6_000), isCancelled
    })).map(assignment => assignment[blankId]) : [];
  const candidates = function* (): Generator<string> {
    const seen = new Set<string>();
    for (const candidate of guided) if (!seen.has(candidate)) { seen.add(candidate); yield candidate; }
    for (const candidate of generateCandidates(question, blankId, language, request.strategy))
      if (!seen.has(candidate)) { seen.add(candidate); yield candidate; }
  };
  for (const candidate of candidates()) {
    generated++;
    if (generated % 25 === 0) {
      onProgress?.(progress());
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (isCancelled()) return done('cancelled');
    if (performance.now() - started >= maxMs) return done(tested === 0 && pythonTarget ? 'unsupported' : 'limit',
      tested === 0 && pythonTarget ? 'This Python program needs the full runtime.' : undefined);
    if (!answerAllowed(candidate, blank)) continue;
    if (tested >= maxCandidates) return done('limit');
    answers[blankId] = candidate;
    let passed = false;
    if (pythonTarget) {
      const source = `${pythonTarget.helperSource ? `${pythonTarget.helperSource}\n` : ''}${assemble(pythonTarget.source, answers)}`;
      let supported = true;
      passed = true;
      for (const testCase of question.grading.cases) {
        const result = request.pythonRuntime === 'pyodide'
          ? await pythonEnginePyodide.run(source, pythonTarget, testCase)
          : tryRunFastPythonFunction(source, pythonTarget, testCase);
        if (result === undefined) { supported = false; break; }
        if (result.kind !== 'ok') { passed = false; break; }
        const expected = testCase.expectedByLanguage?.python ?? testCase.expected;
        if ((Object.hasOwn(expected, 'returnValue') && !sameJson(result.observation.returnValue, expected.returnValue))
          || (expected.stdout !== undefined && result.observation.stdout !== expected.stdout)
          || (expected.argsAfter !== undefined && !sameJson(result.observation.argsAfter, expected.argsAfter))) { passed = false; break; }
      }
      if (!supported) continue;
    } else if (cppTarget) {
      const source = `${cppTarget.helperSource ? `${cppTarget.helperSource}\n` : ''}${assemble(cppTarget.source, answers)}`;
      if (source.length > 128 * 1024) continue;
      let program: ReturnType<typeof parse>;
      try { program = parse(source, language as 'c' | 'cpp'); }
      catch { continue; } // Parser preflight: do not spend case budgets on invalid source.
      passed = true;
      for (const testCase of question.grading.cases) {
        try {
          const observed = new CheckedRuntime(program, cppTarget, testCase).run();
          const expected = testCase.expectedByLanguage?.[language] ?? testCase.expected;
          if ((Object.hasOwn(expected, 'returnValue') && !sameJson(observed.returnValue, expected.returnValue))
            || (expected.stdout !== undefined && observed.stdout !== expected.stdout)
            || (expected.argsAfter !== undefined && !sameJson(observed.argsAfter, expected.argsAfter))) { passed = false; break; }
        } catch { passed = false; break; }
      }
    }
    tested++;
    if (passed) found.push(candidate);
    if (tested % 25 === 0 || passed) onProgress?.(progress());
    if (found.length >= maxResults) return done('limit', 'Result limit reached.');
  }
  return done(tested === 0 && pythonTarget ? 'unsupported' : 'complete',
    tested === 0 && pythonTarget ? 'This Python program needs the full runtime.' : undefined);
}

export function solveRequest(
  request: SolveRequest,
  onProgress?: (progress: SolveProgress) => void,
  isCancelled: () => boolean = () => false
): Promise<SolveResult> {
  if (request.strategy === 'exhaustive') return solveExhaustive(request, onProgress, isCancelled);
  if ((request.blankIds?.length ?? 0) > 1) return solveJointBlanks(request, onProgress, isCancelled);
  return solveProgramBlank(request, onProgress, isCancelled);
}
