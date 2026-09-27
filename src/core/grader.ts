import type {
  CaseGrade, EngineResult, Language, Observation, PaperAnswers, PaperConfig, PaperGrade,
  ProgramTarget, Question, QuestionGrade
} from './types';
import { checkGraph, checkGraphReversal } from '../engines/graph';
import { checkRobot } from '../engines/robot';
import { checkTriangleAffine } from '../engines/probability/triangle';
import { checkUniformCppExpression } from '../engines/probability/uniform-cpp';
import { cppEngine } from '../engines/cpp';
import { pythonEngine } from '../engines/python';
import { matchesLogoDrawing, type DrawingSegment } from './logo-drawing';

const MAX_PY_SOURCE_BYTES = 200_000;
const MAX_C_SOURCE_BYTES = 128 * 1024;

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  if (typeof left === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalJson(a[key], b[key]));
  }
  return false;
}

function matches(actual: Observation, expected: Observation): boolean {
  return (!Object.hasOwn(expected, 'returnValue') || equalJson(actual.returnValue, expected.returnValue))
    && (expected.stdout === undefined || actual.stdout === expected.stdout)
    && (expected.argsAfter === undefined || equalJson(actual.argsAfter, expected.argsAfter));
}

function resultCase(id: string, result: EngineResult, expected: Observation): CaseGrade {
  if (result.kind === 'ok') return {
    id, status: matches(result.observation, expected) ? 'pass' : 'fail',
    message: matches(result.observation, expected) ? undefined : `Expected ${JSON.stringify(expected)}; got ${JSON.stringify(result.observation)}.`,
    observed: result.observation, steps: result.steps
  };
  return {
    id,
    status: ['unsupported', 'wall-timeout', 'internal-error'].includes(result.kind) ? 'inconclusive' : 'fail',
    message: `${result.kind}: ${result.message}`, steps: result.steps
  };
}

function assemble(question: Question, answers: Record<string, string>, source: string): string {
  let assembled = source;
  for (const blank of question.blanks) {
    assembled = assembled.replaceAll(`{{${blank.id}}}`, () => answers[blank.id]);
  }
  return assembled;
}

function invalidAnswer(question: Question, answers: Record<string, string>): string | null {
  for (const blank of question.blanks) {
    const answer = answers[blank.id];
    if (typeof answer !== 'string' || answer.length === 0) return `Blank ${blank.id} is empty.`;
    if (blank.maxChars !== undefined && [...answer].length > blank.maxChars) {
      return `Blank ${blank.id} exceeds its ${blank.maxChars} character limit.`;
    }
    if (blank.forbiddenChars && [...answer].some(char => blank.forbiddenChars!.includes(char))) {
      return `Blank ${blank.id} uses a prohibited character.`;
    }
    if (blank.allowedChars && [...answer].some(char => !blank.allowedChars!.includes(char))) {
      return `Blank ${blank.id} uses a character outside the permitted set.`;
    }
  }
  return null;
}

function singleResult(question: Question, status: QuestionGrade['status'], message?: string): QuestionGrade {
  return {
    questionId: question.id, status, score: status === 'pass' ? question.points : status === 'fail' ? 0 : null,
    maxScore: question.points, cases: [], message
  };
}

async function gradeTarget(question: Question, answers: Record<string, string>, target: ProgramTarget): Promise<CaseGrade[]> {
  if (question.grading.kind !== 'program') throw new Error('Expected a program question');
  const body = assemble(question, answers, target.source);
  const source = target.helperSource ? `${target.helperSource}\n${body}` : body;
  const maxSourceBytes = target.language === 'python' ? MAX_PY_SOURCE_BYTES : MAX_C_SOURCE_BYTES;
  if (new TextEncoder().encode(source).length > maxSourceBytes) {
    return [{ id: 'source-size', status: 'fail', message: 'Composed source byte limit exceeded.' }];
  }
  const engine = target.language === 'python' ? pythonEngine : cppEngine;
  const results: CaseGrade[] = [];
  for (const testCase of question.grading.cases) {
    let result: EngineResult;
    try { result = await engine.run(source, target, testCase); }
    catch (error) { result = { kind: 'internal-error', message: error instanceof Error ? error.message : String(error) }; }
    results.push(resultCase(`${target.language}:${testCase.id}`, result,
      testCase.expectedByLanguage?.[target.language] ?? testCase.expected));
    if (results.at(-1)?.status !== 'pass') break;
  }
  return results;
}

