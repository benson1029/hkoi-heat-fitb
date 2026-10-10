import { expect, it } from 'vitest';
import { gradeQuestion } from './grader';
import type { Question } from './types';

const question: Question = {
  id: 'python-runtime', track: 'python', printedRef: 'Python A', title: 'Python A',
  prompt: { en: 'Complete the function.' }, points: 1, blanks: [{ id: 'A' }],
  grading: {
    kind: 'program', targetPolicy: 'any',
    targets: [{ language: 'python', source: 'import math\ndef f(x):\n    return {{A}}',
      harness: { kind: 'call', function: 'f' } }],
    cases: [{ id: 'floor', args: [2.7], expected: { returnValue: 2 }, maxSteps: 1_000 }]
  }
};

it('uses the selected Python runtime for grading', async () => {
  const answers = { A: 'math.floor(x)' };
  expect((await gradeQuestion(question, answers, 'python')).status).toBe('inconclusive');
  expect((await gradeQuestion(question, answers, 'python', undefined, { pythonRuntime: 'pyodide' })).status).toBe('pass');
}, 60_000);
