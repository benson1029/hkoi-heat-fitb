import { expect, it } from 'vitest';
import source from './2016-17-senior.json';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'cpp-a': { A1: '62', A2: 'a[j + 1] = t;' },
  'cpp-b': { B: '7' },
  'cpp-c': { C: '753*+84/-' },
  'cpp-d': { D1: '1', D2: '7', D3: '10' },
  'cpp-e': { E: '3' },
  'cpp-f': { F: 'st + ed - i' },
  'cpp-g': { G: 'true' },
  'cpp-h': { H: 's[st]==s[ed]' },
  'cpp-i': { I: 's[st]==s[ed]&&f(st+1,ed-1)' },
  'cpp-j': { J: 'x*x*x*x%y==0&&y*y*y*y%x==0' },
  'cpp-k': { K: 'min(a*a*9+4+a,b*b*9+4+b)%9-4' },
  'cpp-l': { L: '16' },
  'cpp-m': { M: '17' }
};

it('grades official 2016/17 Senior Section B answers', async () => {
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.questions).toHaveLength(13);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);
