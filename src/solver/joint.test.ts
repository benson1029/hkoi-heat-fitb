import { describe, expect, it } from 'vitest';
import type { PaperConfig } from '../core/types';
import { gradeQuestion } from '../core/grader';
import junior2025 from '../../papers/2025-26-junior.json';
import junior2024 from '../../papers/2024-25-junior.json';
import sample2024 from '../../papers/2024-25-sample-senior.json';
import { solveJointBlanks } from './joint';

function question(paper: unknown, id: string) {
  return (paper as PaperConfig).questions.find(item => item.id === id)!;
}

describe('joint search on published papers', () => {
  it.each(['cpp', 'python'] as const)('finds both affine blanks in the 2025/26 Junior %s question', async language => {
    const item = question(junior2025, 'paper1-g');
    const result = await solveJointBlanks({ question: item, blankIds: ['G1', 'G2'], language,
      strategy: 'hybrid', maxCandidates: 1000, maxResults: 1, maxMs: 20_000 });
    expect(result.assignments?.length, JSON.stringify(result)).toBeGreaterThan(0);
    for (const assignment of result.assignments ?? []) {
      expect((await gradeQuestion(item, assignment, language)).status).toBe('pass');
    }
    expect(result.tested).toBeLessThanOrEqual(1000);
  }, 45_000);

  it('finds both state update blanks in the 2024/25 Junior Python question', async () => {
    const item = question(junior2024, 'python-i');
    const result = await solveJointBlanks({ question: item, blankIds: ['I1', 'I2'], language: 'python',
      strategy: 'hybrid', maxCandidates: 1000, maxResults: 1, maxMs: 20_000 });
    expect(result.assignments?.length, JSON.stringify(result)).toBeGreaterThan(0);
    for (const assignment of result.assignments ?? []) {
      expect((await gradeQuestion(item, assignment, 'python')).status).toBe('pass');
    }
  }, 45_000);

  it('rejects misleading state updates on distinct and repeated larger values', async () => {
    const item = question(junior2024, 'python-i');
    expect((await gradeQuestion(item, { I1: 'x', I2: '1' }, 'python')).status).toBe('pass');
    expect((await gradeQuestion(item, { I1: 'v+1', I2: 'v' }, 'python')).status).toBe('fail');
    expect((await gradeQuestion(item, { I1: 'x', I2: 'v<2' }, 'python')).status).toBe('fail');
  }, 45_000);

  it('searches three short blanks in one 2024/25 sample Python function', async () => {
    const item = question(sample2024, 'python-j');
    const result = await solveJointBlanks({ question: item, blankIds: ['J1', 'J2', 'J3'], language: 'python',
      strategy: 'hybrid', maxCandidates: 5000, maxResults: 1, maxMs: 20_000 });
    expect(result.assignments?.length, JSON.stringify(result)).toBeGreaterThan(0);
    for (const assignment of result.assignments ?? []) {
      expect((await gradeQuestion(item, assignment, 'python')).status).toBe('pass');
    }
  }, 45_000);

  it('finds coupled loop-bound and index expressions in the 2024/25 Junior C++ question', async () => {
    const item = question(junior2024, 'cpp-t');
    const result = await solveJointBlanks({ question: item, blankIds: ['T1', 'T2'], language: 'cpp',
      strategy: 'deep', maxCandidates: 10_000, maxResults: 1, maxMs: 60_000 });
    expect(result.assignments?.length, JSON.stringify(result)).toBeGreaterThan(0);
    for (const assignment of result.assignments ?? []) {
      expect((await gradeQuestion(item, assignment, 'cpp')).status).toBe('pass');
    }
  }, 75_000);

  it('can stop without spending the whole candidate budget', async () => {
    const result = await solveJointBlanks({ question: question(junior2025, 'paper1-g'), blankIds: ['G1', 'G2'],
      language: 'cpp', maxCandidates: 100_000, maxMs: 20_000 }, undefined, () => true);
    expect(result.status).toBe('cancelled');
    expect(result.tested).toBe(0);
  });

  it('streams a verified assignment and keeps it when cancelled', async () => {
    let cancel = false;
    const progressAssignments: Record<string, string>[][] = [];
    const result = await solveJointBlanks({ question: question(junior2025, 'paper1-g'), blankIds: ['G1', 'G2'],
      language: 'cpp', maxCandidates: 10_000, maxResults: 8, maxMs: 20_000 }, progress => {
      if (progress.assignments?.length) {
        progressAssignments.push(progress.assignments);
        cancel = true;
      }
    }, () => cancel);
    expect(progressAssignments.length).toBeGreaterThan(0);
    expect(result.status).toBe('cancelled');
    expect(result.assignments).toEqual(progressAssignments.at(-1));
  }, 45_000);
});