export async function gradeQuestion(question: Question, answersForQuestion: Record<string, string>, language?: Language): Promise<QuestionGrade> {
  if (question.grading.kind === 'cancelled') return { questionId: question.id, status: 'cancelled', score: 0, maxScore: 0, cases: [], message: question.grading.reason };
  if (question.grading.kind === 'pending') return singleResult(question, 'pending', question.grading.reason);
  const answers: Record<string, string> = {};
  for (const blank of question.blanks) answers[blank.id] = answersForQuestion?.[blank.id]?.replace(/\r\n?/g, '\n') ?? '';
  const invalid = invalidAnswer(question, answers);
  if (invalid) return singleResult(question, 'fail', invalid);

  if (question.grading.kind === 'literal') {
    const { accepted, normalize } = question.grading;
    const wrong = question.blanks.find(blank => {
      const value = normalize === 'trim' ? answers[blank.id].trim() : answers[blank.id];
      return !accepted[blank.id].some(candidate => (normalize === 'trim' ? candidate.trim() : candidate) === value);
    });
    return singleResult(question, wrong ? 'fail' : 'pass', wrong ? `Blank ${wrong.id} does not match an accepted value.` : undefined);
  }
  if (question.grading.kind === 'rpn-expression') {
    const spec = question.grading;
    const normalized = answers[spec.answerBlank].replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
    return singleResult(question, spec.forms.includes(normalized) ? 'pass' : 'fail');
  }
  if (question.grading.kind === 'counterexample-max') {
    const spec = question.grading;
    const raw = answers[spec.answerBlank].trim();
    if (!/^\d+$/.test(raw)) return singleResult(question, 'fail', 'Enter an integer in the stated range.');
    const candidate = Number(raw);
    if (!Number.isSafeInteger(candidate) || candidate < spec.minimum || candidate > spec.maximum || !spec.residues.includes(candidate % spec.modulus)) {
      return singleResult(question, 'fail', 'This input is not a valid counterexample.');
    }
    const maximum = Math.max(...spec.residues.map(residue => spec.maximum - ((spec.maximum - residue) % spec.modulus + spec.modulus) % spec.modulus));
    if (candidate === maximum) return singleResult(question, 'pass');
    return { questionId: question.id, status: 'partial', score: spec.partialPoints, maxScore: question.points, cases: [],
      message: `Valid counterexample. The maximum valid value earns ${question.points} points.` };
  }
  if (question.grading.kind === 'signed-wrap-sum') {
    const spec = question.grading;
    const raw = spec.answerBlanks.map(blankId => answers[blankId].trim());
    if (raw.some(item => !/^-?\d+$/.test(item))) return singleResult(question, 'fail', 'Enter two integers.');
    const values = raw.map(Number);
    if (values.some(value => !Number.isSafeInteger(value) || value < spec.minimum || value > spec.maximum)) {
      return singleResult(question, 'fail', 'A value is outside the stated integer range.');
    }
    return singleResult(question, values[0] + values[1] === spec.requiredSum ? 'pass' : 'fail');
  }
  if (question.grading.kind === 'nand-expression') {
    const spec = question.grading;
    const source = answers[spec.answerBlank].replace(/\s+/g, '');
    if (source.length > 100 || /[^ABQ()]/.test(source)) return singleResult(question, 'fail', 'Use A, B, Q, and parentheses only.');
    let at = 0;
    type NandNode = 'A' | 'B' | [NandNode, NandNode];
    function parse(): NandNode {
      const token = source[at++];
      if (token === 'A' || token === 'B') return token;
      if (token !== '(') throw new Error('Expected an operand or opening parenthesis.');
      const left = parse();
      if (source[at++] !== 'Q') throw new Error('Expected NAND operator Q.');
      const right = parse();
      if (source[at++] !== ')') throw new Error('Every NAND operation must be parenthesized.');
      return [left, right];
    }
    let tree: NandNode;
    try { tree = parse(); if (at !== source.length) throw new Error('Unexpected trailing characters.'); }
    catch (error) { return singleResult(question, 'fail', error instanceof Error ? error.message : String(error)); }
    function evaluate(node: NandNode, a: boolean, b: boolean): boolean {
      return node === 'A' ? a : node === 'B' ? b : !(evaluate(node[0], a, b) && evaluate(node[1], a, b));
    }
    const inputs: [boolean, boolean][] = [[true,true],[true,false],[false,true],[false,false]];
    return singleResult(question, inputs.every(([a,b], index) => evaluate(tree, a, b) === spec.expected[index]) ? 'pass' : 'fail');
  }
  if (question.grading.kind === 'die-face') {
    const spec = question.grading;
    const value = answers[spec.answerBlank].trim().toLowerCase();
    if (!/^[.o]{3}\/[.o]{3}\/[.o]{3}$/.test(value)) return singleResult(question, 'fail', 'Enter a 3×3 pip grid.');
    if (value === spec.expected) return singleResult(question, 'pass');
    const count = [...value].filter(char => char === 'o').length;
    const expectedCount = [...spec.expected].filter(char => char === 'o').length;
    if (count === expectedCount) return { questionId: question.id, status: 'partial', score: question.points / 2,
      maxScore: question.points, cases: [], message: 'Pip count is correct; orientation differs.' };
    return singleResult(question, 'fail', 'Pip count differs.');
  }
  if (question.grading.kind === 'prime-power-pair') {
    const spec = question.grading;
    const input = [answers[spec.correctBlank].trim(), answers[spec.incorrectBlank].trim()];
    if (input.some(value => !/^\d+$/.test(value))) return singleResult(question, 'fail', 'Enter two positive integers.');
    const values = input.map(Number);
    if (values.some(value => !Number.isSafeInteger(value) || value < spec.minimum || value > spec.maximum)) {
      return singleResult(question, 'fail', 'A number is outside the allowed range.');
    }
    function isPrimePower(number: number): boolean {
      let n = number, distinct = 0;
      for (let divisor = 2; divisor * divisor <= n; divisor += divisor === 2 ? 1 : 2) {
        if (n % divisor !== 0) continue;
        if (++distinct > 1) return false;
        do { n /= divisor; } while (n % divisor === 0);
      }
      if (n > 1) distinct++;
      return distinct === 1;
    }
    return singleResult(question, isPrimePower(values[0]) && !isPrimePower(values[1]) ? 'pass' : 'fail');
  }
  if (question.grading.kind === 'float-input-error') {
    const values = question.grading.answerBlanks.map(blankId => answers[blankId].trim());
    const numericPrefix = /^[+-]?(?:0[xX][0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?[pP][+-]?\d+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan(?:\([^)]*\))?)/i;
    const causesError = (value: string) => {
      const match = numericPrefix.exec(value);
      if (!match) return true;
      if (/nan|inf/i.test(match[0])) return false;
      if (/0[xX]/.test(match[0])) {
        const hex = /^[+-]?0[xX]([0-9a-fA-F]+)(?:\.([0-9a-fA-F]*))?[pP]([+-]?\d+)/.exec(match[0]);
        if (!hex) return true;
        return (parseInt(hex[1], 16) + [...(hex[2] ?? '')].reduce((sum, digit, index) => sum + parseInt(digit, 16) / 16 ** (index + 1), 0)) * 2 ** Number(hex[3]) === 0;
      }
      return Number(match[0]) === 0;
    };
    const valid = values.map(causesError);
    const score = Number(valid[0]) + Number(valid[1] && values[1] !== values[0]);
    return { questionId: question.id, status: score === 2 ? 'pass' : score === 1 ? 'partial' : 'fail',
      score, maxScore: question.points, cases: [], message: score === 1 ? 'One valid, distinct input earns one point.' : undefined };
  }
  if (question.grading.kind === 'logo-drawing') {
    const spec = question.grading;
    const raw = answers[spec.answerBlank];
    if (raw.length > 10_000) return singleResult(question, 'fail', 'Drawing is too large.');
    let segments: DrawingSegment[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 40 || !parsed.every(segment =>
        Array.isArray(segment) && segment.length === 2 && segment.every(point =>
          Array.isArray(point) && point.length === 2 && point.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)))) {
        throw new Error('Invalid drawing coordinates.');
      }
      segments = parsed as DrawingSegment[];
    } catch { return singleResult(question, 'fail', 'Draw lines on the canvas to answer.'); }
    const passed = matchesLogoDrawing(segments, spec.segments, spec.tolerance);
    return singleResult(question, passed ? 'pass' : 'fail', passed ? undefined : 'Draw the two overlapping triangles with all six sides. Rough lines are fine.');
  }
  if (question.grading.kind === 'integer-list') {
    const spec = question.grading;
    const pieces = spec.answerBlanks.length === 1
      ? answers[spec.answerBlanks[0]].trim().split(/[\s,;]+/)
      : spec.answerBlanks.map(blankId => answers[blankId].trim());
    if (pieces.length !== spec.count || pieces.some(piece => !/^-?\d+$/.test(piece))) return singleResult(question, 'fail', `Enter ${spec.count} integers.`);
    const values = pieces.map(Number);
    if (values.some(value => !Number.isSafeInteger(value) || value < spec.minimum || value > spec.maximum ||
        spec.forbidden?.includes(value) || spec.allowed && !spec.allowed.includes(value) ||
        spec.squareOnly && (value < 0 || !Number.isInteger(Math.sqrt(value))))) {
      return singleResult(question, 'fail', 'A number is outside the allowed values.');
    }
    if (spec.distinct && new Set(values).size !== values.length) return singleResult(question, 'fail', 'The numbers must be distinct.');
    if (spec.inversionCount !== undefined) {
      let inversions = 0;
      for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) if (values[i] > values[j]) inversions++;
      if (inversions !== spec.inversionCount) return singleResult(question, 'fail', `Expected ${spec.inversionCount} inversions; got ${inversions}.`);
    }
    if (spec.minimumSpacing) {
      const ordered = [...values, ...spec.minimumSpacing.anchors].sort((a, b) => a - b);
      if (new Set(ordered).size !== ordered.length || ordered.some((value, index) => index > 0 && value - ordered[index - 1] < spec.minimumSpacing!.required)) {
        return singleResult(question, 'fail', `Adjacent seats must be at least ${spec.minimumSpacing.required} apart.`);
      }
    }
    return singleResult(question, 'pass');
  }
  if (question.grading.kind === 'grid-checkpoints') {
    const spec = question.grading;
    const labels = answers[spec.answerBlank].trim().toUpperCase().split(/[\s,;]+/);
    if (labels.length !== 2 || labels.some(label => !/^[A-Z](?:[1-9]|1[0-2])$/.test(label)) || labels[0] === labels[1]) {
      return singleResult(question, 'fail', 'Enter two distinct cells, such as E1 C5.');
    }
    const cells = labels.map(label => [label.charCodeAt(0) - 65, Number(label.slice(1)) - 1] as const);
    if (cells.some(([x, y]) => x < 0 || x >= spec.width || y < 0 || y >= spec.height ||
        x === 0 && y === 0 || x === spec.width - 1 && y === spec.height - 1)) {
      return singleResult(question, 'fail', 'Choose cells inside the grid, excluding S and T.');
    }
    const paths = Array.from({ length: spec.height }, () => Array.from({ length: spec.width }, () => [0, 0, 0]));
    paths[0][0][0] = 1;
    for (let y = 0; y < spec.height; y++) for (let x = 0; x < spec.width; x++) {
      if (x === 0 && y === 0) continue;
      const isCheckpoint = cells.some(([cx, cy]) => cx === x && cy === y);
      for (let visited = 0; visited <= 2; visited++) {
        const previous = (x > 0 ? paths[y][x - 1][visited] : 0) + (y > 0 ? paths[y - 1][x][visited] : 0);
        paths[y][x][Math.min(2, visited + Number(isCheckpoint))] += previous;
      }
    }
    const count = paths[spec.height - 1][spec.width - 1][1];
    return singleResult(question, count === spec.expectedPaths ? 'pass' : 'fail',
      count === spec.expectedPaths ? undefined : `The grid has ${count} paths through exactly one C; expected ${spec.expectedPaths}.`);
  }
  if (question.grading.kind === 'matrix-sums') {
    const spec = question.grading;
    const parts = answers[spec.answerBlank].trim().split(/[\s,;]+/);
    const count = spec.rowSums.length * spec.colSums.length;
    if (parts.length !== count || parts.some(part => !/^-?\d+$/.test(part))) return singleResult(question, 'fail', `Enter ${count} numbers in row order.`);
    const values = parts.map(Number);
    if (values.some(value => !spec.values.includes(value)) || spec.values.some(value => values.filter(item => item === value).length !== spec.each)) {
      return singleResult(question, 'fail', 'The listed numbers must each occur the stated number of times.');
    }
    const width = spec.colSums.length;
    if (spec.rowSums.some((target, row) => values.slice(row * width, (row + 1) * width).reduce((a, b) => a + b, 0) !== target) ||
        spec.colSums.some((target, col) => spec.rowSums.reduce((sum, _, row) => sum + values[row * width + col], 0) !== target)) {
      return singleResult(question, 'fail', 'A row or column sum does not match its target.');
    }
    return singleResult(question, 'pass');
  }
  if (question.grading.kind === 'program-input') {
    const spec = question.grading;
    const source = spec.target.source;
    const maxSourceBytes = spec.target.language === 'python' ? MAX_PY_SOURCE_BYTES : MAX_C_SOURCE_BYTES;
    if (new TextEncoder().encode(source).length > maxSourceBytes) return singleResult(question, 'fail', 'Source byte limit exceeded.');
    const engine = spec.target.language === 'python' ? pythonEngine : cppEngine;
    const testCase = { id: 'candidate-input', stdin: answers[spec.answerBlank], expected: spec.expected, maxSteps: spec.maxSteps };
    let result: EngineResult;
    try { result = await engine.run(source, spec.target, testCase); }
    catch (error) { result = { kind: 'internal-error', message: error instanceof Error ? error.message : String(error) }; }
    const gradedCase = resultCase(testCase.id, result, spec.expected);
    const status = gradedCase.status;
    return { questionId: question.id, status, score: status === 'pass' ? question.points : status === 'fail' ? 0 : null,
      maxScore: question.points, cases: [gradedCase] };
  }
  if (question.grading.kind === 'graph') {
    const result = checkGraph(question.grading, answers[question.grading.answerBlank]);
    return singleResult(question, result ? 'fail' : 'pass', result ?? undefined);
  }
  if (question.grading.kind === 'graph-reversal') {
    const result = checkGraphReversal(question.grading, answers[question.grading.answerBlank]);
    return singleResult(question, result ? 'fail' : 'pass', result ?? undefined);
  }
  if (question.grading.kind === 'triangle-affine') {
    const result = checkTriangleAffine(answers[question.grading.answerBlank]);
    return singleResult(question, result.status, result.message);
  }
  if (question.grading.kind === 'uniform-cpp-expression') {
    const result = checkUniformCppExpression(question.grading, answers[question.grading.answerBlank]);
    return singleResult(question, result.status, result.message);
  }
  if (question.grading.kind === 'cpp-line-repair') {
    const spec = question.grading;
    const lineText = answers[spec.lineBlank].trim();
    const replacement = answers[spec.replacementBlank];
    if (!/^\d+$/.test(lineText) || replacement.includes('\n')) return singleResult(question, 'fail', 'Enter one line number and one replacement line.');
    const lines = spec.source.split('\n');
    const index = Number(lineText) - spec.firstLine;
    if (!Number.isSafeInteger(index) || index < 0 || index >= lines.length) return singleResult(question, 'fail', 'Line number is outside the printed program.');
    lines[index] = spec.mode === 'append' ? lines[index] + replacement : replacement;
    const patched = `${spec.prefixSource ?? ''}${lines.join('\n')}${spec.suffixSource ?? ''}`;
    if (new TextEncoder().encode(patched).length > MAX_C_SOURCE_BYTES) return singleResult(question, 'fail', 'Patched source byte limit exceeded.');
    const target: ProgramTarget = { language: spec.language ?? 'cpp', dialect: spec.language === 'c' ? 'c99' : 'c++20', source: patched, harness: spec.harness ?? { kind: 'program' } };
    const cases: CaseGrade[] = [];
    for (const testCase of spec.cases) {
      let result: EngineResult;
      try { result = await cppEngine.run(patched, target, testCase); }
      catch (error) { result = { kind: 'internal-error', message: error instanceof Error ? error.message : String(error) }; }
      cases.push(resultCase(testCase.id, result, testCase.expected));
      if (cases.at(-1)?.status !== 'pass') break;
    }
    const status: QuestionGrade['status'] = cases.every(item => item.status === 'pass') ? 'pass'
      : cases.some(item => item.status === 'fail') ? 'fail' : 'inconclusive';
    const partial = status === 'fail' && spec.linePoints !== undefined && spec.correctLines?.includes(Number(lineText));
    return { questionId: question.id, status: partial ? 'partial' : status,
      score: status === 'pass' ? question.points : partial ? spec.linePoints! : status === 'fail' ? 0 : null,
      maxScore: question.points, cases };
  }
  if (question.grading.kind === 'coin-counterexample') {
    const spec = question.grading;
    const middle = Number(answers[spec.middleBlank].trim());
    const largest = Number(answers[spec.largestBlank].trim());
    if (!/^\d+$/.test(answers[spec.middleBlank].trim()) || !/^\d+$/.test(answers[spec.largestBlank].trim()) ||
        !(1 < middle && middle < largest && largest <= spec.largestLimit)) {
      return singleResult(question, 'fail', 'Enter increasing integer coin values within the stated range.');
    }
    const coins = [1, middle, largest];
    let remainder = spec.amount;
    let greedy = 0;
    for (const coin of [...coins].reverse()) {
      greedy += Math.floor(remainder / coin);
      remainder %= coin;
    }
    const optimum = Array<number>(spec.amount + 1).fill(spec.amount + 1);
    optimum[0] = 0;
    for (let amount = 1; amount <= spec.amount; amount++) for (const coin of coins) {
      if (amount >= coin) optimum[amount] = Math.min(optimum[amount], optimum[amount - coin] + 1);
    }
    return singleResult(question, greedy > optimum[spec.amount] ? 'pass' : 'fail',
      greedy > optimum[spec.amount] ? undefined : 'Greedy and optimal coin counts are equal.');
  }
  if (question.grading.kind === 'checksum-collision') {
    const spec = question.grading;
    const answer = answers[spec.answerBlank];
    if (answer.length !== spec.reference.length || answer === spec.reference ||
        [...answer].some(char => !spec.alphabet.includes(char))) {
      return singleResult(question, 'fail', 'Enter a different string using the stated alphabet.');
    }
    const checksum = (value: string) => [...value].reduce((sum, char, index) =>
      sum + (spec.alphabet.indexOf(char) + 1) ** spec.powers[index], 0);
    return singleResult(question, checksum(answer) === checksum(spec.reference) ? 'pass' : 'fail',
      checksum(answer) === checksum(spec.reference) ? undefined : 'Checksum differs from the reference.');
  }
  if (question.grading.kind === 'zigzag-path') {
    const spec = question.grading;
    const answer = answers[spec.answerBlank];
    if (!/^[0-9]+$/.test(answer) || answer.length !== spec.steps.length) {
      return singleResult(question, 'fail', 'Enter one digit for each move.');
    }
    const chosen = [...answer].map(Number).sort((a, b) => a - b);
    const required = [...spec.steps].sort((a, b) => a - b);
    if (chosen.some((step, index) => step !== required[index])) {
      return singleResult(question, 'fail', 'The move lengths do not match the given set.');
    }
    let position = spec.start;
    let keyReached = position === spec.key;
    const blocked = new Set(spec.blocked);
    for (const step of answer) {
      position += Number(step);
      if (position > spec.end || blocked.has(position)) return singleResult(question, 'fail', 'A move lands outside the route or on a blocked cell.');
      if (position === spec.key) keyReached = true;
    }
    return singleResult(question, position === spec.end && keyReached ? 'pass' : 'fail',
      position === spec.end && keyReached ? undefined : 'The route does not collect the key and reach the exit.');
  }
  if (question.grading.kind === 'robot-grid') {
    const result = checkRobot(question.grading, answers[question.grading.answerBlank]);
    return singleResult(question, result ? 'fail' : 'pass', result ?? undefined);
  }

  const allTargets = question.grading.targets;
  const matchingTargets = language && allTargets.length > 1 ? allTargets.filter(target => target.language === language) : [];
  const targets = matchingTargets.length ? matchingTargets : allTargets;
  const targetCases = [];
  for (const target of targets) targetCases.push(await gradeTarget(question, answers, target));
  const targetStatus = targetCases.map(cases => cases.every(item => item.status === 'pass')
    ? 'pass' : cases.some(item => item.status === 'fail') ? 'fail' : 'inconclusive');
  const status = question.grading.targetPolicy === 'any'
    ? targetStatus.includes('pass') ? 'pass' : targetStatus.includes('inconclusive') ? 'inconclusive' : 'fail'
    : targetStatus.includes('fail') ? 'fail' : targetStatus.includes('inconclusive') ? 'inconclusive' : 'pass';
  return {
    questionId: question.id, status, score: status === 'pass' ? question.points : status === 'fail' ? 0 : null,
    maxScore: question.points, cases: targetCases.flat()
  };
}

