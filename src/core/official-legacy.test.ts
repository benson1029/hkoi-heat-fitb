import { expect, it } from 'vitest';
import source from '../../papers/2011-12-senior.json';
import { gradeQuestion } from './grader';
import { validatePaper } from './validate';

it('grades the official exhaustive-obstacle robot command', async () => {
  const paper = validatePaper(source);
  const question = paper.questions.find(item => item.id === 'K');
  if (!question) throw new Error('2011/12 Senior robot K is missing');
  const answer = '(<)9v(<^)9((>)9(<)9v)9(>)9^(>v)9((<)9(>)9^)9';
  const grade = await gradeQuestion(question, { K: answer });
  expect(grade.status, grade.message).toBe('pass');
  expect(grade.score).toBe(3);
}, 20_000);
