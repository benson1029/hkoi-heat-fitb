import { expect, it } from 'vitest';
import juniorRaw from './2005-junior.json';
import seniorRaw from './2005-senior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

const junior = validatePaper(juniorRaw);
const senior = validatePaper(seniorRaw);

it('maps all 2005 blanks to their printed questions and aligns shared J–O', () => {
  for (const paper of [junior, senior]) {
    expect(paper.paper.season).toBe('2005');
    expect(paper.tracks).toEqual([{ id:'section-b', label:'Section B', selection:'required' }]);
    expect(paper.questions.flatMap(q => q.blanks.map(b => b.id))).toEqual('ABCDEFGHIJKLMNO'.split(''));
  }
  expect(junior.questions.find(q => q.blanks[0].id === 'G')?.printedRef).toBe('Section B, Question 4, Blanks G, H');
  expect(senior.questions.find(q => q.blanks[0].id === 'G')?.printedRef).toBe('Section B, Question 4, Blank G');
  for (const blank of 'JKLMNO') {
    const jq = junior.questions.find(q => q.blanks[0].id === blank)!;
    const sq = senior.questions.find(q => q.blanks[0].id === blank)!;
    expect(jq.prompt).toEqual(sq.prompt);
    expect(jq.displayCode).toEqual(sq.displayCode);
  }
  expect(junior.contexts?.find(c => c.id === 'q8-code')?.displayCode).toEqual(senior.contexts?.find(c => c.id === 'q8-code')?.displayCode);
  expect(junior.contexts?.find(c => c.id === 'q9-code')?.displayCode).toEqual(senior.contexts?.find(c => c.id === 'q9-code')?.displayCode);
});

const juniorAnswers: Record<string,string> = {
  A:'x%10', B:'x/10', C:'12', D:'720', E:'A[i]', F:'i', G:'8', H:'2 4',
  I:'17', J:'maximum(a,b)', K:'2*b-a', L:'(i+2)%5', M:'(i+3)%5', N:'n-1', O:'A[i]!=A[i+1]'
};
const seniorAnswers: Record<string,string> = {
  A:'MAX', B:'i', C:'N-2', D:'i', E:'i', F:'(i-j)%4==0', G:'1231412', H:'3', I:'(4668, 4669)',
  J:'maximum(a,b)', K:'2*b-a', L:'(i+2)%5', M:'(i+3)%5', N:'n-1', O:'A[i]!=A[i+1]'
};

for (const [paper, answers] of [[junior,juniorAnswers],[senior,seniorAnswers]] as const) {
  it(`grades the 2005 ${paper.paper.division} suggested answers`, async () => {
    const issues: unknown[] = [];
    for (const q of paper.questions) {
      const answer = Object.fromEntries(q.blanks.map(b => [b.id, answers[b.id]]));
      const result = await gradeQuestion(q, answer, 'c');
      if (result.status !== 'pass') issues.push([q.id,result.status,result.message,result.cases.find(c => c.status !== 'pass')]);
    }
    expect(issues).toEqual([]);
  }, 120_000);
}

it('2005 Junior G/H accepts another counterexample and rejects a false output', async () => {
  const q = junior.questions.find(q => q.blanks[0].id === 'G')!;
  expect((await gradeQuestion(q, { G:'27', H:'3 9' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(q, { G:'27', H:'3 3 3' }, 'c')).status).toBe('fail');
});

it('2005 Senior F accepts a different equivalent pattern and rejects a column-only check', async () => {
  const q = senior.questions.find(q => q.blanks[0].id === 'F')!;
  expect((await gradeQuestion(q, { F:'i%4==j%4' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(q, { F:'j%4==0' }, 'c')).status).toBe('fail');
});
