import { expect, it } from 'vitest';
import juniorRaw from './2004-junior.json';
import seniorRaw from './2004-senior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

const junior = validatePaper(juniorRaw);
const senior = validatePaper(seniorRaw);

it('keeps the 2004 division identity, printed blank mapping, and shared A–J code aligned', () => {
  for (const paper of [junior, senior]) {
    expect(paper.paper.season).toBe('2004');
    expect(paper.tracks).toEqual([{ id: 'section-b', label: 'Section B', selection: 'required' }]);
    expect(paper.questions.map(q => q.blanks.map(b => b.id).join('+'))).toEqual('ABCDEFGHIJKLMNOP'.split(''));
  }
  for (const blank of 'ABCDEFGHIJ') {
    const jq = junior.questions.find(q => q.blanks[0].id === blank)!;
    const sq = senior.questions.find(q => q.blanks[0].id === blank)!;
    expect(jq.prompt).toEqual(sq.prompt);
    expect(jq.displayCode).toEqual(sq.displayCode);
  }
  expect(junior.questions.find(q => q.blanks[0].id === 'K')?.printedRef).toBe('Section B, Question 8, Blank K');
  expect(senior.questions.find(q => q.blanks[0].id === 'K')?.printedRef).toBe('Section B, Question 8, Blank K');
  expect(junior.questions.find(q => q.blanks[0].id === 'P')?.printedRef).toBe('Section B, Question 11, Blank P');
  expect(senior.questions.find(q => q.blanks[0].id === 'P')?.printedRef).toBe('Section B, Question 12, Blank P');
});

const juniorAnswers: Record<string,string> = {
  A:'/2', B:'len-1-i', C:'len-1-i', D:'(n+m-1)/m',
  E:'A=True,B=True,C=False,D=True', F:'i==j || i==8-j', G:'n/3', H:'n==1',
  I:'89', J:'n-1', K:'22-3*i', L:'n*(m+2)', M:'sqrt(n)', N:'n%i==0', O:'s[len-1]', P:'0'
};
const seniorAnswers: Record<string,string> = {
  ...juniorAnswers, K:'dst', L:'src', M:'10110', N:'HKOI2003 HKOI2003', O:'76', P:'112'
};

for (const [paper, answers] of [[junior,juniorAnswers],[senior,seniorAnswers]] as const) {
  it(`grades the 2004 ${paper.paper.division} suggested answers`, async () => {
    const issues: unknown[] = [];
    for (const q of paper.questions) {
      const blank = q.blanks[0].id;
      const result = await gradeQuestion(q, { [blank]:answers[blank] }, 'c');
      if (result.status !== 'pass') issues.push([blank,result.status,result.message,result.cases.find(c => c.status !== 'pass')]);
    }
    expect(issues).toEqual([]);
  }, 120_000);
}

it('2004 Senior N accepts another valid string and rejects one occurrence', async () => {
  const q = senior.questions.find(q => q.blanks[0].id === 'N')!;
  expect((await gradeQuestion(q, { N:'xHKOI2003HKOI2003x' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(q, { N:'xHKOI2003x' }, 'c')).status).toBe('fail');
});

it('2004 Junior D accepts a distinct correct ceiling formula and rejects floor division', async () => {
  const q = junior.questions.find(q => q.blanks[0].id === 'D')!;
  expect((await gradeQuestion(q, { D:'n/m+(n%m!=0)' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(q, { D:'n/m' }, 'c')).status).toBe('fail');
});

it('2004 string reversal allows one harmless middle-character swap', async () => {
  const q = junior.questions.find(q => q.blanks[0].id === 'A')!;
  expect((await gradeQuestion(q, { A:'/2+len%2' }, 'c')).status).toBe('pass');
  expect((await gradeQuestion(q, { A:'' }, 'c')).status).toBe('fail');
});

it('2004 Senior K and L run the printed linked-list function rather than node IDs', async () => {
  const printed = senior.contexts?.find(context => context.id === 'q8-code')?.displayCode?.c;
  expect(printed).toBeDefined();
  for (const [blank, accepted, rejected] of [['K', '(dst)', 'NULL'], ['L', '(src)', 'dst']] as const) {
    const question = senior.questions.find(q => q.blanks[0].id === blank)!;
    if (question.grading.kind !== 'program') throw new Error('Expected program grader');
    const executablePrintedCode = printed!.replace('{{K}}', blank === 'K' ? '{{K}}' : 'dst').replace('{{L}}', blank === 'L' ? '{{L}}' : 'src');
    expect(question.grading.targets[0].source.startsWith(executablePrintedCode)).toBe(true);
    expect(question.grading.targets[0].source).toContain(`{{${blank}}}`);
    expect(question.grading.targets[0].harness.kind).toBe('program');
    expect((await gradeQuestion(question, { [blank]: accepted }, 'c')).status).toBe('pass');
    expect((await gradeQuestion(question, { [blank]: rejected }, 'c')).status).toBe('fail');
  }
});
