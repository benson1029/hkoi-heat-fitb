import { expect, it } from 'vitest';
import { gradeQuestion } from './grader';
import type { Question } from './types';

function sample(grading: Question['grading'], blankIds: string[]): Question {
  return { id: 'sample', track: 'section-b', printedRef: 'Section B, Question 1, Blank A', title: 'Test',
    prompt: { en: 'Test' }, points: 1, blanks: blankIds.map(id => ({ id, maxChars: 100 })), grading };
}

it('counts paths through exactly one selected checkpoint', async () => {
  const question = sample({ kind: 'grid-checkpoints', answerBlank: 'E', width: 5, height: 5, expectedPaths: 16 }, ['E']);
  expect((await gradeQuestion(question, { E: 'E1 C5' })).status).toBe('pass');
  expect((await gradeQuestion(question, { E: 'E1 E1' })).status).toBe('fail');
  expect((await gradeQuestion(question, { E: 'A1 C5' })).status).toBe('fail');
});

it('checks unordered seats, square numbers, and inversion count', async () => {
  const seats = sample({ kind: 'integer-list', answerBlanks: ['D1', 'D2', 'D3'], count: 3,
    minimum: 1, maximum: 18, distinct: true, minimumSpacing: { anchors: [4, 13, 18], required: 3 } }, ['D1', 'D2', 'D3']);
  expect((await gradeQuestion(seats, { D1: '10', D2: '1', D3: '7' })).status).toBe('pass');
  expect((await gradeQuestion(seats, { D1: '10', D2: '1', D3: '10' })).status).toBe('fail');
  const squares = sample({ kind: 'integer-list', answerBlanks: ['A', 'B'], count: 2,
    minimum: 11, maximum: 99, distinct: true, squareOnly: true }, ['A', 'B']);
  expect((await gradeQuestion(squares, { A: '16', B: '25' })).status).toBe('pass');
  expect((await gradeQuestion(squares, { A: '16', B: '16' })).status).toBe('fail');
  const inversions = sample({ kind: 'integer-list', answerBlanks: ['J'], count: 4,
    minimum: 1, maximum: 4, distinct: true, allowed: [1, 2, 3, 4], inversionCount: 6 }, ['J']);
  expect((await gradeQuestion(inversions, { J: '4 3 2 1' })).status).toBe('pass');
  expect((await gradeQuestion(inversions, { J: '1 2 3 4' })).status).toBe('fail');
});

it('checks matrix multiplicities and row and column totals', async () => {
  const question = sample({ kind: 'matrix-sums', answerBlank: 'C', values: [0, 1, 2], each: 3,
    rowSums: [5, 3, 1], colSums: [1, 5, 3] }, ['C']);
  expect((await gradeQuestion(question, { C: '1 2 2 0 2 1 0 1 0' })).status).toBe('pass');
  expect((await gradeQuestion(question, { C: '1 2 2 0 1 2 0 2 0' })).status).toBe('fail');
});

it('excludes cancelled blanks from the score', async () => {
  const question = sample({ kind: 'cancelled', reason: 'Cancelled by HKOI.' }, ['D']);
  question.points = 0;
  expect((await gradeQuestion(question, {})).status).toBe('cancelled');
});

it('awards partial credit for a valid nonmaximum counterexample', async () => {
  const question = sample({ kind: 'counterexample-max', answerBlank: 'F', minimum: 10000, maximum: 32767,
    modulus: 9, residues: [0, 8], partialPoints: 2 }, ['F']);
  question.points = 3;
  expect((await gradeQuestion(question, { F: '10008' })).score).toBe(2);
  expect((await gradeQuestion(question, { F: '32760' })).score).toBe(3);
  expect((await gradeQuestion(question, { F: '32767' })).score).toBe(0);
});

it('checks only the paper-specific two’s-complement overflow witness', async () => {
  const question = sample({ kind: 'signed-wrap-sum', answerBlanks: ['E1','E2'], minimum: 1,
    maximum: 2147483647, requiredSum: 4294967126 }, ['E1','E2']);
  expect((await gradeQuestion(question, { E1: '2147483647', E2: '2147483479' })).status).toBe('pass');
  expect((await gradeQuestion(question, { E1: '2147483647', E2: '2147483647' })).status).toBe('fail');
});

it('awards one point for die count and two for exact orientation', async () => {
  const question = sample({ kind: 'die-face', answerBlank: 'I', expected: 'ooo/.../ooo' }, ['I']);
  question.points = 2;
  expect((await gradeQuestion(question, { I: 'ooo/.../ooo' })).score).toBe(2);
  expect((await gradeQuestion(question, { I: 'o.o/o.o/o.o' })).score).toBe(1);
  expect((await gradeQuestion(question, { I: 'o../.../...' })).score).toBe(0);
});

it('recognizes prime powers for the old factor-list program', async () => {
  const question = sample({ kind: 'prime-power-pair', correctBlank: 'I1', incorrectBlank: 'I2',
    minimum: 31, maximum: 99999 }, ['I1','I2']);
  expect((await gradeQuestion(question, { I1: '32', I2: '33' })).status).toBe('pass');
  expect((await gradeQuestion(question, { I1: '33', I2: '32' })).status).toBe('fail');
});

it('evaluates fully parenthesized NAND expressions', async () => {
  const question = sample({ kind: 'nand-expression', answerBlank: 'B', expected: [true,false,false,false] }, ['B']);
  expect((await gradeQuestion(question, { B: '((AQB)Q(AQB))' })).status).toBe('pass');
  expect((await gradeQuestion(question, { B: 'AQA' })).status).toBe('fail');
});

it('grades a scaled six-point Logo drawing by its line geometry', async () => {
  const lines: [[number,number],[number,number]][] = [
    [[.25,0],[1,.5]],[[1,.5],[.25,1]],[[.25,1],[.25,0]],
    [[.75,0],[0,.5]],[[0,.5],[.75,1]],[[.75,1],[.75,0]]
  ];
  const question = sample({ kind: 'logo-drawing', answerBlank: 'L', segments: lines, tolerance: .08 }, ['L']);
  question.blanks[0].maxChars = undefined;
  const scaled = lines.map(([a,b]) => [a.map((v,i) => v*.7+(i===0?.1:.15)),b.map((v,i) => v*.7+(i===0?.1:.15))]);
  expect((await gradeQuestion(question, { L: JSON.stringify(scaled) })).status).toBe('pass');
  expect((await gradeQuestion(question, { L: JSON.stringify([[[0,0],[1,1]],[[1,1],[0,1]]]) })).status).toBe('fail');
});
