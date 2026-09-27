import { expect, it } from 'vitest';
import source from './2022-23-senior.json';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'cpp-a': { A1: 'xA*pA+xB*pB<=N', A2: 'xA*vA+xB*vB' },
  'cpp-b': { B: 'xA*vA+(N-xA*pA)/pB*vB' },
  'cpp-c': { C: 'xA*vA+FindMaxValueFaster(N-xA*pA,pB,vB,pC,vC)' },
  'cpp-d': { D1: "s[i]-'A'+1", D2: '4-i' },
  'cpp-e': { E: 'PAFR' },
  'cpp-f': { F: '236524' },
  'cpp-g': { G: '1296' },
  'cpp-h': { H1: 'p[i]!=-1', H2: 'a[p[i]]', H3: 'p[i]=p[p[i]]' },
  'cpp-i': { I: '%7' },
  'cpp-j': { J: '256' },
  'cpp-k': { K1: 'n', K2: 'n/i*i/2' },
  'cpp-l': { L: '23' },
  'cpp-m': { M1: '21', M2: 'i+1<a.size();' }
};

it('grades the official 2022/23 Senior Section B answers', async () => {
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions).toHaveLength(13);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);
