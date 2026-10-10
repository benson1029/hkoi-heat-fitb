import { expect, it } from 'vitest';
import source from './2014-15-senior.json';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';
import type { PaperAnswers } from '../src/core/types';

const paper = validatePaper(source);
const answers: PaperAnswers = {
  'c-a': { A: '((AQB)Q(AQB))' },
  'c-b': { B: '((AQB)Q((AQA)Q(BQB)))' },
  'c-c': { C: 'i==j||i==8-j' },
  'c-d': { D: 'i*j%10==0' },
  'c-e': { E: '1, 2, 5, 6, 8, 9' },
  'c-f': { F: '(r1+c1+r2+c2)%2==1' },
  'c-g': { G: 'f(2,0);' },
  'c-h': { H: 'f(5,1);' },
  'c-i': { I: '100-i/4+i%4*4' },
  'c-j': { J: '0' }
};

it('places 2014/15 Senior I in the printed program', () => {
  const question = paper.questions.find(item => item.id === 'c-i');
  expect(question?.displayCode?.c).toContain('printf("%c", {{I}});');
});

it('grades official 2014/15 Senior Section B answers', async () => {
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions.filter(item => item.status !== 'pass')).toEqual([]);
  expect(result.questions).toHaveLength(10);
  expect(result.scoredPoints).toBe(20);
  expect(result.complete).toBe(true);
}, 60_000);
