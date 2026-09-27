import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

it('grades the official 2014/15 Junior Section B answers', async () => {
  const paper = validatePaper(JSON.parse(readFileSync(new URL('./2014-15-junior.json', import.meta.url), 'utf8')));
  const result = await gradePaper(paper, {
    A: { A: 'd+m*31+y*372' }, B: { B: '((AQB)Q(AQB))' },
    C: { C: '9,8,6,5,2,1' }, D: { D: 'i==j||i==8-j' }, E: { E: 'i*j%10==0' },
    F: { F: '-f(-x,-y,-z)' }, G: { G: 'x+y+z>-2*f(-x,-y,-z)' },
    HI: { H: '52', I: 'while(n%k==0){' },
    J: { J: '2000' }, K: { K: '72367' }, L: { L: 'a[1]*a[3]*a[5]%2==1' }
  }, ['section-b']);
  expect(result.questions.map(q => [q.questionId, q.status])).toEqual(paper.questions.map(q => [q.id, 'pass']));
  expect(result.scoredPoints).toBe(20);
});
