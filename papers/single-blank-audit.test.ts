import { expect, it } from 'vitest';
import senior2013 from './2013-senior.json';
import junior2013 from './2013-junior.json';
import junior2017 from './2016-17-junior.json';
import senior2017 from './2016-17-senior.json';
import { gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

it('sorts a stack ending in zero in 2013 Senior', async () => {
  const paper = validatePaper(senior2013);
  const d = paper.questions.find(item => item.id === 'D')!;
  const e = paper.questions.find(item => item.id === 'E')!;
  expect((await gradeQuestion(d, { D: 'peek(r)' }, 'c')).status).toBe('pass');
  for (const invalid of ['peek(x)', 'peek(n)', 'peek(1)', 'peek(s+1)', 'peek(r+0)'])
    expect((await gradeQuestion(d, { D: invalid }, 'c')).status).toBe('fail');
  expect((await gradeQuestion(e, { E: 's,pop(r)' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(e, { E: 's,pop(r)+0' }, 'c')).status).toBe('pass');
  for (const invalid of ['0,pop(r)', 's,pop(1)'])
    expect((await gradeQuestion(e, { E: invalid }, 'c')).status).toBe('fail');
}, 30_000);

it('finds the second maximum when values are not a permutation of 1 to n in 2013 Junior', async () => {
  const paper = validatePaper(junior2013);
  for (const [id, blank, correct, wrong] of [
    ['section-b-f', 'F', 'a[i]==maximum', 'n<=a[i]'],
    ['section-b-g', 'G', 'break', 'return n-1'],
    ['section-b-h', 'H', 'max(0,n-1)', 'n-1'],
  ]) {
    const question = paper.questions.find(item => item.id === id)!;
    expect((await gradeQuestion(question, { [blank]: correct }, 'c')).status).toBe('pass');
    expect((await gradeQuestion(question, { [blank]: wrong }, 'c')).status).toBe('fail');
  }
}, 30_000);

it.each([junior2017, senior2017])('recognizes an inner single-character palindrome in 2016/17', async raw => {
  const paper = validatePaper(raw);
  const question = paper.questions.find(item => item.id === (paper.paper.division === 'junior' ? 'section-b-g' : 'cpp-g'))!;
  expect((await gradeQuestion(question, { G: 'true' }, 'cpp')).status).toBe('pass');
  expect((await gradeQuestion(question, { G: 'st-1' }, 'cpp')).status).toBe('fail');
}, 30_000);
