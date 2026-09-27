import type {
  BooleanCircuitGrading, DifferencePyramidGrading, SparseRulerGrading,
  PrimeFactorCounterexampleGrading, PrimeFactorCountCounterexampleGrading,
  StringReplacementCounterexampleGrading, TextEditorGrading, TopTwoCounterexampleGrading
} from './types';

/** Return a failure reason, or null when the submitted answer meets the printed task. */
export function checkStringReplacementCounterexample(spec: StringReplacementCounterexampleGrading, answer: string): string | null {
  if (answer.length > spec.maxInputLength) return 'The input exceeds the printed buffer length.';
  let occurrences = 0, from = 0;
  while (true) {
    const index = answer.indexOf(spec.needle, from);
    if (index < 0) break;
    occurrences++;
    from = index + spec.needle.length;
  }
  return occurrences >= 2 ? null : 'The input does not expose the one-replacement bug.';
}

export function checkDifferencePyramid(spec: DifferencePyramidGrading, answer: string): string | null {
  if (!/^[\s\d,;/{}]+$/.test(answer)) return 'Enter six integers in pyramid order.';
  const parts = answer.match(/\d+/g) ?? [];
  if (parts.length !== 6) return 'Enter six integers in pyramid order.';
  const values = parts.map(Number);
  if (new Set(values).size !== 6 || values.some(value => !spec.values.includes(value))) {
    return 'Use each of the stated values exactly once.';
  }
  const [top, middleLeft, middleRight, bottomLeft, bottomMiddle, bottomRight] = values;
  return middleLeft === Math.abs(bottomLeft - bottomMiddle)
    && middleRight === Math.abs(bottomMiddle - bottomRight)
    && top === Math.abs(middleLeft - middleRight)
    ? null : 'Each upper box must be the difference of the two boxes below it.';
}

export function checkSparseRuler(spec: SparseRulerGrading, answer: string): string | null {
  if (!/^[\s\d,;{}]+$/.test(answer)) return 'Enter integer mark positions.';
  const parts = answer.match(/\d+/g) ?? [];
  if (parts.length < 2 || parts.length > spec.maxMarks) return `Use at most ${spec.maxMarks} marks.`;
  const marks = parts.map(Number);
  if (new Set(marks).size !== marks.length || !marks.includes(0) || !marks.includes(spec.length)
      || marks.some(value => !Number.isSafeInteger(value) || value < 0 || value > spec.length)) {
    return 'Marks must be distinct positions between both ruler ends.';
  }
  const distances = new Set<number>();
  for (let i = 0; i < marks.length; i++) for (let j = i + 1; j < marks.length; j++) distances.add(Math.abs(marks[i] - marks[j]));
  for (let distance = 1; distance <= spec.length; distance++) {
    if (!distances.has(distance)) return `The ruler cannot measure length ${distance}.`;
  }
  return null;
}

type EditorCommand = { kind: 'move'; delta: number } | { kind: 'modify'; value: string } | { kind: 'repeat'; times: number; commands: EditorCommand[] };

