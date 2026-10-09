import { expect, it } from 'vitest';
import senior2013 from './2013-senior.json';
import junior2017 from './2016-17-junior.json';
import senior2017 from './2016-17-senior.json';
import { gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

it('sorts a stack ending in zero in 2013 Senior', async () => {
  const question = validatePaper(senior2013).questions.find(item => item.id === 'D')!;
  expect((await gradeQuestion(question, { D: 'peek(r)' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(question, { D: 'peek(x)' }, 'c')).status).toBe('fail');
}, 30_000);

it.each([junior2017, senior2017])('recognizes an inner single-character palindrome in 2016/17', async raw => {
  const paper = validatePaper(raw);
  const question = paper.questions.find(item => item.id === (paper.paper.division === 'junior' ? 'section-b-g' : 'cpp-g'))!;
  expect((await gradeQuestion(question, { G: 'true' }, 'cpp')).status).toBe('pass');
  expect((await gradeQuestion(question, { G: 'st-1' }, 'cpp')).status).toBe('fail');
}, 30_000);
