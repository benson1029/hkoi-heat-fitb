import { expect, it } from 'vitest';
import source from './2025-26-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

it('counts all repeated-prefix substrings in Paper 2 C++ V', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'cpp-v');
  if (!question) throw new Error('C++ V is missing');
  expect((await gradeQuestion(question, { V: 'a+=p[sum%3]' })).status).toBe('pass');
  expect((await gradeQuestion(question, { V: 'a+=p[sum%3]%10' })).status).toBe('fail');
}, 30_000);

it('tests the triangle inequality beyond nearly equal sides in Paper 1 I', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'paper1-i');
  if (!question) throw new Error('Paper 1 I is missing');
  for (const language of ['python', 'cpp'] as const) {
    expect((await gradeQuestion(question, { I: 'a+b>c' }, language)).status).toBe('pass');
    expect((await gradeQuestion(question, { I: 'b-a<a' }, language)).status).toBe('fail');
  }
}, 30_000);

it('does not let two zero values reset AreAllOnes to true in Paper 2 C++ P', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'cpp-p');
  if (!question) throw new Error('C++ P is missing');
  expect(question.prompt.en).toContain('0 ≤a[i] ≤1');
  expect((await gradeQuestion(question, { P: 'ok&a[i]' }, 'cpp')).status).toBe('pass');
  expect((await gradeQuestion(question, { P: 'a[i]==ok' }, 'cpp')).status).toBe('fail');
}, 30_000);

it('requires the full beautiful-list condition in Paper 2 Python I', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'python-i');
  if (!question) throw new Error('Python I is missing');
  expect((await gradeQuestion(question, { I: 'a[n-1]-a[0]==n-1' }, 'python')).status).toBe('pass');
  expect((await gradeQuestion(question, { I: 'a[n-1]<=n' }, 'python')).status).toBe('fail');
  expect((await gradeQuestion(question, { I: 'n!=2' }, 'python')).status).toBe('fail');
}, 30_000);

it('checks parity independently for both members of a good pair', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'cpp-r');
  if (!question) throw new Error('C++ R is missing');
  expect((await gradeQuestion(question, { R: 'n%2==0&&m%2==0' }, 'cpp')).status).toBe('pass');
  expect((await gradeQuestion(question, { R: 'n>11||5>n+m' }, 'cpp')).status).toBe('fail');
}, 30_000);
