import type { Blank, Language, WeightedRouteGrading } from '../core/types';
import { gradeQuestion } from '../core/grader';
import { parse as parseCpp } from '../engines/cpp/syntax';
import { parsePrefixRepeatCommands } from '../core/command-language';
import { generateCandidates } from './candidates';
import { semanticCandidates } from './semantic';
import { generateLiteralCandidates } from './literal';
import { stateAwareAssignments } from './state-aware';
import type { SolveProgress, SolveRequest, SolveResult } from './types';

/**
 * A preferred ordering changes only *when* an answer is tried. The fallback
 * alphabet still contains every Unicode scalar value, including controls.
 */
const FIRST_CHARACTERS = [...'0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_()[],.+-*/%<>=!&|:;{}#"\' \\?@^~`$\n\t\r'];
const PREFERRED = [...new Set(FIRST_CHARACTERS)];
const PREFERRED_SET = new Set(PREFERRED);
const UNICODE_SCALARS = 0x110000 - 0x800;

class Alphabet {
  private readonly cached: string[];
  private nextCodePoint = 0;
  readonly size: number;

  constructor(allowed?: string, forbidden?: string, testAlphabet?: string) {
    const blocked = new Set([...(forbidden ?? '')]);
    if (testAlphabet !== undefined || allowed !== undefined) {
      const source = [...new Set([...(testAlphabet ?? allowed ?? '')])];
      const allowedSet = allowed === undefined ? undefined : new Set([...allowed]);
      this.cached = source.filter(char => !blocked.has(char) && (!allowedSet || allowedSet.has(char)));
      this.size = this.cached.length;
    } else {
      this.cached = PREFERRED.filter(char => !blocked.has(char));
      this.size = UNICODE_SCALARS - blocked.size;
      this.blocked = blocked;
    }
  }

  private readonly blocked?: Set<string>;

  at(index: number): string | undefined {
    if (index >= this.size) return undefined;
    while (this.cached.length <= index) {
      const cp = this.nextCodePoint++;
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);
      if (!PREFERRED_SET.has(char) && !this.blocked?.has(char)) this.cached.push(char);
    }
    return this.cached[index];
  }
}

function validIdentifierConstraint(answer: string, blank: Blank): boolean {
  if (!blank.forbiddenIdentifiers?.length) return true;
  const identifiers: string[] = answer.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return !blank.forbiddenIdentifiers.some(identifier => identifiers.includes(identifier));
}

/**
 * Enumerate nonempty answers by increasing sum of positive character ranks.
 * Every fixed-cost shell is finite. Consequently, every finite tuple over the
 * allowed Unicode scalar alphabet appears after finitely many prior tuples.
 * No shell is materialized in memory.
 */
export function* enumerateAnswerTuples(
  blanks: Blank[],
  options: { alphabet?: string; maxCost?: number } = {}
): Generator<Record<string, string>> {
  if (!blanks.length) return;
  const alphabets = blanks.map(blank => new Alphabet(blank.allowedChars, blank.forbiddenChars, options.alphabet));
  if (alphabets.some(alphabet => alphabet.size === 0)) return;
  const finiteBounds = blanks.map((blank, index) => {
    if (blank.maxChars === undefined) return Infinity;
    const alphabet = alphabets[index];
    if (blank.maxCharsExcludeWhitespace) {
      if (blank.allowedChars === undefined && options.alphabet === undefined) return Infinity;
      const possible = blank.allowedChars ?? options.alphabet ?? '';
      if ([...possible].some(char => /\s/.test(char) && !blank.forbiddenChars?.includes(char))) return Infinity;
    }
    return blank.maxChars * alphabet.size;
  });
  const lastCost = Math.min(options.maxCost ?? Infinity, finiteBounds.reduce((sum, value) => sum + value, 0));

  type Frame = {
    index: number; answer: string; counted: number; remaining: number;
    values: string[]; phase: 'close' | 'chars'; rank: number;
  };
  for (let cost = blanks.length; cost <= lastCost; cost++) {
    const stack: Frame[] = [{ index: 0, answer: '', counted: 0, remaining: cost,
      values: [], phase: 'close', rank: 0 }];
    while (stack.length) {
      const frame = stack.pop()!;
      const blank = blanks[frame.index];
      const remainingBlanks = blanks.length - frame.index - 1;
      if (frame.phase === 'close') {
        // Process appends after closure so shorter spellings come first.
        stack.push({ ...frame, phase: 'chars' });
        if (frame.answer && validIdentifierConstraint(frame.answer, blank)) {
          const values = [...frame.values, frame.answer];
          if (remainingBlanks === 0 && frame.remaining === 0) {
            yield Object.fromEntries(blanks.map((item, index) => [item.id, values[index]]));
          } else if (remainingBlanks > 0 && frame.remaining >= remainingBlanks) {
            stack.push({ index: frame.index + 1, answer: '', counted: 0,
              remaining: frame.remaining, values, phase: 'close', rank: 0 });
          }
        }
        continue;
      }
      if (frame.remaining <= remainingBlanks) continue;
      if (blank.maxChars !== undefined && frame.counted >= blank.maxChars && !blank.maxCharsExcludeWhitespace) continue;
      const alphabet = alphabets[frame.index];
      const maxRank = Math.min(alphabet.size, frame.remaining - remainingBlanks);
      if (frame.rank >= maxRank) continue;
      stack.push({ ...frame, rank: frame.rank + 1 });
      const char = alphabet.at(frame.rank)!;
      const counted = frame.counted + Number(!blank.maxCharsExcludeWhitespace || !/\s/.test(char));
      if (blank.maxChars !== undefined && counted > blank.maxChars) continue;
      stack.push({ index: frame.index, answer: frame.answer + char, counted,
        remaining: frame.remaining - frame.rank - 1, values: frame.values, phase: 'close', rank: 0 });
    }
  }
}

