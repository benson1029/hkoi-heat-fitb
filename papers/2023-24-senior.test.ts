import { expect, it } from 'vitest';
import source from './2023-24-senior.json';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'cpp-a': { A: 'c/32-1' },
  'cpp-b': { B: 'i=1;i<n;i++' },
  'cpp-c': { C1: 'i=n-1;i>=n-k;i--', C2: 'temp[i+k]' },
  'cpp-d': { D1: 'N', D2: 'A[i]>Q[j]', D3: 'ans=i;break' },
  'cpp-e': { E1: 'A[m]>q', E2: 'l=m+1' },
  'cpp-f': { F1: 'A[i]', F2: 'i>0&&B[i-1]>B[i]', F3: 'B[i-1]', F4: 'SingleQueryFast(B,Q[j])' },
  'cpp-g': { G: '880' },
  'cpp-h': { H: 'Count(n-1)+CountNo1(n)' },
  'cpp-i': { I: 'Count(n)-Count(n-(limit+1)*2)' },
  'cpp-j': { J1: '2<<x', J2: '-1' },
  'cpp-k': { K1: '4<<x', K2: 'a-1' }
};

it('grades the official 2023/24 Senior Section B answers', async () => {
  const result = await gradePaper(paper, answers, ['cpp']);
  expect(result.questions).toHaveLength(11);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);
