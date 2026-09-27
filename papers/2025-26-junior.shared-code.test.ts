import { expect, it } from 'vitest';
import source from './2025-26-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

const paper = validatePaper(source);

it('shows the printed Python program once with separate answer sets for J and K', async () => {
  const context = paper.contexts?.find(item => item.id === 'python-q2-f');
  const j = paper.questions.find(item => item.id === 'python-j');
  const k = paper.questions.find(item => item.id === 'python-k');
  if (!context || !j || !k || j.grading.kind !== 'program' || k.grading.kind !== 'program') {
    throw new Error('The shared Python program is missing');
  }
  expect(j.contextId).toBe(context.id);
  expect(k.contextId).toBe(context.id);
  expect(context.answerSets).toEqual([
    { questionId: 'python-j', label: '(a) · J', bindings: { expression: 'J' } },
    { questionId: 'python-k', label: '(b) · K', bindings: { expression: 'K' } }
  ]);
  expect(context.displayCode?.python?.replace('{{expression}}', '{{J}}')).toBe(j.grading.targets[0].source);
  expect(context.displayCode?.python?.replace('{{expression}}', '{{K}}')).toBe(k.grading.targets[0].source);
  expect((await gradeQuestion(j, { J: 'x[-4:]' })).status).toBe('pass');
  expect((await gradeQuestion(k, { K: 'sorted(x)' })).status).toBe('pass');
  expect((await gradeQuestion(j, { J: 'sorted(x)' })).status).toBe('fail');
  expect((await gradeQuestion(k, { K: 'x[-4:]' })).status).toBe('fail');
}, 60_000);
