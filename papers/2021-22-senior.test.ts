import { expect, it } from 'vitest';
import source from './2021-22-senior.json';
import { gradePaper, gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'cpp-a': { A1: 'c', A2: 'c', A3: '1' },
  'cpp-b': { B: '20' },
  'cpp-c': { C: '16' },
  'cpp-d': { D: 'x-y==i-j' },
  'cpp-e': { E: 'x+y==i+j' },
  'cpp-f': { F: '3' },
  'cpp-g': { G: '6' },
  'cpp-h': { H: '16168' },
  'cpp-i': { I1: '47', I2: 'x=x/2;y=y+y;' },
  'cpp-j': { J: 'f()/25*20+f()/5' },
  'cpp-k': { K: '225' },
  'cpp-l': { L: '1' },
  'cpp-m': { M: '1' },
  'cpp-n': { N: '769/256' }
};

it('grades the official 2021/22 Senior Section B answers', async () => {
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions).toHaveLength(14);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);

it('rejects asterisk use in the multiplication line repair', async () => {
  const question = paper.questions.find(item => item.id === 'cpp-i')!;
  expect((await gradeQuestion(question, { I1: '47', I2: 'y+=y;x/=2;' }, 'cpp')).status).toBe('pass');
  expect((await gradeQuestion(question, { I1: '47', I2: 'y*=2;x/=2;' }, 'cpp')).status).toBe('fail');
}, 30_000);
