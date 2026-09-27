import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePaper } from '../src/core/validate';

const groups = [
  ['2011-12-junior', 'q2-code', 'section-b-c,section-b-d,section-b-e'],
  ['2011-12-senior', 'section-b-q2', 'C,D,E'],
  ['2012-13-junior', 'q5-code', 'section-b-f,section-b-g,section-b-h'],
  ['2012-13-senior', 'q3', 'D,E'],
  ['2012-13-senior', 'q5', 'H,I,J'],
  ['2013-14-junior', 'q2-code', 'section-b-b,section-b-c'],
  ['2013-14-junior', 'q5-code', 'section-b-i,section-b-j,section-b-k'],
  ['2013-14-senior', 'q5', 'J,K,L'],
  ['2014-15-senior', 'linked', 'c-g,c-h'],
  ['2015-16-junior', 'collatz', 'B,C,D'],
  ['2015-16-junior', 'crosses', 'J,K'],
  ['2015-16-senior', 'place', 'c-a,c-b'],
  ['2015-16-senior', 'sqcmp', 'c-c,c-d'],
  ['2015-16-senior', 'crosses', 'c-j,c-k'],
] as const;

it.each(groups)('%s %s presents all graded blanks in one shared code block', (file, contextId, ids) => {
  const raw = JSON.parse(readFileSync(join(__dirname, `${file}.json`), 'utf8'));
  const paper = validatePaper(raw);
  const context = paper.contexts?.find((item) => item.id === contextId);
  const questions = ids.split(',').map((id) => paper.questions.find((item) => item.id === id));
  expect(context).toBeDefined();
  expect(questions.every(Boolean)).toBe(true);
  const markers = [...(context?.displayCode?.c || '').matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)].map((match) => match[1]);
  const blanks = questions.flatMap((question) => question?.blanks.map((blank) => blank.id) || []);
  expect(markers.sort()).toEqual(blanks.sort());
  expect(questions.every((question) => question?.contextId === contextId && !question.displayCode)).toBe(true);
  expect(context?.markdown).not.toContain('```c');
});

it('keeps shared printed code identical across the 2011/12 prime and 2015/16 cross papers', () => {
  const contextCode = (file: string, id: string) => {
    const paper = validatePaper(JSON.parse(readFileSync(join(__dirname, `${file}.json`), 'utf8')));
    return paper.contexts?.find((item) => item.id === id)?.displayCode?.c;
  };
  expect(contextCode('2011-12-junior', 'q2-code')).toBe(contextCode('2011-12-senior', 'section-b-q2'));
  expect(contextCode('2015-16-junior', 'crosses')).toBe(contextCode('2015-16-senior', 'crosses'));
});
