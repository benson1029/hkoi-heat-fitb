import { expect, it } from 'vitest';
import source from './2017-18-senior.json';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'cpp-a': { A1: 'a+x', A2: '5050-a' },
  'cpp-b': { B: 't=a[x];a[x]=a[y];a[y]=t' },
  'cpp-c': { C: 'k-i-1' },
  'cpp-d': { D: 'f(100);f(k);f(100)' },
  'cpp-e': { E: 'E1 C5' },
  'cpp-f': { F: 'E3 D4' },
  'cpp-g': { G: '96' },
  'cpp-h': { H: 'x^32' },
  'cpp-i': { I1: 'num[i]+abs(num[i])', I2: 'temp/2' },
  'cpp-j': { J1: 'i=2;', J2: 'n%i==0' },
  'cpp-k': { K: 'answer+is_prime(i)' },
  'cpp-l': { L1: '88', L2: 'for(i=0;i<=10000;i++)' }
};

it('grades official 2017/18 Senior Section B answers', async () => {
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.questions).toHaveLength(12);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);
