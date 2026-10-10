import { describe, expect, it } from 'vitest';
import type { Language, Question } from '../core/types';
import { gradeQuestion } from '../core/grader';
import { stateAwareAssignments } from './state-aware';
import { solveProgramBlank } from './solve';
import { solveJointBlanks } from './joint';
import { solveExhaustive } from './exhaustive';
import junior2011 from '../../papers/2011-junior.json';
import junior2012 from '../../papers/2012-junior.json';
import senior2018 from '../../papers/2018-19-senior.json';
import junior2024 from '../../papers/2024-25-junior.json';

function pairedConditions(language: Language): Question {
  const source = language === 'python'
    ? 'def f(i, j):\n    out = 0\n    if {{A}}:\n        out += 1\n    if {{B}}:\n        out += 2\n    return out'
    : 'int f(int i,int j){int out=0;if({{A}})out+=1;if({{B}})out+=2;return out;}';
  const cases = [
    { args: [0, 1], answer: 3 }, { args: [1, 2], answer: 1 },
    { args: [0, 0], answer: 2 }, { args: [2, 1], answer: 0 }
  ];
  return {
    id: 'paired', track: 'test', printedRef: 'Question 1', title: 'Paired conditions',
    prompt: { en: 'Complete the two conditions.' }, points: 2,
    blanks: [{ id: 'A', maxChars: 12 }, { id: 'B', maxChars: 12 }],
    grading: { kind: 'program', targetPolicy: 'any',
      targets: [{ language, source, harness: { kind: 'call', function: 'f' } }],
      cases: cases.map((item, index) => ({ id: `case-${index}`, args: item.args,
        expected: { returnValue: item.answer }, maxSteps: 2_000 })) }
  };
}

