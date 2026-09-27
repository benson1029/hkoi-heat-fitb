import { expect, it } from 'vitest';
import raw12 from './2012-junior.json';
import raw13 from './2013-junior.json';
import raw14 from './2014-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradePaper } from '../src/core/grader';
import { gradeQuestion } from '../src/core/grader';
import type { PaperAnswers } from '../src/core/types';

const papers = [validatePaper(raw12), validatePaper(raw13), validatePaper(raw14)];
const answers: PaperAnswers[] = [
  {
    'section-b-a': { A:'0', B:'hello' },
    'section-b-c': { C:'1' },
    'section-b-d': { D:'2' },
    'section-b-e': { E:'j<i&&i%j==0' },
    'section-b-f': { F:'32760' },
    'section-b-g': { G:'((>)9v(<)9)9' },
    'section-b-h': { H:'(<)9(^)9((>)9v(<)9)9' },
    'section-b-i': { I:'((>)9v(<)9^(<)9v)9' },
    'section-b-j': { J:'(<^)9((>)9v(<)9^(<)9v)9' },
    'section-b-k': { K:'(<)9v(<^)9((>)9(<)9v)9(>)9^(>v)9((<)9(>)9^)9' },
  },
  {
    'section-b-a': { A:'16' },
    'section-b-b': { B:'108' },
    'section-b-c': { C:'hkoi2013hkoi201' },
    'section-b-d': { D:'54' },
    'section-b-e': { E:'return (x1-x2)*(x1-x2)+(y1-y2)*(y1-y2);' },
    'section-b-f': { F:'a[i]==maximum' },
    'section-b-g': { G:'break' },
    'section-b-h': { H:'max(0,n-1)' },
    'section-b-i': { I:'ooo/.../ooo' },
    'section-b-j': { J:'o../.o./..o' },
    'section-b-k': { K:'..o/.../o..' },
  },
  {
    'section-b-a': { A:'52' },
    'section-b-b': { B1:'n==1', B2:'return 2' },
    // The official table says n*2+1, contradicting the printed task and its explanation.
    'section-b-c': { C:'n*2-1' },
    'section-b-d': { D:'4.875' },
    'section-b-e': { E1:'2147483647', E2:'2147483479' },
    'section-b-f': { F:'Logic' },
    'section-b-g': { G:'59' },
    'section-b-h': { H:'return 0;}' },
    'section-b-i': { I:'swap(p,p+1)' },
    'section-b-j': { J1:'p>0', J2:'p=p-1' },
    'section-b-k': { K:'p=p+1' },
    'section-b-l': { L:'a[j]=a[i]-a[j]' },
  },
];

for (const [index, paper] of papers.entries()) {
  it(`${paper.paper.season} Junior sheet answers pass semantic graders`, async () => {
    const grade = await gradePaper(paper, answers[index], ['section-b']);
    const issues = grade.questions.filter(q => q.status !== 'pass').map(q => [
      q.questionId, q.status, q.cases.find(c => c.status !== 'pass')?.message ?? q.message,
    ]);
    expect(issues).toEqual([]);
  }, 120_000);
}

it('2012 Junior F awards partial credit to another valid counterexample', async () => {
  const grade = await gradePaper(papers[0], { 'section-b-f': { F:'10008' } }, ['section-b']);
  expect(grade.questions.find(q => q.questionId === 'section-b-f')?.score).toBe(2);
}, 120_000);

it('2012 Junior inverse inputs award one point each and follow scanf numeric prefixes', async () => {
  const question = papers[0].questions.find(q => q.id === 'section-b-a')!;
  const partial = await gradeQuestion(question, { A:'0', B:'1x' }, 'c');
  expect(partial.score).toBe(1);
  const full = await gradeQuestion(question, { A:'0abc', B:'hello' }, 'c');
  expect(full.score).toBe(2);
});

it('2013 Junior die faces award one point for count with a wrong orientation', async () => {
  const grade = await gradePaper(papers[1], { 'section-b-j': { J:'..o/.o./o..' } }, ['section-b']);
  expect(grade.questions.find(q => q.questionId === 'section-b-j')?.score).toBe(1);
}, 120_000);

it('2014 Junior prime question rejects the answer-table typo', async () => {
  const question = papers[2].questions.find(q => q.id === 'section-b-c')!;
  const result = await gradeQuestion(question, { C:'n*2+1' }, 'c');
  expect(result.status).toBe('fail');
});
