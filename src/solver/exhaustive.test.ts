import { describe, expect, it } from 'vitest';
import type { PaperConfig, Question } from '../core/types';
import junior2025 from '../../papers/2025-26-junior.json';
import junior2022 from '../../papers/2021-22-junior.json';
import senior2007 from '../../papers/2007-senior.json';
import { enumerateAnswerTuples, solveExhaustive } from './exhaustive';

describe('fair exhaustive fallback', () => {
  it('reaches every finite string over a small alphabet exactly once', () => {
    const tuples = [...enumerateAnswerTuples([{ id: 'A', maxChars: 2 }], { alphabet: '01' })];
    expect(new Set(tuples.map(tuple => tuple.A)).size).toBe(tuples.length);
    expect(new Set(tuples.map(tuple => tuple.A))).toEqual(new Set(['0', '1', '00', '01', '10', '11']));
  });

  it('reaches every joint assignment without starving a later blank', () => {
    const tuples = [...enumerateAnswerTuples([{ id: 'A', maxChars: 2 }, { id: 'B', maxChars: 2 }], { alphabet: '01' })];
    expect(tuples).toHaveLength(36);
    expect(tuples).toContainEqual({ A: '11', B: '0' });
    expect(tuples).toContainEqual({ A: '01', B: '10' });
    expect(new Set(tuples.map(tuple => JSON.stringify(tuple))).size).toBe(36);
  });

  it('respects character restrictions and counts supplementary Unicode as one character', () => {
    const tuples = [...enumerateAnswerTuples([{ id: 'A', maxChars: 1, allowedChars: 'a😀', forbiddenChars: 'a' }],
      { alphabet: 'a😀' })];
    expect(tuples).toEqual([{ A: '😀' }]);
  });

  it('finds a verified answer in an actual paper', async () => {
    const paper = junior2025 as PaperConfig;
    const question = paper.questions.find(item => item.id === 'paper1-d')!;
    const result = await solveExhaustive({ question, blankId: 'D', language: 'cpp', strategy: 'exhaustive',
      maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    expect(result.found, JSON.stringify(result)).toContain('14');
    expect(result.tested).toBeGreaterThan(0);
  }, 30_000);

  it('grades a two-blank assignment together', async () => {
    const question: Question = {
      id: 'joint', track: 'test', printedRef: 'Joint', title: 'Joint', prompt: { en: 'Complete both.' },
      points: 2, blanks: [{ id: 'A', maxChars: 1, allowedChars: '01' }, { id: 'B', maxChars: 1, allowedChars: '01' }],
      grading: { kind: 'literal', accepted: { A: ['1'], B: ['0'] }, normalize: 'none' }
    };
    const result = await solveExhaustive({ question, blankIds: ['A', 'B'], maxCandidates: 10, maxResults: 1 });
    expect(result.assignments).toContainEqual({ A: '1', B: '0' });
    expect(result.tested).toBeLessThanOrEqual(4);
  });

  it('solves a real two-blank coin counterexample with the semantic checker', async () => {
    const question = (junior2022 as PaperConfig).questions.find(item => item.id === 'C')!;
    const result = await solveExhaustive({ question, blankIds: ['C1', 'C2'], maxCandidates: 2_000,
      maxResults: 1, maxMs: 20_000 });
    expect(result.assignments?.length, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.assignments?.[0]).toHaveProperty('C1');
    expect(result.assignments?.[0]).toHaveProperty('C2');
  }, 30_000);

  it('uses prior question answers when enumerating alternate graph routes', async () => {
    const question = (senior2007 as PaperConfig).questions.find(item => item.id === 'H')!;
    const result = await solveExhaustive({ question, blankId: 'H', allAnswers: { G: { G: 's->f->g->t' } },
      maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    expect(result.found.length, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.found[0]).not.toBe('s->f->g->t');
  }, 30_000);

  it('honors cancellation while enumerating a joint search', async () => {
    const question = (junior2025 as PaperConfig).questions.find(item => item.id === 'paper1-d')!;
    let cancel = false;
    const result = await solveExhaustive({ question, blankId: 'D', language: 'cpp', maxCandidates: 1000 },
      () => { cancel = true; }, () => cancel);
    expect(['cancelled', 'limit']).toContain(result.status);
  }, 30_000);
});
