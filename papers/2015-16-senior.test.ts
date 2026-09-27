import { expect, it } from 'vitest';
import source from './2015-16-senior.json';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'c-a': { A: 'i=4;i>=2;i--' },
  'c-b': { B: 's[i-1]' },
  'c-c': { C: '1,a-b' },
  'c-d': { D: '101,a-b-101' },
  'c-e': { E: '7' },
  'c-f': { F: '2008' },
  'c-g': { G: '61' },
  'c-h': { H: 'if(l<n&&a[l]==x)' },
  'c-i': { I1: '31', I2: '35' },
  'c-j': { J: 'abs(a-x)+abs(y-b)==3' },
  'c-k': { K: 'abs(a-x)+abs(y-b)==4&&a!=x&&y!=b' },
  'c-l': { L: JSON.stringify([
    [[0.25, 0], [1, 0.5]], [[1, 0.5], [0.25, 1]], [[0.25, 1], [0.25, 0]],
    [[0.75, 0], [0, 0.5]], [[0, 0.5], [0.75, 1]], [[0.75, 1], [0.75, 0]]
  ]) }
};

it('grades the official 2015/16 Senior Section B answers and drawing', async () => {
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.questions).toHaveLength(12);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);

it('rejects the published binary-search correction when it reads past the array', async () => {
  const result = await gradePaper(paper, { 'c-h': { H: 'if (a[l] == x)' } }, ['section-b']);
  expect(result.questions.find(item => item.questionId === 'c-h')?.status).toBe('fail');
}, 60_000);

it('rejects a different Logo drawing', async () => {
  const square = JSON.stringify([
    [[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]
  ]);
  const result = await gradePaper(paper, { 'c-l': { L: square } }, ['section-b']);
  expect(result.questions.find(item => item.questionId === 'c-l')?.status).toBe('fail');
}, 60_000);