function verifyTracks(paper: PaperConfig, selectedTracks: string[]): Set<string> {
  const selected = new Set(selectedTracks);
  if (selected.size !== selectedTracks.length) throw new Error('Duplicate selected track');
  const known = new Set(paper.tracks.map(track => track.id));
  for (const track of selected) if (!known.has(track)) throw new Error(`Unknown selected track ${track}`);
  for (const track of paper.tracks) if (track.selection === 'required' && !selected.has(track.id)) {
    throw new Error(`Required track ${track.id} is not selected`);
  }
  const groups = new Set(paper.tracks.map(track => track.choiceGroup).filter((group): group is string => Boolean(group)));
  for (const group of groups) {
    const count = paper.tracks.filter(track => track.choiceGroup === group && selected.has(track.id)).length;
    if (count !== 1) throw new Error(`Select exactly one track from ${group}`);
  }
  return selected;
}

export async function gradePaper(paper: PaperConfig, answers: PaperAnswers, selectedTracks: string[]): Promise<PaperGrade> {
  const selected = verifyTracks(paper, selectedTracks);
  const choiceLanguages = paper.tracks.filter(track => track.selection === 'choice' && selected.has(track.id)).map(track => {
    const name = `${track.id} ${track.label}`.toLowerCase();
    if (name.includes('python')) return 'python' as const;
    if (name.includes('cpp') || name.includes('c++')) return 'cpp' as const;
    return undefined;
  }).filter((item): item is 'python' | 'cpp' => item !== undefined);
  const language = choiceLanguages.length === 1 ? choiceLanguages[0] : undefined;
  const questions: QuestionGrade[] = [];
  for (const question of paper.questions) if (selected.has(question.track)) {
    questions.push(await gradeQuestion(question, answers[question.id] ?? {}, language));
  }
  const scored = questions.filter(item => item.score !== null);
  return {
    paperId: paper.paper.id, selectedTracks, questions,
    scoredPoints: scored.reduce((sum, item) => sum + (item.score ?? 0), 0),
    scoredMaximum: scored.reduce((sum, item) => sum + item.maxScore, 0),
    possibleMaximum: questions.reduce((sum, item) => sum + item.maxScore, 0),
    complete: scored.length === questions.length
  };
}
