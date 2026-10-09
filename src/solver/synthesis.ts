import type { Language, ProgramCase, ProgramTarget, Question } from '../core/types';

type Examples = { inputs: number[][]; expected: number[] };
type Atom = { text: string; values: number[]; variable: boolean };

function pureReturn(target: ProgramTarget, blankId: string): string[] | undefined {
  if (target.helperSource || target.harness.kind !== 'call') return undefined;
  const source = target.source.trim();
  const c = /^(?:int|long|short|bool|double|float)\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{\s*return\s+\{\{[^{}]+\}\}\s*;\s*\}/.exec(source);
  const py = /^def\s+([A-Za-z_]\w*)\s*\(([^()]*)\)(?:\s*->\s*[A-Za-z_]\w*)?\s*:\s*\n\s*return\s+\{\{[^{}]+\}\}/.exec(source);
  if (!source.includes(`{{${blankId}}}`) || (target.language === 'python' ? !py : !c)) return undefined;
  const declarationMatch = target.language === 'python' ? py! : c!;
  if (declarationMatch[1] !== target.harness.function) return undefined;
  const declarations = declarationMatch[2].split(',');
  const names: string[] = [];
  for (const declaration of declarations) {
    const pattern = target.language === 'python'
      ? /^\s*([A-Za-z_]\w*)\s*:\s*(?:int|bool)\s*$/
      : /^\s*(?:int|long|short|bool|char)\s+([A-Za-z_]\w*)\s*$/;
    const name = pattern.exec(declaration)?.[1];
    if (!name || names.includes(name)) return undefined;
    names.push(name);
  }
  return names.length >= 1 && names.length <= 4 ? names : undefined;
}

function numericCases(cases: ProgramCase[], language: Language, names: string[]): Examples | undefined {
  if (cases.length < 3 || cases.length > 64) return undefined;
  const inputs: number[][] = [];
  const expected: number[] = [];
  for (const testCase of cases) {
    const args = testCase.args;
    const target = testCase.expectedByLanguage?.[language] ?? testCase.expected;
    if (!args || args.length !== names.length || !args.every(value => typeof value === 'number'
      && Number.isSafeInteger(value) && Math.abs(value) <= 2_147_483_647)
      || target.stdout !== undefined || target.argsAfter !== undefined
      || typeof target.returnValue !== 'number' && typeof target.returnValue !== 'boolean') return undefined;
    inputs.push(args as number[]);
    expected.push(typeof target.returnValue === 'boolean' ? Number(target.returnValue) : target.returnValue);
  }
  if (new Set(inputs.map(row => row.join(','))).size < 3) return undefined;
  return { inputs, expected };
}

function combine(op: string, a: number, b: number, language: Language): number | undefined {
  let result: number;
  switch (op) {
    case '+': result = a + b; break;
    case '-': result = a - b; break;
    case '*': result = a * b; break;
    case '/': if (b === 0) return undefined; result = language === 'python' ? a / b : Math.trunc(a / b); break;
    case '%': if (b === 0) return undefined; result = language === 'python' ? ((a % b) + b) % b : a % b; break;
    case '^': result = a ^ b; break;
    case '&': result = a & b; break;
    case '|': result = a | b; break;
    case '==': result = Number(a === b); break;
    case '!=': result = Number(a !== b); break;
    case '<': result = Number(a < b); break;
    case '<=': result = Number(a <= b); break;
    case '>': result = Number(a > b); break;
    case '>=': result = Number(a >= b); break;
    default: return undefined;
  }
  return Number.isSafeInteger(result) && Math.abs(result) <= 2_147_483_647 ? result : undefined;
}

function renderAffine(names: string[], coefficients: number[], constant: number): string {
  const terms: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const coefficient = coefficients[i];
    if (!coefficient) continue;
    const magnitude = Math.abs(coefficient);
    terms.push(`${coefficient < 0 ? '-' : '+'}${magnitude === 1 ? '' : `${magnitude}*`}${names[i]}`);
  }
  if (constant) terms.push(`${constant < 0 ? '-' : '+'}${Math.abs(constant)}`);
  return (terms.join('').replace(/^\+/, '') || '0');
}