function selectedBlanks(request: SolveRequest): Blank[] | undefined {
  const ids = request.blankIds?.length ? request.blankIds : request.blankId ? [request.blankId] : request.question.blanks.map(blank => blank.id);
  if (new Set(ids).size !== ids.length) return undefined;
  const blanks = ids.map(id => request.question.blanks.find(blank => blank.id === id));
  if (blanks.some(blank => !blank)) return undefined;
  return blanks as Blank[];
}

function numericSearchAlphabet(request: SolveRequest): string | undefined {
  switch (request.question.grading.kind) {
    case 'coin-counterexample':
    case 'prime-factor-count-counterexample':
    case 'prime-power-pair': return '0123456789';
    case 'prime-factor-counterexample':
    case 'top-two-counterexample': return '-0123456789,; \t\n';
    case 'signed-wrap-sum': return '-0123456789';
    case 'integer-list':
    case 'matrix-sums': return '-0123456789,; \t\n';
    default: return undefined;
  }
}

function* weightedRouteCandidates(spec: WeightedRouteGrading): Generator<Record<string, string>> {
  const neighbors = new Map(spec.nodes.map(node => [node, [] as { node: string; weight: number }[]]));
  for (const edge of spec.edges) {
    neighbors.get(edge.from)?.push({ node: edge.to, weight: edge.weight });
    if (!spec.directed) neighbors.get(edge.to)?.push({ node: edge.from, weight: edge.weight });
  }
  for (const list of neighbors.values()) list.sort((a, b) => a.weight - b.weight);
  const stack = [[spec.start]];
  while (stack.length) {
    const path = stack.pop()!;
    const current = path.at(-1)!;
    if (current === spec.end) {
      yield { [spec.answerBlank]: path.join('->') };
      continue;
    }
    for (const next of [...(neighbors.get(current) ?? [])].reverse()) {
      if (!path.includes(next.node)) stack.push([...path, next.node]);
    }
  }
}

function assembled(source: string, answers: Record<string, string>): string {
  return source.replace(/\{\{([^{}]+)\}\}/g, (_, id: string) => answers[id] ?? '');
}

