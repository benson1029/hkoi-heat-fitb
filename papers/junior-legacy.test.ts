import { expect, it } from 'vitest';
import p17raw from './2016-17-junior.json';
import p18raw from './2017-18-junior.json';
import p19raw from './2018-19-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradePaper } from '../src/core/grader';
import { gradeQuestion } from '../src/core/grader';
import type { PaperAnswers } from '../src/core/types';

const papers = [validatePaper(p17raw), validatePaper(p18raw), validatePaper(p19raw)];

const answers: PaperAnswers[] = [
  {
    'section-b-a': { A1: '62', A2: 'a[j+1]=t;' },
    'section-b-b': { B: '7' },
    'section-b-c': { C: '7 5 3 × + 8 4 ÷ -' },
    'section-b-d': { D1: '1', D2: '7', D3: '10' },
    'section-b-e': { E: '3' },
    'section-b-f': { F: 'st+ed-i' },
    'section-b-g': { G: 'true' },
    'section-b-h': { H: 's[st]==s[ed]' },
    'section-b-i': { I: '(s[st]==s[ed])&&f(st+1,ed-1)' },
    'section-b-j': { J: 'i*a+j-a' },
    'section-b-k': { K: '(i+j-2)%a+1' },
    'section-b-l': { L: 'x%10+x/10%10+x/100==8' },
    'section-b-m': { M: '16' },
  },
  {
    'section-b-a': { A1: 'a+x', A2: '5050-a' },
    'section-b-b': { B: 't=a[x];a[x]=a[y];a[y]=t' },
    'section-b-c': { C: 'k-i-1' },
    'section-b-d': { D: 'f(100);f(k);f(100)' },
    'section-b-e': { E: 'E1 A5' },
    'section-b-f': { F: 'E1 C5' },
    'section-b-g': { G: '96' },
    'section-b-h': { H: 'x^32' },
    'section-b-i': { I1: 'num[i]+abs(num[i])', I2: 'temp/2' },
    'section-b-j': { J1: 'i=2;', J2: 'n%i==0' },
    'section-b-k': { K: 'answer+is_prime(i)' },
    'section-b-l': { L1: '88', L2: 'for(i=0;i<=10000;i++)' },
  },
  {
    'section-b-a': { A: '10' },
    'section-b-b': { B: 'i=1;i<=n;i++' },
    'section-b-c': { C: 'sum+i' },
    'section-b-d': { D1: '16', D2: '25' },
    'section-b-e': { E1: 'i*i==n', E2: 'sum-i' },
    'section-b-f': { F: 'sum_factors(n)' },
    'section-b-g': { G1: 'sum>2*n', G2: 'sum==2*n' },
    'section-b-h': { H: '45' },
    'section-b-i': { I: '25' },
    'section-b-j': { J: '10 9 8 7 6 5 4 1 2 3' },
    'section-b-k': { K: '50' },
    // The official sheet's m-1 is incorrect when the final comparison succeeds.
    'section-b-l': { L1: 'a[m]>=target', L2: 'l=m+1', L3: 'l-1' },
    'section-b-m': { M: '2' },
    'section-b-n': { N1: '76', N2: 'else;' },
    'section-b-o': { O: '(E-S)%J+(E-S)/J<=T' },
  },
];

for (const [index, paper] of papers.entries()) {
  it(`${paper.paper.season} Junior verified answers pass`, async () => {
    expect(paper.questions.reduce((sum, question) => sum + question.points, 0)).toBe(20);
    const grade = await gradePaper(paper, answers[index], ['section-b']);
    const unexpected = grade.questions.filter(question => question.status !== 'pass').map(question => [
      question.questionId,
      question.status,
      question.cases.find(testCase => testCase.status !== 'pass')?.message ?? question.message,
    ]);
    expect(unexpected).toEqual([]);
  }, 120_000);
}

it('2018/19 Junior rejects the answer-sheet binary-search off-by-one expression', async () => {
  const question = papers[2].questions.find(q => q.id === 'section-b-l')!;
  const result = await gradeQuestion(question, { L1:'a[m]>=target', L2:'l=m+1', L3:'m-1' }, 'cpp');
  expect(result.status).toBe('fail');
});
