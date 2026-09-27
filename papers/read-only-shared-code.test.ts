import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePaper } from '../src/core/validate';

it.each([
  ['2021-22-senior', 'multiply', 'cpp-h', 'cpp-i'],
  ['2022-23-junior', 'q4-program', 'junior-e', 'junior-f'],
  ['2022-23-senior', 'adjacent', 'cpp-l', 'cpp-m'],
  ['2024-25-sample-senior', 'cpp-adjacent', 'cpp-s', 'cpp-t'],
])('%s shows the printed code once for %s', (file, contextId, firstId, secondId) => {
  const paper = validatePaper(JSON.parse(readFileSync(join(__dirname, `${file}.json`), 'utf8')));
  const context = paper.contexts?.find((item) => item.id === contextId);
  const questions = [firstId, secondId].map((id) => paper.questions.find((item) => item.id === id));
  expect(context?.displayCode?.cpp).toBeTruthy();
  expect(context?.displayCode?.cpp).not.toContain('{{');
  expect(questions.every((question) => question?.contextId === contextId && !question.displayCode)).toBe(true);
});
