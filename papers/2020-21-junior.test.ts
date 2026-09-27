import { expect, it } from 'vitest';
import raw from './2020-21-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

const official: Record<string, Record<string, string>> = {
  'section-b-a': { A1: 'true', A2: 'true', A3: 'false' },
  'section-b-b': { B: '667' },
  'section-b-c': { C: '1 2 2 0 2 1 0 1 0' },
  'section-b-d': { D: '102 102 112 112 121 121 102 112 121' },
  'section-b-e': { E: 'b+2' },
  'section-b-f': { F: '6210001000' },
  'section-b-g': { G: '125346' },
  'section-b-h': { H: 'BABABA' },
  'section-b-i': { I: '4' },
  'section-b-j': { J1: '48', J2: 'while(i*i<=x)' },
  'section-b-k': { K: 'j-i<2&&i-j<2' },
  'section-b-l': { L: '(i+j)/3==3' },
  'section-b-m': { M: '[[↘↗]4[↙↖]4]4' }
};

it('2020/21 Junior official Section B answers all pass', async () => {
  const paper = validatePaper(raw);
  expect(paper.questions).toHaveLength(13);
  expect(paper.questions.reduce((sum, q) => sum + q.points, 0)).toBe(20);
  for (const question of paper.questions) {
    const answer = official[question.id];
    expect(answer, question.id).toBeDefined();
    const grade = await gradeQuestion(question, answer);
    expect([question.id, grade.status, grade.cases.find(c => c.status !== 'pass')?.message ?? grade.message])
      .toEqual([question.id, 'pass', undefined]);
  }
}, 120_000);
