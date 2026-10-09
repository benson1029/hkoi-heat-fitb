import { expect, it } from 'vitest';
import source from './2024-25-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

it('checks both selected box indices in Paper 2 Python J', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'python-j');
  if (!question) throw new Error('Python J is missing');
  expect((await gradeQuestion(question, { J: 'a[x]+a[y]<=w' })).status).toBe('pass');
  expect((await gradeQuestion(question, { J: 'a[0]+a[y]<=w' })).status).toBe('fail');
}, 30_000);

it('checks the leaving index after several sliding windows in C++ T', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'cpp-t');
  if (!question) throw new Error('C++ T is missing');
  expect((await gradeQuestion(question, { T1: 'len-1', T2: 'i-len+1' }, 'cpp')).status).toBe('pass');
  expect((await gradeQuestion(question, { T1: '(i+1)%len', T2: 'i-len+1' }, 'cpp')).status).toBe('pass');
  expect((await gradeQuestion(question, { T1: '(i+1)%len', T2: 'i/len' }, 'cpp')).status).toBe('fail');
}, 30_000);
