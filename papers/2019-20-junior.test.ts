import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

it('grades the official 2019/20 Junior answers, excluding cancelled blanks', async () => {
  const paper = validatePaper(JSON.parse(readFileSync(new URL('./2019-20-junior.json', import.meta.url), 'utf8')));
  const answers = {
    A: { A: "s[n-1]=='0'&&(n==1||s[n-2]=='0')" },
    B: { B: 'b[i]=b[i]+b[i-1]' },
    C: { C: 'b[9-i]=b[9-i]-b[8-i]' },
    F: { F: '4' }, G: { G: '3' }, H: { H: '25' }, I: { I: '11' },
    J: { J1: 'start+1', J2: 'acc^i' },
    K: { K: 'f(a-m)+f(b-m)+f(c-m)' },
    L: { L: '-480' }, M: { M1: '85', M2: 'i++;continue;}' }
  };
  const result = await gradePaper(paper, answers, ['section-b']);
  expect(result.questions.map(item => [item.questionId, item.status])).toEqual([
    ['A','pass'], ['B','pass'], ['C','pass'], ['D','cancelled'], ['E','cancelled'],
    ['F','pass'], ['G','pass'], ['H','pass'], ['I','pass'], ['J','pass'],
    ['K','pass'], ['L','pass'], ['M','pass']
  ]);
  expect(result.scoredPoints).toBe(17);
  expect(result.possibleMaximum).toBe(17);
});