/** Fits short arithmetic expressions to configured examples; every result is rechecked by the full grader. */
export function* generateExampleCandidates(question: Question, blankId: string, language: Language): Generator<string> {
  if (question.grading.kind !== 'program') return;
  const target = question.grading.targets.find(item => item.language === language);
  if (!target) return;
  const names = pureReturn(target, blankId);
  if (!names) return;
  const examples = numericCases(question.grading.cases, language, names);
  if (!examples) return;
  const maxChars = Math.min(question.blanks.find(item => item.id === blankId)?.maxChars ?? 20, 24);
  const matches = new Set<string>();
  const equalsTarget = (values: (number | undefined)[]) => values.length === examples.expected.length
    && values.every((value, i) => value === examples.expected[i]);
  const add = (text: string, values: (number | undefined)[]) => {
    if (text.length <= maxChars && equalsTarget(values)) matches.add(text);
  };
  const constants = [...new Set([
    ...(target.source.match(/(?<![\w.])-?\d+(?![\w.])/g) ?? []).map(Number),
    ...Array.from({ length: 33 }, (_, i) => i), -1, -2, -3, -4
  ])].filter(value => Number.isSafeInteger(value) && Math.abs(value) <= 999);
  const atoms: Atom[] = [
    ...names.map((text, index) => ({ text, values: examples.inputs.map(row => row[index]), variable: true })),
    ...constants.map(value => ({ text: String(value), values: examples.inputs.map(() => value), variable: false }))
  ].filter(atom => atom.text.length <= maxChars);
  for (const atom of atoms) add(atom.text, atom.values);

  const targetBoolean = examples.expected.every(value => value === 0 || value === 1);
  // A handful of truth-table rows can be matched by accidental predicates.
  // Keep Boolean synthesis for cases with enough observations to constrain it.
  if (targetBoolean && examples.inputs.length < 9) return;
  const operators = targetBoolean
    ? ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=']
    : ['+', '-', '*', '/', '%', '^', '&', '|'];
  for (const left of atoms) for (const right of atoms) {
    if (!left.variable && !right.variable) continue;
    for (const op of operators) {
      const text = `${left.text}${op}${right.text}`;
      if (text.length > maxChars) continue;
      add(text, left.values.map((value, i) => combine(op, value, right.values[i], language)));
    }
  }

  // Infer affine terms from examples. The intercept follows from the first example,
  // so the search has only 9^arity coefficient combinations rather than 65*9^arity.
  const affine: Atom[] = [];
  const coefficients = Array(names.length).fill(0) as number[];
  const enumerateCoefficients = (index: number) => {
    if (index < names.length) {
      for (let coefficient = -4; coefficient <= 4; coefficient++) {
        coefficients[index] = coefficient;
        enumerateCoefficients(index + 1);
      }
      return;
    }
    if (coefficients.every(value => value === 0)) return;
    const firstSum = coefficients.reduce((sum, value, i) => sum + value * examples.inputs[0][i], 0);
    const constant = examples.expected[0] - firstSum;
    if (!Number.isSafeInteger(constant) || Math.abs(constant) > 99) return;
    const text = renderAffine(names, coefficients, constant);
    if (text.length > maxChars) return;
    const values = examples.inputs.map(row => constant + coefficients.reduce((sum, value, i) => sum + value * row[i], 0));
    add(text, values);
  };
  enumerateCoefficients(0);

  // Quotients/remainders of small affine numerators cover common ceiling division
  // and index formulas while staying bounded for up to two input variables.
  if (names.length <= 2) {
    const numeratorCoefficients = Array(names.length).fill(0) as number[];
    const buildNumerators = (index: number) => {
      if (index < names.length) {
        for (let coefficient = -2; coefficient <= 2; coefficient++) {
          numeratorCoefficients[index] = coefficient;
          buildNumerators(index + 1);
        }
        return;
      }
      if (numeratorCoefficients.every(value => value === 0)) return;
      for (let constant = -2; constant <= 2; constant++) {
        const text = renderAffine(names, numeratorCoefficients, constant);
        if (text.length > maxChars) continue;
        affine.push({ text, values: examples.inputs.map(row => constant
          + numeratorCoefficients.reduce((sum, value, i) => sum + value * row[i], 0)), variable: true });
      }
    };
    buildNumerators(0);
    const numeratorAtoms: Atom[] = [...atoms.filter(atom => atom.variable), ...affine];
    const denominators = atoms.filter(atom => atom.variable || Number(atom.text) >= 2 && Number(atom.text) <= 12);
    for (const numerator of numeratorAtoms) for (const denominator of denominators) for (const op of ['/', '%']) {
      const text = `${numerator.text.includes('+') || numerator.text.slice(1).includes('-') ? `(${numerator.text})` : numerator.text}${op}${denominator.text}`;
      if (text.length > maxChars) continue;
      add(text, numerator.values.map((value, i) => combine(op, value, denominator.values[i], language)));
    }
    for (const variable of atoms.filter(atom => atom.variable)) for (const divisor of [2, 3, 4, 5, 8, 10, 16, 32, 64, 128]) {
      const quotient = variable.values.map(value => combine('/', value, divisor, language));
      for (const offset of [-4, -3, -2, -1, 1, 2, 3, 4]) {
        const text = `${variable.text}/${divisor}${offset < 0 ? '' : '+'}${offset}`;
        add(text, quotient.map(value => value === undefined ? undefined : combine('+', value, offset, language)));
      }
    }
    // A short factor times a variable is common in counting/indexing questions.
    for (const affineTerm of affine) {
      if (affineTerm.text.length > 8) continue;
      for (const variable of atoms.filter(atom => atom.variable)) {
        const text = `(${affineTerm.text})*${variable.text}`;
        if (text.length <= maxChars) add(text, affineTerm.values.map((value, i) => combine('*', value, variable.values[i], language)));
      }
    }
  }
  if (targetBoolean && names.length <= 2) {
    const positives = examples.expected.map(value => value === 1);
    const predicates = new Map<string, { text: string; values: boolean[] }>();
    const predicate = (text: string, values: (number | undefined)[]) => {
      if (text.length > maxChars || values.some((value, i) => value === undefined || Boolean(value) && !positives[i])) return;
      const trueValues = values.map(value => Boolean(value));
      if (!trueValues.some(Boolean)) return;
      const key = trueValues.map(value => Number(value)).join('');
      if (!predicates.has(key) || text.length < predicates.get(key)!.text.length) predicates.set(key, { text, values: trueValues });
    };
    const comparisonAtoms = [...atoms.filter(atom => atom.variable),
      ...atoms.filter(atom => !atom.variable && Number(atom.text) <= 32),
      ...(names.length === 2 ? [{ text: `${names[0]}+${names[1]}`,
        values: examples.inputs.map(row => row[0] + row[1]), variable: true }] : [])];
    for (const left of comparisonAtoms) for (const right of comparisonAtoms) {
      if (!left.variable && !right.variable) continue;
      for (const op of ['==', '!=', '<', '<=', '>', '>=']) {
        const text = `${left.text}${op}${right.text}`;
        const values = left.values.map((value, i) => combine(op, value, right.values[i], language));
        add(text, values);
        predicate(text, values);
      }
      if (!left.variable || !right.variable || left.text === right.text) continue;
      const remainder = left.values.map((value, i) => combine('%', value, right.values[i], language));
      const values = remainder.map(value => value === undefined ? undefined : Number(value === 0));
      const text = `${left.text}%${right.text}==0`;
      add(text, values);
      predicate(text, values);
    }
    const useful = [...predicates.values()].sort((a, b) => a.text.length - b.text.length).slice(0, 100);
    const disjunction = language === 'python' ? ' or ' : '||';
    for (let i = 0; i < useful.length; i++) for (let j = i + 1; j < useful.length; j++) {
      const text = `${useful[i].text}${disjunction}${useful[j].text}`;
      if (text.length > maxChars) continue;
      add(text, useful[i].values.map((value, k) => Number(value || useful[j].values[k])));
    }
  }
  yield* [...matches].sort((a, b) => a.length - b.length || a.localeCompare(b));
}
