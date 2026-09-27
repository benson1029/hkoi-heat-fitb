import { expect, it } from 'vitest';
import source from '../../papers/2024-25-senior.json';
import cancelledSource from '../../papers/2019-20-junior.json';
import { gradeQuestion } from './grader';
import type { Question } from './types';
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

it('enforces prohibited identifiers as whole tokens', async () => {
  const constrained: Question = { ...question('paper1-a'), blanks: [{ id: 'A', forbiddenIdentifiers: ['f'] }],
    grading: { kind: 'literal', accepted: { A: ['ff'] }, normalize: 'trim' } };
  const prohibited = await gradeQuestion(constrained, { A: 'f' });
  expect(prohibited.status).toBe('fail');
  expect(prohibited.message).toContain('prohibited identifier');
  expect((await gradeQuestion(constrained, { A: 'ff' })).status).toBe('pass');
});

it('can exclude whitespace from a printed character limit', async () => {
  const constrained: Question = { ...question('paper1-a'), blanks: [{ id: 'A', maxChars: 5, maxCharsExcludeWhitespace: true }],
    grading: { kind: 'literal', accepted: { A: ['z = i % j'] }, normalize: 'none' } };
  expect((await gradeQuestion(constrained, { A: 'z = i % j' })).status).toBe('pass');
  expect((await gradeQuestion(constrained, { A: 'z = i % jj' })).message).toContain('character limit');
});
