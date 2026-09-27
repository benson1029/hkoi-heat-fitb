import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

function load(filename: string) {
  return validatePaper(JSON.parse(readFileSync(new URL(filename, import.meta.url), 'utf8')));
}

const answers23: Record<string, Record<string, string>> = {
  'junior-a': { A1: "text[i]=='/'", A2: 'i-1', A3: 'i+2' },
  'junior-b': { B1: 'k/2', B2: 'k-1-i' },
  'junior-c': { C1: 'r', C2: 'r-l', C3: 'r' },
  'junior-d': { D: '~x+1' },
  'junior-e': { E: '7' },
  'junior-f': { F: 'ab ab ab ab ac ac ac ac' },
  'junior-g': { G1: '0', G2: '3' },
  'junior-h': { H1: '5', H2: '7' },
  'junior-i': { I: 'x%4!=2&&y%4!=2' },
  'junior-j': { J: 'x%8&&y%8' },
  'junior-k': { K: '(x==4)==(y==4)' },
  'junior-l': { L: '(a-b+3)%3==1' },
};
const answers24: Record<string, Record<string, string>> = {
  'junior-a': { A: 'f(x*2-2)' },
  'junior-b': { B1: 'a>b', B2: 'a<b' },
  'junior-c': { C1: 'else if', C2: 'else if' },
  'junior-d': { D: 'return' },
  'junior-e': { E: 'A[i]==1&&A[j]==0&&A[k]==1' },
  'junior-f': { F1: 'i+1;j<N;++j', F2: 'j+1;k<N;++k' },
  'junior-g': { G1: 'A[i]==0', G2: 'B[i]*(B[N-1]-B[i])' },
  'junior-h': { H: '89' },
  'junior-i': { I: '7921' },
  'junior-j': { J1: 'tmp-=9', J2: '57-(sum+2)%10' },
  'junior-k': { K: '3' },
  'junior-l': { L1: '15', L2: '51', L3: '85' },
};

describe('official Junior 2022/23–2023/24 FITB corpus', () => {
  it.each([
    ['2022-23-junior.json', answers23, []],
    ['2023-24-junior.json', answers24, []],
  ] as const)('%s validates and grades every official answer', async (filename, answers, pendingIds) => {
    const paper = load(filename);
    expect(paper.questions).toHaveLength(12);
    expect(paper.questions.reduce((n, q) => n + q.blanks.length, 0)).toBe(19);
    expect(paper.questions.reduce((n, q) => n + q.points, 0)).toBe(20);
    for (const question of paper.questions) {
      const result = await gradeQuestion(question, answers[question.id], 'cpp');
      expect(result.status, `${filename} ${question.id}: ${JSON.stringify(result.cases.find(c => c.status !== 'pass') ?? result.message)}`)
        .toBe(pendingIds.includes(question.id as never) ? 'pending' : 'pass');
    }
  });
  it('accepts alternate official answers with side effects and digit arithmetic', async () => {
    const p23 = load('2022-23-junior.json');
    const b = p23.questions.find(q => q.id === 'junior-b')!;
    expect((await gradeQuestion(b, { B1: 'k', B2: '--k' })).status).toBe('pass');
    const a = p23.questions.find(q => q.id === 'junior-a')!;
    expect((await gradeQuestion(a, { A1: "text[i]=='/'", A2: 'i+2', A3: 'i-1' })).status).toBe('pass');
    const p24 = load('2023-24-junior.json');
    const j = p24.questions.find(q => q.id === 'junior-j')!;
    expect((await gradeQuestion(j, { J1: 'tmp++', J2: '57-(sum+2)%10' })).status).toBe('pass');
  });
  it('enforces the printed no-minus restriction on 2022/23 Junior D', async () => {
    const question = load('2022-23-junior.json').questions.find(q => q.id === 'junior-d')!;
    expect((await gradeQuestion(question, { D: '~x+1' })).status).toBe('pass');
    expect((await gradeQuestion(question, { D: '-x' })).status).toBe('fail');
  });
  it('runs a candidate 2022/23 Junior F input through the printed program', async () => {
    const question = load('2022-23-junior.json').questions.find(q => q.id === 'junior-f')!;
    expect((await gradeQuestion(question, { F: 'ab ab ab ab ac ac ac ac' })).status).toBe('pass');
    expect((await gradeQuestion(question, { F: 'it is never too late to join hkoi' })).status).toBe('fail');
    expect((await gradeQuestion(question, { F: 'AB AB AB AB AC AC AC AC' })).status).toBe('fail');
  });
});
