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