/** Reject syntactically invalid completions before invoking any program runtime. */
function syntacticallyValid(request: SolveRequest, answers: Record<string, string>): boolean {
  const grading = request.question.grading;
  if (grading.kind === 'program') {
    const targets = request.language
      ? grading.targets.filter(target => target.language === request.language)
      : grading.targets;
    if (!targets.length) return false;
    let validCount = 0;
    for (const target of targets) {
      const source = `${target.helperSource ? `${target.helperSource}\n` : ''}${assembled(target.source, answers)}`;
      if (target.language === 'python') {
        // The custom Python parser intentionally covers a subset. Rejecting
        // its `unsupported` result here would lose valid Pyodide answers.
        // The grader performs Python's syntax check before execution.
        validCount++;
      } else {
        try { parseCpp(source, target.language); validCount++; } catch { /* Invalid syntax or unsupported subset. */ }
      }
    }
    return grading.targetPolicy === 'all' ? validCount === targets.length : validCount > 0;
  }
  if (grading.kind === 'cpp-line-repair') {
    const lineText = answers[grading.lineBlank]?.trim();
    if (!/^\d+$/.test(lineText) || answers[grading.replacementBlank]?.includes('\n')) return false;
    const lines = grading.source.split('\n');
    const index = Number(lineText) - grading.firstLine;
    if (!Number.isSafeInteger(index) || index < 0 || index >= lines.length) return false;
    lines[index] = grading.mode === 'append' ? lines[index] + answers[grading.replacementBlank] : answers[grading.replacementBlank];
    try { parseCpp(`${grading.prefixSource ?? ''}${lines.join('\n')}${grading.suffixSource ?? ''}`, grading.language ?? 'cpp'); }
    catch { return false; }
  }
  if (grading.kind === 'uniform-cpp-expression' || grading.kind === 'record-sort-comparator') {
    const value = answers[grading.answerBlank];
    try { parseCpp(`int candidate(){ return ${value}; }`); } catch { return false; }
  }
  if (grading.kind === 'difference-pyramid') return Object.values(answers).every(value => /^[\s\d,;\/{}]+$/.test(value));
  if (grading.kind === 'integer-list' || grading.kind === 'matrix-sums'
    || grading.kind === 'prime-factor-counterexample' || grading.kind === 'prime-factor-count-counterexample'
    || grading.kind === 'top-two-counterexample' || grading.kind === 'prime-power-pair'
    || grading.kind === 'signed-wrap-sum' || grading.kind === 'counterexample-max'
    || grading.kind === 'coin-counterexample') {
    return Object.values(answers).every(value => /^[\s,;+\-\d]+$/.test(value));
  }
  if (grading.kind === 'logo-drawing') {
    try {
      const segments: unknown = JSON.parse(answers[grading.answerBlank]);
      return Array.isArray(segments) && segments.every(segment => Array.isArray(segment) && segment.length === 2
        && segment.every(point => Array.isArray(point) && point.length === 2
          && point.every(value => typeof value === 'number' && Number.isFinite(value))));
    } catch { return false; }
  }
  if (grading.kind === 'graph') {
    try {
      const edges: unknown = JSON.parse(answers[grading.answerBlank]);
      return Array.isArray(edges) && edges.every(edge => Array.isArray(edge) && edge.length === 2
        && edge.every(node => typeof node === 'string'));
    } catch { return false; }
  }
  if (grading.kind === 'drawing-robot') return Boolean(parsePrefixRepeatCommands(
    answers[grading.answerBlank], 'FT', grading.maxRepeat, grading.maxCommands).commands);
  if (grading.kind === 'box-stack-robot') return Boolean(parsePrefixRepeatCommands(
    answers[grading.answerBlank], 'LRUD', grading.maxRepeat, grading.maxCommands).commands);
  if (grading.kind === 'robot-grid') {
    const value = answers[grading.answerBlank];
    const tokens = Object.keys(grading.dialect.commands);
    const grammarChars = new Set([...tokens.join(''), ...'0123456789[]()']);
    return [...value].every(char => /\s/.test(char) || grammarChars.has(char));
  }
  if (grading.kind === 'river-route') return /^[+\-<\s]*$/.test(answers[grading.answerBlank]);
  if (grading.kind === 'graph-labeling') return /^[\s\d,;=a-zA-Z:]+$/.test(answers[grading.answerBlank]);
  return true;
}

