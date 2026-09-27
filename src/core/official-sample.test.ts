import { expect, it } from 'vitest';
import source from '../../papers/2024-25-sample-senior.json';
import { gradeQuestion } from './grader';
import { validatePaper } from './validate';

it('grades every sample Paper 1 blank from the official solution', async () => {
  const paper = validatePaper(source);
  const answers: Record<string, string> = {
    A: '2', B: '13', C: '11', D: '1371', E: '17', F: '79',
    G: '3', H: '2', I: '1', J: '3', K: '6'
  };
  const units = paper.questions.filter(question => question.track === 'paper1');
  expect(units).toHaveLength(11);
  let score = 0;
  for (const question of units) {
    const blank = question.blanks[0].id;
    const grade = await gradeQuestion(question, { [blank]: answers[blank] });
    expect(grade.status, question.printedRef).toBe('pass');
    score += grade.score ?? 0;
  }
  expect(score).toBe(15);
  for (const id of ['a', 'c', 'e', 'f']) {
    const question = paper.questions.find(item => item.id === `paper1-${id}`);
    expect(question?.displayCode?.python).toBeTruthy();
    expect(question?.displayCode?.cpp).toBeTruthy();
  }
});

it('grades the sample C++ uniform random expression exactly', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'cpp-o');
  if (!question) throw new Error('Sample C++ O is missing');
  expect((await gradeQuestion(question, { O: '(f()*100+f())/125' })).status).toBe('pass');
  expect((await gradeQuestion(question, { O: 'f()%80' })).status).toBe('fail');
});

it('grades the sample C++ line repair against the printed examples and extra cases', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'cpp-t');
  if (!question) throw new Error('Sample C++ T is missing');
  expect((await gradeQuestion(question, { T1: '21', T2: 'i<n-1;' })).status).toBe('pass');
  expect((await gradeQuestion(question, { T1: '21', T2: 'i+1<n;' })).status).toBe('pass');
  expect((await gradeQuestion(question, { T1: '21', T2: 'i<a.size();' })).status).toBe('fail');
});
