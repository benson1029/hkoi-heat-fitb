import { expect, it } from 'vitest';
import source from './2018-19-senior.json';
import { gradePaper, gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'cpp-a': { A: '10' },
  'cpp-b': { B: 'ans^=x' },
  'cpp-c': { C: '!(x&(x-1))' },
  'cpp-d': { D1: '16', D2: '25' },
  'cpp-e': { E1: 'i*i==n', E2: 'sum-i' },
  'cpp-f': { F: 'sum_factors(n)' },
  'cpp-g': { G1: 'sum>2*n', G2: 'sum==2*n' },
  'cpp-h': { H: '45' },
  'cpp-i': { I: '21' },
  'cpp-j': { J: '10 9 8 7 6 5 4 1 2 3' },
  'cpp-k': { K: '50' },
  'cpp-l': { L1: 'a[m]>=target', L2: 'l=m+1', L3: 'l-1' },
  'cpp-m': { M: '2' },
  'cpp-n': { N1: '76', N2: 'else;' }
};

it('grades official 2018/19 Senior Section B answers', async () => {
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.questions).toHaveLength(14);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);

it('rejects the published L3 answer on a valid boundary case', async () => {
  const question = paper.questions.find(item => item.id === 'cpp-l')!;
  const grade = await gradeQuestion(question, { L1: 'a[m]>=target', L2: 'l=m+1', L3: 'm-1' });
  expect(grade.status).toBe('fail');
  expect(grade.cases[0]?.id).toContain('array-0-target-0');
});
