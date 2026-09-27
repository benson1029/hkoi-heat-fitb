import { expect, it } from 'vitest';
import source from '../../papers/2024-25-sample-senior.json';
import { gradePaper, gradeQuestion } from './grader';
import type { PaperAnswers } from './types';
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

it('grades the complete sample paper on either Paper 2 language choice', async () => {
  const paper = validatePaper(source);
  const paper1: PaperAnswers = Object.fromEntries(
    Object.entries({ A: '2', B: '13', C: '11', D: '1371', E: '17', F: '79',
      G: '3', H: '2', I: '1', J: '3', K: '6' }).map(([blank, value]) =>
      [`paper1-${blank.toLowerCase()}`, { [blank]: value }])
  );
  const python: PaperAnswers = {
    'python-a': { A: '4' }, 'python-b': { B: '3,6' }, 'python-c': { C: '78' },
    'python-d': { D: '1,n' }, 'python-e': { E: 'x%4!=2 and y%4!=2' },
    'python-f': { F: 'f(x*2-2)' },
    'python-g': { G: 'a[i]==1 and a[j]==0 and a[k]==1' },
    'python-h': { H1: 'a[i]==0', H2: 'b[i]*(b[n-1]-b[i])' },
    'python-i': { I: '3' }, 'python-j': { J1: '15', J2: '51', J3: '85' }
  };
  const cpp: PaperAnswers = {
    'cpp-k': { K: '207' }, 'cpp-l': { L: '11' }, 'cpp-m': { M: '13700' },
    'cpp-n': { N: 'b+2' }, 'cpp-o': { O: '(f()*100+f())/125' },
    'cpp-p': { P: '47' }, 'cpp-q': { Q: '256' },
    'cpp-r': { R1: 'n', R2: 'n/i*i/2' }, 'cpp-s': { S: '23' },
    'cpp-t': { T1: '21', T2: 'i<n-1;' }
  };
  for (const [track, answers] of [['python', python], ['cpp', cpp]] as const) {
    const grade = await gradePaper(paper, { ...paper1, ...answers }, ['paper1', track]);
    expect(grade.questions).toHaveLength(21);
    expect(grade.questions.filter(item => item.status !== 'pass').map(item => [item.questionId, item.status, item.cases.find(testCase => testCase.status !== 'pass')?.message ?? item.message])).toEqual([]);
    expect(grade.scoredPoints).toBe(30);
    expect(grade.complete).toBe(true);
  }
}, 120_000);