describe('state-aware search', () => {
  for (const language of ['cpp', 'python'] as const) {
    it(`guides both ${language} blanks from one program trace`, async () => {
      const question = pairedConditions(language);
      const assignments = await stateAwareAssignments(question, language, ['A', 'B'], {}, {
        maxRuns: 100, deadline: performance.now() + 10_000
      });
      expect(assignments.length).toBeGreaterThan(0);
      let passing = false;
      for (const assignment of assignments) {
        const grade = await gradeQuestion(question, assignment, language);
        if (grade.status === 'pass') { passing = true; break; }
      }
      expect(passing).toBe(true);
    });
  }
  it('treats a blank before != 1 as an expression', async () => {
    const question: Question = {
      id: 'expression-context', track: 'test', printedRef: 'Question 2', title: 'Expression context',
      prompt: { en: 'Complete the expression.' }, points: 1, blanks: [{ id: 'X', maxChars: 5 }],
      grading: { kind: 'program', targetPolicy: 'any',
        targets: [{ language: 'cpp', source: 'int f(int i){if({{X}}!=1)return 1;return 0;}',
          harness: { kind: 'call', function: 'f' } }],
        cases: [0, 1, 2].map(i => ({ id: `i-${i}`, args: [i], expected: { returnValue: Number(i !== 1) }, maxSteps: 1_000 })) }
    };
    const assignments = await stateAwareAssignments(question, 'cpp', ['X'], {}, {
      maxRuns: 80, deadline: performance.now() + 5_000
    });
    expect(assignments.some(assignment => assignment.X === 'i')).toBe(true);
  });
  it('uses an expression blank and a condition blank in the same trace', async () => {
    const question: Question = {
      id: 'mixed', track: 'test', printedRef: 'Question 3', title: 'Mixed blanks',
      prompt: { en: 'Complete both blanks.' }, points: 2,
      blanks: [{ id: 'A', maxChars: 8 }, { id: 'B', maxChars: 8 }],
      grading: { kind: 'program', targetPolicy: 'any',
        targets: [{ language: 'cpp', source: 'int f(int i,int j){int out=0;if({{A}})out={{B}};return out;}',
          harness: { kind: 'call', function: 'f' } }],
        cases: [[0, 1, 1], [1, 3, 2], [2, 2, 0], [3, 1, 0]].map(([i, j, result], index) =>
          ({ id: `case-${index}`, args: [i, j], expected: { returnValue: result }, maxSteps: 1_000 })) }
    };
    const assignments = await stateAwareAssignments(question, 'cpp', ['A', 'B'], {}, {
      maxRuns: 160, deadline: performance.now() + 10_000
    });
    let passing = false;
    for (const assignment of assignments) {
      if ((await gradeQuestion(question, assignment, 'cpp')).status === 'pass') { passing = true; break; }
    }
    expect(passing, JSON.stringify(assignments.slice(0, 12))).toBe(true);
    const joint = await solveJointBlanks({ question, blankIds: ['A', 'B'], language: 'cpp',
      strategy: 'hybrid', maxCandidates: 5_000, maxMs: 10_000, maxResults: 1 });
    expect(joint.assignments?.length).toBeGreaterThan(0);
  }, 20_000);
  for (const [paper, id, blank, language] of [
    [junior2011, 'G', 'G', 'c'],
    [junior2012, 'section-b-e', 'E', 'c'],
    [junior2024, 'cpp-p', 'P', 'cpp']
  ] as const) {
    it(`uses reached states for ${id}`, async () => {
      const question = (paper as { questions: Question[] }).questions.find(item => item.id === id)!;
      const assignments = await stateAwareAssignments(question, language, [blank], {}, {
        maxRuns: 160, deadline: performance.now() + 12_000
      });
      let passing = false;
      for (const assignment of assignments) {
        const grade = await gradeQuestion(question, assignment, language);
        if (grade.status === 'pass') { passing = true; break; }
      }
      expect(passing, JSON.stringify(assignments.slice(0, 12))).toBe(true);
    }, 20_000);
  }
  it('guides two conditions in one published C++ question', async () => {
    const question = (senior2018 as { questions: Question[] }).questions.find(item => item.id === 'cpp-g')!;
    const assignments = await stateAwareAssignments(question, 'cpp', ['G1', 'G2'], {}, {
      maxRuns: 160, deadline: performance.now() + 12_000
    });
    let passing = false;
    for (const assignment of assignments) {
      const grade = await gradeQuestion(question, assignment, 'cpp');
      if (grade.status === 'pass') { passing = true; break; }
    }
    expect(passing, JSON.stringify(assignments.slice(0, 12))).toBe(true);
  }, 20_000);
  it('feeds reached-state candidates into single and joint search', async () => {
    const single = (junior2012 as { questions: Question[] }).questions.find(item => item.id === 'section-b-e')!;
    const one = await solveProgramBlank({ question: single, blankId: 'E', language: 'c', strategy: 'hybrid',
      maxCandidates: 5_000, maxMs: 10_000, maxResults: 1 });
    expect(one.found.length, JSON.stringify(one)).toBeGreaterThan(0);
    const exhaustive = await solveExhaustive({ question: single, blankId: 'E', language: 'c',
      strategy: 'exhaustive', maxCandidates: 5_000, maxMs: 10_000, maxResults: 1 });
    expect(exhaustive.found.length).toBeGreaterThan(0);
    const pair = (senior2018 as { questions: Question[] }).questions.find(item => item.id === 'cpp-g')!;
    const two = await solveJointBlanks({ question: pair, blankIds: ['G1', 'G2'], language: 'cpp', strategy: 'hybrid',
      maxCandidates: 5_000, maxMs: 10_000, maxResults: 1 });
    expect(two.assignments?.length).toBeGreaterThan(0);
  }, 40_000);
  it('yields so the worker can cancel a probe search', async () => {
    const question = (junior2012 as { questions: Question[] }).questions.find(item => item.id === 'section-b-e')!;
    let cancelled = false;
    setTimeout(() => { cancelled = true; }, 0);
    const assignments = await stateAwareAssignments(question, 'c', ['E'], {}, {
      maxRuns: 160, deadline: performance.now() + 10_000, isCancelled: () => cancelled
    });
    expect(cancelled).toBe(true);
    expect(assignments).toEqual([]);
  });
});
