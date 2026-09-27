import { expect, it } from 'vitest';
import source from './2025-26-senior.json';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const compulsory: PaperAnswers = {
  'paper1-a': { A: '9' },
  'paper1-b': { B: '0,1,1' },
  'paper1-c': { C: '-28' },
  'paper1-d': { D: '15' },
  'paper1-e': { E: '10' },
  'paper1-f': { F: '(a+b+c)%3' },
  'paper1-g': { G1: '3-j', G2: 'i' },
  'paper1-h': { H1: 'i//2', H2: 'j%2*2' },
  'paper1-i': { I: '0' },
  'paper1-j': { J: '2' },
  'paper1-k': { K: '1' }
};
const python: PaperAnswers = {
  'python-a': { A: '1' }, 'python-b': { B: '7' }, 'python-c': { C: '0' },
  'python-d': { D: 'a[i]=10-a[i]' },
  'python-e': { E: 'b-a-(a_m>b_m)*40' },
  'python-f': { F: '-i%4' },
  'python-g': { G: 'X[i-1]+X[i]' },
  'python-h': { H: 'A[i]*B[i]-A[i-1]*B[i-1]' },
  'python-i': { I: '(a==b)&(c==d)' },
  'python-j': { J1: 'x&y', J2: '~x&z' }
};
const cpp: PaperAnswers = {
  'cpp-k': { K: '4' }, 'cpp-l': { L: '1' }, 'cpp-m': { M: '40' },
  'cpp-n': { N: "s[i]=='i'" }, 'cpp-o': { O: '!(x&4)' },
  'cpp-p': { P: 'b[n]-2*b[u]+(2*u-n)*x' },
  'cpp-q': { Q: '31' },
  'cpp-r': { R1: 'k', R2: '2*a[i-1]-a[i-k-1]' },
  'cpp-s': { S: '1123000000' },
  'cpp-t': { T: 'x-p[n]/18' }
};

it('accepts all implemented official 2025/26 Senior Python answers', async () => {
  const grade = await gradePaper(paper, { ...compulsory, ...python }, ['paper1', 'python']);
  expect(grade.questions).toHaveLength(21);
  expect(grade.questions.filter(q => q.status !== 'pass')).toEqual([]);
  expect(grade.scoredPoints).toBe(30);
  expect(grade.complete).toBe(true);
}, 60_000);

it('accepts all official 2025/26 Senior C++ answers', async () => {
  const grade = await gradePaper(paper, { ...compulsory, 'paper1-h': { H1: 'i/2', H2: 'j%2*2' }, ...cpp }, ['paper1', 'cpp']);
  expect(grade.questions).toHaveLength(21);
  expect(grade.questions.filter(q => q.status !== 'pass')).toEqual([]);
  expect(grade.scoredPoints).toBe(30);
  expect(grade.complete).toBe(true);
}, 60_000);
