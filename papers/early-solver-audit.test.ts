import { expect, it } from 'vitest';
import junior2005 from './2005-junior.json';
import senior2005 from './2005-senior.json';
import junior2006 from './2006-junior.json';
import junior2007 from './2007-junior.json';
import junior2008 from './2008-junior.json';
import junior2009 from './2009-junior.json';
import junior2010 from './2010-junior.json';
import { gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

it('checks deduplication beyond the first sorted pair in both 2005 papers', async () => {
  for (const paper of [junior2005, senior2005]) {
    const question = validatePaper(paper).questions.find(item => item.id === 'section-b-o')!;
    expect((await gradeQuestion(question, { O: 'A[i]!=A[i+1]' }, 'c')).status).toBe('pass');
    expect((await gradeQuestion(question, { O: 'A[i]!=A[1]' }, 'c')).status).toBe('fail');
    expect((await gradeQuestion(question, { O: 'A[i+1]!=A[0]' }, 'c')).status).toBe('fail');
  }
}, 30_000);

it('checks accumulation after earlier occurrences in 2006 Junior E', async () => {
  const question = validatePaper(junior2006).questions.find(item => item.id === 'E')!;
  expect((await gradeQuestion(question, { E: 'F[temp]+1' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(question, { E: 'times' }, 'c')).status).toBe('fail');
  expect((await gradeQuestion(question, { E: 'times+initial' }, 'c')).status).toBe('fail');
  expect((await gradeQuestion(question, { E: 'i+1' }, 'c')).status).toBe('fail');
}, 30_000);

it('does not introduce a grader-only identifier into 2009 Junior J', async () => {
  const question = validatePaper(junior2009).questions.find(item => item.id === 'section-b-j')!;
  expect((await gradeQuestion(question, { J: 'high' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(question, { J: 'low' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(question, { J: 'h' }, 'c')).status).toBe('fail');
}, 30_000);

it('checks negative values below the sorting sentinel in 2009 Junior C', async () => {
  const question = validatePaper(junior2009).questions.find(item => item.id === 'section-b-c')!;
  expect((await gradeQuestion(question, { C: 'largest' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(question, { C: 'largest%ceiling' }, 'c')).status).toBe('fail');
}, 30_000);

it('checks Hamming propagation near a Hamming upper boundary in 2007 Junior A', async () => {
  const question = validatePaper(junior2007).questions.find(item => item.id === 'A')!;
  expect((await gradeQuestion(question, { A: 'hamming[i]' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(question, { A: 'hamming[i]+hamming[n-1]' }, 'c')).status).toBe('fail');
  expect((await gradeQuestion(question, { A: 'hamming[i]-hamming[n-1]' }, 'c')).status).toBe('fail');
}, 30_000);

it('allows a teacher to have a higher ID in 2010 Junior C and D', async () => {
  const questions = validatePaper(junior2010).questions;
  const condition = questions.find(item => item.id === 'C')!;
  const update = questions.find(item => item.id === 'D')!;
  expect((await gradeQuestion(condition, { C: 'T[i]!=i' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(condition, { C: 'T[i]<i' }, 'c')).status).toBe('fail');
  expect((await gradeQuestion(update, { D: 'i=T[i]' }, 'c')).status).toBe('pass');
}, 30_000);

it('checks a nontrivial running average in 2008 Junior F', async () => {
  const question = validatePaper(junior2008).questions.find(item => item.id === 'section-b-f')!;
  expect((await gradeQuestion(question, { F: '(average*i+A[i])/(i+1)' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(question, { F: 'A[i]-i' }, 'c')).status).toBe('fail');
  expect((await gradeQuestion(question, { F: 'value' }, 'c')).status).toBe('fail');
}, 30_000);
