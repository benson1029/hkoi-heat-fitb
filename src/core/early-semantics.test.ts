import { expect, it } from 'vitest';
import {
  checkBooleanCircuit, checkDifferencePyramid, checkSparseRuler,
  checkPrimeFactorCounterexample, checkPrimeFactorCountCounterexample,
  checkStringReplacementCounterexample, checkTextEditor, checkTopTwoCounterexample
} from './early-semantics';

it('finds semantic counterexamples to a one-occurrence replacement', () => {
  const spec = { kind: 'string-replacement-counterexample' as const, answerBlank: 'N', needle: 'HKOI2003', replacement: 'HKOI2004', maxInputLength: 255 };
  expect(checkStringReplacementCounterexample(spec, 'HKOI2003 HKOI2003')).toBeNull();
  expect(checkStringReplacementCounterexample(spec, 'HKOI2003')).not.toBeNull();
  expect(checkStringReplacementCounterexample(spec, 'HKOI2003'.repeat(32))).not.toBeNull();
});

it('accepts every valid difference-pyramid permutation', () => {
  const spec = { kind: 'difference-pyramid' as const, answerBlank: 'J', values: [1, 2, 3, 4, 5, 6] };
  expect(checkDifferencePyramid(spec, '3/1,4/5,6,2')).toBeNull();
  expect(checkDifferencePyramid(spec, '1/3,4/5,2,6')).toBeNull();
  expect(checkDifferencePyramid(spec, '3/1,4/5,2,6')).not.toBeNull();
});

it('checks every distance of a sparse ruler', () => {
  const spec = { kind: 'sparse-ruler' as const, answerBlank: 'D', length: 9, maxMarks: 5 };
  expect(checkSparseRuler(spec, '{0, 1, 2, 6, 9}')).toBeNull();
  expect(checkSparseRuler(spec, '0, 1, 2, 5, 9')).not.toBeNull();
});

it('executes bounded text-editor commands', () => {
  const spec = { kind: 'text-editor' as const, answerBlank: 'A', initial: 'TCTCTCTCTCTC', target: 'AGAGAGAGAGAG', maxCommands: 1000 };
  expect(checkTextEditor(spec, '(mArmGr)6')).toBeNull();
  expect(checkTextEditor(spec, '(mArmGr)5')).not.toBeNull();
  expect(checkTextEditor(spec, '(mA)9999')).not.toBeNull();
});

it('checks a Boolean expression against both cost and truth table', () => {
  const spec = { kind: 'boolean-circuit' as const, answerBlank: 'B', expected: [true, true, false, true] as [boolean, boolean, boolean, boolean], maxCost: 5 };
  expect(checkBooleanCircuit(spec, '(A XNOR B) OR B')).toBeNull();
  expect(checkBooleanCircuit(spec, '(NOT A) OR B')).not.toBeNull();
  expect(checkBooleanCircuit(spec, 'A OR B')).not.toBeNull();
  expect(checkBooleanCircuit(spec, 'A XNOR B OR B')).not.toBeNull();
});

it('compares a faulty factorization with its stated output and the true factors', () => {
  const spec = { kind: 'prime-factor-counterexample' as const, inputBlank: 'G', outputBlank: 'H', minimum: 2, maximum: 10_000 };
  expect(checkPrimeFactorCounterexample(spec, '8', '2 4')).toBeNull();
  expect(checkPrimeFactorCounterexample(spec, '100', '2 5 10')).toBeNull();
  expect(checkPrimeFactorCounterexample(spec, '8', '2 2 2')).not.toBeNull();
  expect(checkPrimeFactorCounterexample(spec, '6', '2 3')).not.toBeNull();
});

it('accepts inputs exposing the faulty distinct-prime-factor count', () => {
  const spec = { kind: 'prime-factor-count-counterexample' as const, answerBlank: 'F', minimum: 2, maximum: 1001 };
  expect(checkPrimeFactorCountCounterexample(spec, '9')).toBeNull();
  expect(checkPrimeFactorCountCounterexample(spec, '36')).toBeNull();
  expect(checkPrimeFactorCountCounterexample(spec, '12')).not.toBeNull();
});

it('finds arrays where the printed top-two code misses a duplicate maximum', () => {
  const spec = { kind: 'top-two-counterexample' as const, answerBlank: 'H', count: 5, minimum: -32768, maximum: 32767 };
  expect(checkTopTwoCounterexample(spec, '5 5 1 2 3')).toBeNull();
  expect(checkTopTwoCounterexample(spec, '5 4 3 2 1')).not.toBeNull();
  expect(checkTopTwoCounterexample(spec, '-2 -3 -4 -5 -6')).toBeNull();
});
