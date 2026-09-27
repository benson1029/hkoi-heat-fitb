import { expect, it } from 'vitest';
import source from './2021-22-junior.json';
import { gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

it('accepts official 2021/22 Junior FITB solutions across all Section B units', async () => {
  const paper = validatePaper(source);
  const answers: Record<string, Record<string, string>> = {
    A: { A: '(a[i]+9)%26' },
    B: { B1: 'i=n-1;i>=0;i--', B2: 'm>=c[i]', B3: 'm-c[i]' },
    C: { C1: '5', C2: '6' },
    D: { D: '2, 4' },
    E: { E: 'x*m+y*n-2*x*y' },
    F: { F1: 'abs(a[j]-i)', F2: 'temp', F3: 'i' },
    G: { G: 'a[200]' },
    H: { H: '47' },
    I: { I1: '89', I2: 'else i++;' },
    J: { J: 'ay==by&&ax1<=bx2&&bx1<=ax2' },
    K: { K: 'f(by,ax1,ax2,by,bx1,bx2)' }
  };
  expect(paper.questions).toHaveLength(11);
  let score = 0;
  for (const question of paper.questions) {
    const grade = await gradeQuestion(question, answers[question.id]);
    expect(grade.status, `${question.printedRef}: ${JSON.stringify(grade.cases)}`).toBe('pass');
    score += grade.score ?? 0;
  }
  expect(score).toBe(20);
});

it('checks the coin counterexample as a pair and rejects a non-counterexample', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'C');
  if (!question) throw new Error('Question C is missing');
  for (const [middle, largest] of [[3, 4], [5, 6], [5, 7], [5, 8]]) {
    expect((await gradeQuestion(question, { C1: String(middle), C2: String(largest) })).status).toBe('pass');
  }
  expect((await gradeQuestion(question, { C1: '3', C2: '6' })).status).toBe('fail');
});

it('checks the indexed element in the median program rather than only a[0]', async () => {
  const question = validatePaper(source).questions.find(item => item.id === 'F');
  if (!question) throw new Error('Question F is missing');
  expect((await gradeQuestion(question, { F1: 'abs(a[j]-i)', F2: 'temp', F3: 'i' })).status).toBe('pass');
  expect((await gradeQuestion(question, { F1: 'abs(a[0]-i)', F2: 'temp', F3: 'i' })).status).toBe('fail');
});