export function checkTextEditor(spec: TextEditorGrading, answer: string): string | null {
  if (answer.length > 2_000) return 'The command is too long.';
  let at = 0;
  function parse(depth: number): EditorCommand[] {
    if (depth > 20) throw new Error('Too many nested repeats.');
    const commands: EditorCommand[] = [];
    while (at < answer.length && answer[at] !== ')') {
      const token = answer[at++];
      if (token === 'l' || token === 'r') commands.push({ kind: 'move', delta: token === 'l' ? -1 : 1 });
      else if (token === 'm') {
        const value = answer[at++];
        if (!/^[A-Z]$/.test(value ?? '')) throw new Error('A modification needs one capital letter.');
        commands.push({ kind: 'modify', value });
      } else if (token === '(') {
        const inner = parse(depth + 1);
        if (answer[at++] !== ')' || inner.length === 0) throw new Error('The repeat group is incomplete.');
        const digits = /^\d+/.exec(answer.slice(at))?.[0];
        if (!digits) throw new Error('A repeat group needs a count.');
        const times = Number(digits);
        if (!Number.isSafeInteger(times) || times < 1 || times > spec.maxCommands) throw new Error('Repeat count is outside the command limit.');
        at += digits.length;
        commands.push({ kind: 'repeat', times, commands: inner });
      } else throw new Error('Use mA, l, r, and (commands)N only.');
    }
    return commands;
  }
  let commands: EditorCommand[];
  try { commands = parse(0); if (at !== answer.length) throw new Error('Unexpected closing parenthesis.'); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  const letters = [...spec.initial];
  let cursor = 0, steps = 0;
  function run(sequence: EditorCommand[]): void {
    for (const command of sequence) {
      if (command.kind === 'repeat') {
        for (let i = 0; i < command.times; i++) run(command.commands);
      } else {
        if (++steps > spec.maxCommands) throw new Error('Command step limit exceeded.');
        if (command.kind === 'move') cursor = Math.max(0, Math.min(letters.length - 1, cursor + command.delta));
        else letters[cursor] = command.value;
      }
    }
  }
  try { run(commands); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  return letters.join('') === spec.target ? null : 'The command does not produce the target string.';
}

type Circuit = { kind: 'input'; name: 'A' | 'B' } | { kind: 'not'; child: Circuit } |
  { kind: 'binary'; operator: 'AND' | 'OR' | 'XOR' | 'XNOR'; left: Circuit; right: Circuit };

export function checkBooleanCircuit(spec: BooleanCircuitGrading, answer: string): string | null {
  const source = answer.toUpperCase();
  if (source.length > 500 || /[^A-Z()\s]/.test(source)) return 'Use variables, named logical operators, and parentheses only.';
  const tokens = source.match(/[A-Z]+|[()]/g) ?? [];
  if (tokens.join('') !== source.replace(/\s+/g, '')) return 'Invalid expression syntax.';
  let at = 0;
  function atom(depth: number): Circuit {
    if (depth > 30) throw new Error('Expression is too deeply nested.');
    const token = tokens[at++];
    if (token === 'A' || token === 'B') return { kind: 'input', name: token };
    if (token === 'NOT') return { kind: 'not', child: atom(depth + 1) };
    if (token === '(') {
      const inner = expression(depth + 1);
      if (tokens[at++] !== ')') throw new Error('Missing closing parenthesis.');
      return inner;
    }
    throw new Error('Expected A, B, NOT, or an opening parenthesis.');
  }
  function expression(depth: number): Circuit {
    const left = atom(depth);
    const op = tokens[at];
    if (op !== 'AND' && op !== 'OR' && op !== 'XOR' && op !== 'XNOR') return left;
    at++;
    const right = atom(depth);
    return { kind: 'binary', operator: op, left, right };
  }
  let circuit: Circuit;
  try { circuit = expression(0); if (at !== tokens.length) throw new Error('Put parentheses around combined operations.'); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  function cost(node: Circuit): number {
    if (node.kind === 'input') return 0;
    if (node.kind === 'not') return 5 + cost(node.child);
    return ({ AND: 3, OR: 1, XOR: 2, XNOR: 2 })[node.operator] + cost(node.left) + cost(node.right);
  }
  if (cost(circuit) > spec.maxCost) return `The expression exceeds ${spec.maxCost} time units.`;
  function evaluate(node: Circuit, a: boolean, b: boolean): boolean {
    if (node.kind === 'input') return node.name === 'A' ? a : b;
    if (node.kind === 'not') return !evaluate(node.child, a, b);
    const left = evaluate(node.left, a, b), right = evaluate(node.right, a, b);
    switch (node.operator) {
      case 'AND': return left && right;
      case 'OR': return left || right;
      case 'XOR': return left !== right;
      case 'XNOR': return left === right;
    }
  }
  const inputs: [boolean, boolean][] = [[false, false], [false, true], [true, false], [true, true]];
  return inputs.every(([a, b], index) => evaluate(circuit, a, b) === spec.expected[index])
    ? null : 'The expression does not match the truth table.';
}

function primeFactors(number: number): number[] {
  const result: number[] = [];
  let remaining = number;
  for (let divisor = 2; divisor * divisor <= remaining; divisor++) {
    while (remaining % divisor === 0) { result.push(divisor); remaining /= divisor; }
  }
  if (remaining > 1) result.push(remaining);
  return result;
}

export function checkPrimeFactorCounterexample(spec: PrimeFactorCounterexampleGrading, input: string, output: string): string | null {
  if (!/^\d+$/.test(input.trim()) || !/^[\s\d,;]+$/.test(output)) return 'Enter an integer and the printed factors.';
  const number = Number(input.trim());
  if (!Number.isSafeInteger(number) || number < spec.minimum || number > spec.maximum) return 'The input is outside the stated range.';
  const factors = (output.match(/\d+/g) ?? []).map(Number);
  let remaining = number;
  const faulty: number[] = [];
  for (let divisor = 2; divisor <= remaining; divisor++) {
    if (remaining % divisor === 0) { faulty.push(divisor); remaining /= divisor; }
  }
  const correct = primeFactors(number);
  if (faulty.length === correct.length && faulty.every((value, index) => value === correct[index])) return 'This input does not expose the bug.';
  return factors.length === faulty.length && factors.every((value, index) => value === faulty[index])
    ? null : 'The stated output does not match the faulty program.';
}

export function checkPrimeFactorCountCounterexample(spec: PrimeFactorCountCounterexampleGrading, answer: string): string | null {
  if (!/^\d+$/.test(answer.trim())) return 'Enter one integer.';
  const number = Number(answer.trim());
  if (!Number.isSafeInteger(number) || number < spec.minimum || number > spec.maximum) return 'The input is outside the stated range.';
  let remaining = number, faultyCount = 1;
  for (let divisor = 2; divisor * divisor <= remaining; divisor++) {
    if (remaining % divisor !== 0) continue;
    faultyCount++;
    while (remaining % divisor === 0) remaining /= divisor;
  }
  const distinctFactors = new Set(primeFactors(number)).size;
  return faultyCount !== distinctFactors ? null : 'The program gives the correct count for this input.';
}

export function checkTopTwoCounterexample(spec: TopTwoCounterexampleGrading, answer: string): string | null {
  if (!/^[\s\d,;+-]+$/.test(answer)) return `Enter ${spec.count} integers.`;
  const parts = answer.trim().split(/[\s,;]+/);
  if (parts.length !== spec.count || parts.some(part => !/^[+-]?\d+$/.test(part))) return `Enter ${spec.count} integers.`;
  const values = parts.map(Number);
  if (values.some(value => !Number.isSafeInteger(value) || value < spec.minimum || value > spec.maximum)) return 'An array element is outside the allowed range.';
  let largest = -1, second = -1;
  for (const value of values) {
    if (value > second && value < largest) second = value;
    else if (value > largest) { second = largest; largest = value; }
  }
  const expected = [...values].sort((a, b) => b - a);
  return largest !== expected[0] || second !== expected[1] ? null : 'The printed program gives the correct top two for this array.';
}