/** Complete fallback search, subject to the grader and optional caller limits. */
export async function solveExhaustive(
  request: SolveRequest,
  onProgress?: (progress: SolveProgress) => void,
  isCancelled: () => boolean = () => false
): Promise<SolveResult> {
  const started = performance.now();
  let generated = 0;
  let tested = 0;
  const found: string[] = [];
  const assignments: Record<string, string>[] = [];
  const progress = (): SolveProgress => ({ generated, tested, found: [...found], assignments: [...assignments], elapsedMs: Math.round(performance.now() - started) });
  const done = (status: SolveResult['status'], message?: string): SolveResult => ({ ...progress(), status, message });
  const { question } = request;
  if (question.grading.kind === 'cancelled' || question.grading.kind === 'pending') return done('unsupported', 'This question has no active checker.');
  const selectedBlanksResult = selectedBlanks(request);
  if (!selectedBlanksResult?.length) return done('unsupported', 'Select one or more valid blanks.');
  const blanks = selectedBlanksResult;
  const selected = new Set(blanks.map(blank => blank.id));
  if (question.blanks.some(blank => !selected.has(blank.id) && !request.knownAnswers?.[blank.id])) {
    return done('unsupported', 'Fill unselected blanks before searching.');
  }

  const maxCandidates = request.maxCandidates && request.maxCandidates > 0 ? request.maxCandidates : Infinity;
  const maxResults = request.maxResults && request.maxResults > 0 ? request.maxResults : Infinity;
  const maxMs = request.maxMs && request.maxMs > 0 ? request.maxMs : Infinity;
  const language: Language | undefined = request.language;
  const answers = { ...request.knownAnswers };
  const seenHeuristic = new Set<string>();
  const program = question.grading.kind === 'program' ? question.grading : undefined;
  const singleProgram = Boolean(program && blanks.length === 1);
  const guided = program && request.pythonRuntime !== 'pyodide' && maxMs >= 5_000 && maxCandidates >= 500
    ? (await stateAwareAssignments(question, language ?? program.targets[0].language, blanks.map(blank => blank.id), answers, {
      maxRuns: 160, deadline: started + Math.min(maxMs * 0.5, 6_000), isCancelled
    })).filter(assignment => blanks.every(blank => typeof assignment[blank.id] === 'string'))
      .map(assignment => Object.fromEntries(blanks.map(blank => [blank.id, assignment[blank.id]]))) : [];
  if (isCancelled()) return done('cancelled');
  const baseHeuristic: Generator<Record<string, string>> | undefined = singleProgram
    ? (function* () {
      for (const value of generateCandidates(question, blanks[0].id, language ?? program!.targets[0].language, 'deep'))
        yield { [blanks[0].id]: value };
    })()
    : question.grading.kind === 'literal' && blanks.length === 1
      ? (function* () {
        for (const value of generateLiteralCandidates(question, blanks[0].id))
          yield { [blanks[0].id]: value };
      })()
    : question.grading.kind === 'weighted-route'
      ? weightedRouteCandidates(question.grading)
    : (function* () {
      yield* semanticCandidates(question);
      const alphabet = numericSearchAlphabet(request);
      if (alphabet) yield* enumerateAnswerTuples(blanks, { alphabet });
    })();
  const heuristic = (function* (): Generator<Record<string, string>> {
    yield* guided;
    if (baseHeuristic) yield* baseHeuristic;
  })();
  let heuristicDone = false;

  async function tryCandidate(tuple: Record<string, string>): Promise<boolean> {
    generated++;
    if (isCancelled()) return false;
    if (performance.now() - started >= maxMs || generated > maxCandidates) return false;
    Object.assign(answers, tuple);
    if (!syntacticallyValid(request, answers)) return true;
    const result = await gradeQuestion(question, answers, language, request.allAnswers,
      { pythonRuntime: request.pythonRuntime });
    tested++;
    if (result.status === 'pass') {
      assignments.push({ ...tuple });
      if (blanks.length === 1) found.push(tuple[blanks[0].id]);
    }
    if (tested % 25 === 0 || result.status === 'pass') onProgress?.(progress());
    return true;
  }

  const raw = enumerateAnswerTuples(blanks);
  while (true) {
    if (isCancelled()) return done('cancelled');
    if (performance.now() - started >= maxMs || generated >= maxCandidates) return done('limit');
    // Interleave a bounded number of syntax-aware suggestions with the fair
    // fallback. A heuristic can never starve any finite answer.
    if (heuristic && !heuristicDone) {
      const next = heuristic.next();
      if (!next.done) {
        const tuple = next.value;
        const key = JSON.stringify(blanks.map(blank => tuple[blank.id]));
        if (!seenHeuristic.has(key)) {
          seenHeuristic.add(key);
          // Deduplication must remain bounded for an indefinite search.
          if (seenHeuristic.size > 10_000) seenHeuristic.clear();
          const allowed = blanks.every(blank => {
            const value = tuple[blank.id];
            const count = [...value].filter(char => !blank.maxCharsExcludeWhitespace || !/\s/.test(char)).length;
            return value && (blank.maxChars === undefined || count <= blank.maxChars)
              && (!blank.allowedChars || [...value].every(char => blank.allowedChars!.includes(char)))
              && (!blank.forbiddenChars || [...value].every(char => !blank.forbiddenChars!.includes(char)))
              && validIdentifierConstraint(value, blank);
          });
          if (allowed) {
            await tryCandidate(tuple);
            if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
          }
        }
      } else heuristicDone = true;
    }
    const next = raw.next();
    if (next.done) return done('complete');
    const key = JSON.stringify(blanks.map(blank => next.value[blank.id]));
    if (!seenHeuristic.has(key)) await tryCandidate(next.value);
    if (assignments.length >= maxResults) return done('limit', 'Result limit reached.');
    if (generated % 25 === 0) {
      onProgress?.(progress());
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
}
