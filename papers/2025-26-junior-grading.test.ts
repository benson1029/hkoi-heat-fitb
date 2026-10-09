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
