import { expect, it } from 'vitest';
import raw2020 from './2019-20-senior.json';
import raw2021 from './2020-21-senior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

const official2020: Record<string, Record<string, string>> = {
  'cpp-a': { A: "s[n-1]=='0'&&(n==1||s[n-2]=='0')" },
  'cpp-b': { B: 'b[i]=b[i]+b[i-1]' },
  'cpp-c': { C: 'b[9-i]=b[9-i]-b[8-i]' },
  'cpp-f': { F: '3' }, 'cpp-g': { G: '25' },
  'cpp-h': { H1: 'n+1', H2: 'f(n-1)^n' },
  'cpp-i': { I1: '((a<=b&&b<=c)||(c<=b&&b<=a))', I2: 'median(b,c,a)' },
  'cpp-j': { J: 'f(a-m)+f(b-m)+f(c-m)' },
  'cpp-k': { K: '-480' }, 'cpp-l': { L1: '85', L2: 'i++;continue;}' }
};

const official2021: Record<string, Record<string, string>> = {
  'cpp-a': { A: 'D,E,F,G' }, 'cpp-b': { B1: 'x+1', B2: 'i*i*i-i' },
  'cpp-c': { C: '(i%6==0||i%8==0)&&i%24!=0' },
  'cpp-d': { D: 'n/6+n/8-n/24*2' }, 'cpp-e': { E1: 'f', E2: 'i==5' },
  'cpp-f': { F: '17' }, 'cpp-g': { G: '21' }, 'cpp-h': { H: '2143' },
  'cpp-i': { I: '3' }, 'cpp-j': { J: '2' }, 'cpp-k': { K: '1' },
  'cpp-l': { L1: 'c[i-1]', L2: 'c[i]-1', L3: 'b[j]=i' },
  'cpp-m': { M1: '(s[1]||s[2])&&!s[3]', M2: '(s[3]||s[4])&&!s[5]', M3: '(s[5]||s[6])&&!s[7]' }
};

for (const [raw, answers, season, total] of [
  [raw2020, official2020, '2019/20', 17],
  [raw2021, official2021, '2020/21', 20]
] as const) {
  it(`${season} Senior official Section B answers pass`, async () => {
    const paper = validatePaper(raw);
    expect(paper.questions.reduce((sum, q) => sum + q.points, 0)).toBe(total);
    for (const question of paper.questions) {
      if (question.grading.kind === 'cancelled') {
        expect(question.points).toBe(0);
        const result = await gradeQuestion(question, {});
        expect(result.status).toBe('cancelled');
        continue;
      }
      const answer = answers[question.id];
      expect(answer, question.id).toBeDefined();
      const result = await gradeQuestion(question, answer, 'cpp');
      expect([question.id, result.status, result.cases.find(c => c.status !== 'pass')?.message ?? result.message])
        .toEqual([question.id, 'pass', undefined]);
    }
  }, 120_000);
}
