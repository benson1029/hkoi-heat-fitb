import { expect, it } from 'vitest';
import { gradeQuestion } from './grader';
import type { Question } from './types';

const question: Question = {
  id: 'repair', track: 'cpp', title: 'Repair', printedRef: 'Section C, Question 2, Blanks T1 and T2',
  prompt: { en: 'Find the line and correct it.' }, points: 2,
  blanks: [{ id: 'T1', maxChars: 2 }, { id: 'T2', maxChars: 17 }],
  grading: {
    kind: 'cpp-line-repair', lineBlank: 'T1', replacementBlank: 'T2', firstLine: 11,
    source: 'int main() {\nint x = 1;\ncout << x;\n}',
    cases: [{ id: 'output', stdin: '', expected: { stdout: '2' }, maxSteps: 1000 }]
  }
};

it('runs the program after replacing only the chosen printed line', async () => {
  expect((await gradeQuestion(question, { T1: '12', T2: 'int x = 2;' })).status).toBe('pass');
  expect((await gradeQuestion(question, { T1: '10', T2: 'int x = 2;' })).status).toBe('fail');
  expect((await gradeQuestion(question, { T1: '12', T2: 'int x = 3;' })).status).toBe('fail');
});

it('wraps a numbered segment and can append to its selected line', async () => {
  const segmented: Question = { ...question, grading: {
    ...question.grading as Extract<Question['grading'], { kind: 'cpp-line-repair' }>,
    firstLine: 51, source: 'int x = 1;', prefixSource: 'int main() {\n', suffixSource: '\ncout << x;\n}', mode: 'append'
  } };
  expect((await gradeQuestion(segmented, { T1: '51', T2: ' x++;' })).status).toBe('pass');
});
