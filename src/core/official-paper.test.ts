import { expect, it } from 'vitest';
import source from '../../papers/2024-25-senior.json';
import type { PaperAnswers } from './types';
import { gradePaper } from './grader';
import { validatePaper } from './validate';

const paper = validatePaper(source);

const paper1: PaperAnswers = {
  'paper1-a': { A: '2,1,2' },
  'paper1-b': { B: '5' },
  'paper1-c': { C: 'b,f' },
  'paper1-d': { D: 'aaabbabb' },
  'paper1-e': { E: '540' },
  'paper1-f': { F: '4' },
  'paper1-g': { G: 'B' },
  'paper1-h': { H: 'G' },
  'paper1-i': { I: '8' },
  'paper1-j': { J: '[["A","C"],["C","E"],["E","G"]]' }
};

const python: PaperAnswers = {
  'python-a': { A: '14' },
  'python-b': { B: '4' },
  'python-c': { C: '13' },
  'python-d': { D: '3<=i<=5' },
  'python-e': { E: 'a[:idx]+a[idx+1:]' },
  'python-f': { F: '1-x,1-y' },
  'python-g': { G: 'm in (4,6,9,11)' },
  'python-h': { H: '(m>7)^(m%2)' },
  'python-i': { I1: 'i*2', I2: 'i*2+1' },
  'python-j': { J1: 'n//4', J2: 'l+n//4+i', J3: 'l+n//2+i' }
};

const cpp: PaperAnswers = {
  'cpp-k': { K: '3,19,12' },
  'cpp-l': { L: '0' },
  'cpp-m': { M: '13' },
  'cpp-n': { N: 'i%2' },
  'cpp-o': { O: "(x-'a'+3)%26+'a'" },
  'cpp-p': { P: '++b[a[i]]' },
  'cpp-q': { Q1: 't/60', Q2: 't%60/10', Q3: 't%10' },
  'cpp-r': { R: '7' },
  'cpp-s': { S1: 'i&x', S2: 'i' },
  'cpp-t': { T1: '(1<<i)&x', T2: '(1<<cnt)-1' }
};

it('grades the official Senior Paper 1 and Python answers in full', async () => {
  const result = await gradePaper(paper, { ...paper1, ...python }, ['paper1', 'python']);
  expect(result.questions).toHaveLength(20);
  expect(result.questions.map(item => item.status)).toEqual(Array(20).fill('pass'));
  expect(result.scoredPoints).toBe(30);
  expect(result.possibleMaximum).toBe(30);
  expect(result.complete).toBe(true);
}, 60_000);

it('grades the official Senior Paper 1 and C++ answers in full', async () => {
  const result = await gradePaper(paper, { ...paper1, ...cpp }, ['paper1', 'cpp']);
  expect(result.questions).toHaveLength(20);
  expect(result.questions.map(item => item.status)).toEqual(Array(20).fill('pass'));
  expect(result.scoredPoints).toBe(30);
  expect(result.possibleMaximum).toBe(30);
  expect(result.complete).toBe(true);
}, 60_000);
