import { expect, it } from 'vitest';
import source from '../../papers/2024-25-senior.json';
import cancelledSource from '../../papers/2019-20-junior.json';
import { gradeQuestion } from './grader';
import { validatePaper } from './validate';

const paper = validatePaper(source);
const question = (id: string) => {
  const found = paper.questions.find(item => item.id === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
};

it('grades the official graph construction through the shared API', async () => {
  const result = await gradeQuestion(question('paper1-j'), { J: '[["A","C"],["C","E"],["E","G"]]' });
  expect(result.status).toBe('pass');
  expect(result.score).toBe(question('paper1-j').points);
});

it('distinguishes a missing answer from a cancelled question', async () => {
  expect((await gradeQuestion(question('paper1-j'), {})).status).toBe('fail');
  const cancelled = validatePaper(cancelledSource);
  expect((await gradeQuestion(cancelled.questions.find(item => item.id === 'D')!, {})).status).toBe('cancelled');
});
