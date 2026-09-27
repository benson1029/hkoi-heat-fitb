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

it('retains printed division-specific headers and shared code where the papers agree', () => {
  const contextCode = (file: string, id: string) => {
    const paper = validatePaper(JSON.parse(readFileSync(join(__dirname, `${file}.json`), 'utf8')));
    return paper.contexts?.find((item) => item.id === id)?.displayCode?.c;
  };
  expect(contextCode('2011-12-junior', 'q2-code')).toBe(`#include <stdio.h>\n${contextCode('2011-12-senior', 'section-b-q2')}`);
  expect(contextCode('2015-16-junior', 'crosses')).toBe(contextCode('2015-16-senior', 'crosses'));
});

it.each([
  ['2014-15-junior', 'D', 'E'],
  ['2014-15-senior', 'c-c', 'c-d'],
])('%s grid question shares its printed C program across two answer sets', (file, first, second) => {
  const paper = validatePaper(JSON.parse(readFileSync(join(__dirname, `${file}.json`), 'utf8')));
  const context = paper.contexts?.find((item) => item.id === 'grid');
  expect(context?.displayCode?.c).toContain('if ({{condition}})');
  expect(context?.answerSets).toEqual([
    { questionId: first, label: file.endsWith('junior') ? 'D' : 'C', bindings: { condition: file.endsWith('junior') ? 'D' : 'C' } },
    { questionId: second, label: file.endsWith('junior') ? 'E' : 'D', bindings: { condition: file.endsWith('junior') ? 'E' : 'D' } },
  ]);
  expect(paper.questions.filter((q) => q.contextId === 'grid').every((q) => !q.displayCode)).toBe(true);
});

it.each([
  ['2013-14-junior', 'q5-code'],
  ['2013-14-senior', 'q5'],
])('%s preserves the printed C sorting block indentation', (file, contextId) => {
  const paper = validatePaper(JSON.parse(readFileSync(join(__dirname, `${file}.json`), 'utf8')));
  const code = paper.contexts?.find((item) => item.id === contextId)?.displayCode?.c || '';
  expect(code).toMatch(/\n    if \(a\[p\] > a\[p\+1\]\) \{\n        \{\{/);
  expect(code).toMatch(/;\n        if \(\{\{/);
  expect(code).toMatch(/\)\n            \{\{/);
  expect(code).toMatch(/\n    \} else \{\n        \{\{/);
});

it('uses the printed 2013/14 Senior C block as the editor, without repeating it in the context', () => {
  const paper = validatePaper(JSON.parse(readFileSync(join(__dirname, '2013-14-senior.json'), 'utf8')));
  const context = paper.contexts?.find((item) => item.id === 'q2');
  expect(context?.displayCode?.c).toContain('printf("%d", {{C}});');
  expect(context?.displayCode?.c).toContain('    if (x > 0)\n        printf');
  expect(context?.markdown).not.toContain('```c');
});

it('shows bare answer inputs for expression questions without printed code', () => {
  const load = (file: string) => validatePaper(JSON.parse(readFileSync(join(__dirname, `${file}.json`), 'utf8')));
  const senior = load('2011-12-senior');
  const junior = load('2014-15-junior');
  expect(senior.questions.filter((q) => ['A', 'B'].includes(q.id)).every((q) => q.answerOnly)).toBe(true);
  expect(junior.questions.find((q) => q.id === 'F')?.answerOnly).toBe(true);
});
