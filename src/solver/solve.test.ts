import { describe, expect, it } from 'vitest';
import type { PaperConfig } from '../core/types';
import { gradeQuestion } from '../core/grader';
import junior2025 from '../../papers/2025-26-junior.json';
import junior2022 from '../../papers/2022-23-junior.json';
import senior2022 from '../../papers/2022-23-senior.json';
import junior2023 from '../../papers/2023-24-junior.json';
import senior2023 from '../../papers/2023-24-senior.json';
import junior2024 from '../../papers/2024-25-junior.json';
import junior2005 from '../../papers/2005-junior.json';
import senior2009 from '../../papers/2009-senior.json';
import senior2012 from '../../papers/2012-senior.json';
import senior2007 from '../../papers/2007-senior.json';
import junior2008 from '../../papers/2008-junior.json';
import sample2024 from '../../papers/2024-25-sample-senior.json';
import { solveProgramBlank } from './solve';
import { solveJointBlanks } from './joint';
import { classifyBlankContext, generateCandidates } from './candidates';

function question(paper: unknown, id: string) {
  return (paper as PaperConfig).questions.find(item => item.id === id)!;
}

describe('bounded syntax-aware solver on published questions', () => {
  it('finds a short scalar expression with either strategy', async () => {
    const item = question(junior2025, 'cpp-o');
    for (const strategy of ['templates', 'grammar'] as const) {
      const result = await solveProgramBlank({ question: item, blankId: 'O', language: 'cpp', strategy,
        maxCandidates: 400, maxResults: 1, maxMs: 20_000 });
      expect(result.found.length, `${strategy}: ${JSON.stringify(result)}`).toBeGreaterThan(0);
      expect(result.tested).toBeLessThanOrEqual(400);
    }
  }, 45_000);

  it('finds an indexed vector comparison with the grammar strategy', async () => {
    const result = await solveProgramBlank({ question: question(junior2024, 'cpp-p'), blankId: 'P', language: 'cpp',
      strategy: 'grammar', maxCandidates: 1200, maxResults: 1, maxMs: 20_000 });
    expect(result.found.length, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.tested).toBeLessThanOrEqual(1200);
  }, 45_000);

  it('uses statement productions for a standalone C++ blank', async () => {
    const item = question(junior2024, 'cpp-o');
    if (item.grading.kind !== 'program') throw new Error('Expected program question');
    expect(classifyBlankContext(item.grading.targets[0].source, 'O')).toBe('statement');
    expect([...generateCandidates(item, 'O', 'cpp', 'hybrid')].slice(0, 2)).toEqual(['break', 'continue']);
    const result = await solveProgramBlank({ question: item, blankId: 'O', language: 'cpp',
      strategy: 'hybrid', maxCandidates: 50, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('break');
    expect(result.tested).toBe(1);
  }, 45_000);

  it('searches complete return and indexed-update statements in legacy C blanks', async () => {
    const examples = [
      { item: question(senior2007, 'A'), blankId: 'A', answer: 'return 0' },
      { item: question(senior2007, 'B'), blankId: 'B', answer: 'return hamming(n/i)' },
      { item: question(junior2008, 'section-b-k'), blankId: 'K', answer: 'F[k]++;' }
    ];
    for (const { item, blankId, answer } of examples) {
      const result = await solveProgramBlank({ question: item, blankId, language: 'c',
        strategy: 'hybrid', maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
      expect(result.found, `${blankId}: ${JSON.stringify(result)}`).toContain(answer);
    }
  }, 60_000);

  it('uses a supplied helper with an argument permutation', async () => {
    const item = question(junior2005, 'section-b-j');
    const baseline = await solveProgramBlank({ question: item, blankId: 'J', language: 'c',
      strategy: 'templates', maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    const composed = await solveProgramBlank({ question: item, blankId: 'J', language: 'c',
      strategy: 'grammar', maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    expect(baseline.found).toEqual([]);
    expect(composed.found).toContain('maximum(a,b)');
    expect(composed.tested).toBeLessThan(baseline.tested);
  }, 45_000);

  it('enumerates a nested helper call beyond the first short answer', async () => {
    const result = await solveProgramBlank({ question: question(senior2009, 'section-b-f'), blankId: 'F',
      language: 'c', strategy: 'grammar', maxCandidates: 500, maxResults: 20, maxMs: 20_000 });
    expect(result.found).toContain('B(B(x))');
  }, 45_000);

  it('composes an arithmetic argument for a supplied helper', async () => {
    const result = await solveProgramBlank({ question: question(senior2012, 'A'), blankId: 'A',
      language: 'c', strategy: 'grammar', maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('m(x,y,x+y)');
    expect(result.tested).toBeLessThan(100);
  }, 45_000);

  it('finds a Python arithmetic condition through the fast interpreter', async () => {
    const result = await solveProgramBlank({ question: question(junior2025, 'paper1-i'), blankId: 'I',
      language: 'python', strategy: 'grammar', maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('a+b>c');
    expect(result.tested).toBeLessThan(100);
  }, 45_000);

  it('passes a loop-derived square difference to a supplied Python helper', async () => {
    const result = await solveProgramBlank({ question: question(junior2025, 'python-d'), blankId: 'D',
      language: 'python', strategy: 'hybrid', maxCandidates: 200, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('is_cube(n-i*i)');
    expect(result.tested).toBeLessThan(50);
  }, 45_000);

  it('uses a legal two\'s-complement negation when minus is forbidden', async () => {
    const result = await solveProgramBlank({ question: question(junior2022, 'junior-d'), blankId: 'D',
      language: 'cpp', strategy: 'hybrid', maxCandidates: 100, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('~x+1');
  }, 45_000);

  it('fills a short operator suffix', async () => {
    const result = await solveProgramBlank({ question: question(senior2022, 'cpp-i'), blankId: 'I',
      language: 'cpp', strategy: 'hybrid', maxCandidates: 100, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('%7');
  }, 45_000);

  it('fills a void function early return and a for header', async () => {
    for (const [paper, id, blank, expected] of [
      [junior2023, 'junior-d', 'D', 'return'],
      [senior2023, 'cpp-b', 'B', 'i=1;i<n;i++']
    ] as const) {
      const result = await solveProgramBlank({ question: question(paper, id), blankId: blank,
        language: 'cpp', strategy: 'hybrid', maxCandidates: 100, maxResults: 1, maxMs: 20_000 });
      expect(result.found).toContain(expected);
    }
  }, 45_000);

  it('pairs comparison and control-flow fragments across blanks', async () => {
    for (const [id, expected] of [
      ['junior-b', { B1: 'a>b', B2: 'a<b' }],
      ['junior-c', { C1: 'else if', C2: 'else if' }]
    ] as const) {
      const item = question(junior2023, id);
      const result = await solveJointBlanks({ question: item, blankIds: item.blanks.map(blank => blank.id),
        language: 'cpp', strategy: 'hybrid', maxCandidates: 100, maxResults: 1, maxMs: 20_000 });
      expect(result.assignments).toContainEqual(expected);
    }
  }, 45_000);

  it('searches short literals absent from the printed code', async () => {
    const item = question(junior2025, 'paper1-d');
    for (const language of ['python', 'cpp'] as const) {
      const result = await solveProgramBlank({ question: item, blankId: 'D', language,
        strategy: 'hybrid', maxCandidates: 100, maxResults: 1, maxMs: 20_000 });
      expect(result.found, `${language}: ${JSON.stringify(result)}`).toContain('14');
      expect(result.tested).toBeLessThan(25);
    }
  }, 45_000);

  it('treats a hole within an if comparison as an expression', async () => {
    const item = question(junior2025, 'python-g');
    if (item.grading.kind !== 'program') throw new Error('Expected program question');
    expect(classifyBlankContext(item.grading.targets[0].source, 'G')).toBe('expression');
    const result = await solveProgramBlank({ question: item, blankId: 'G', language: 'python',
      strategy: 'deep', maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('a[i]-a[i-1]');
    expect(result.tested).toBeLessThan(100);
  }, 45_000);

  it('rejects a chained-comparison shortcut for the beautiful-list task', async () => {
    const item = question(junior2025, 'python-h');
    expect((await gradeQuestion(item, { H: 'n<a[i]' }, 'python')).status).toBe('fail');
    const result = await solveProgramBlank({ question: item, blankId: 'H', language: 'python',
      strategy: 'hybrid', maxCandidates: 2_000, maxResults: 8, maxMs: 20_000 });
    expect(result.found).not.toContain('n<a[i]');
    expect(result.found).toContain('a[0]+i');
  }, 45_000);

  it('uses cost-bounded composition when shallow grammar misses a conjunction', async () => {
    const item = question(junior2025, 'cpp-r');
    const shallow = await solveProgramBlank({ question: item, blankId: 'R', language: 'cpp',
      strategy: 'hybrid', maxCandidates: 2_000, maxResults: 1, maxMs: 20_000 });
    const deep = await solveProgramBlank({ question: item, blankId: 'R', language: 'cpp',
      strategy: 'deep', maxCandidates: 2_000, maxResults: 1, maxMs: 20_000 });
    expect(shallow.found).toEqual([]);
    expect(deep.found).toContain('0==m%2&&0==n%2');
    expect(deep.tested).toBeLessThan(1_000);
  }, 45_000);

  it('finds a Python loop bound through the bounded statement interpreter', async () => {
    const result = await solveProgramBlank({ question: question(sample2024, 'python-d'), blankId: 'D',
      language: 'python', strategy: 'hybrid', maxCandidates: 100, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('1,n');
    expect(result.tested).toBeLessThan(10);
  }, 45_000);

  it('finds the sample paper\'s affine nested Python helper call', async () => {
    const result = await solveProgramBlank({ question: question(sample2024, 'python-f'), blankId: 'F',
      language: 'python', strategy: 'hybrid', maxCandidates: 500, maxResults: 1, maxMs: 20_000 });
    expect(result.found).toContain('f(x*2-2)');
    expect(result.tested).toBeLessThan(100);
  }, 45_000);

  it('finds computed arguments for a given helper in both paper languages', async () => {
    const item = question(junior2024, 'paper1-g');
    for (const language of ['python', 'cpp'] as const) {
      const result = await solveProgramBlank({ question: item, blankId: 'G', language,
        strategy: 'hybrid', maxCandidates: 100, maxResults: 1, maxMs: 20_000 });
      expect(result.found, `${language}: ${JSON.stringify(result)}`).toContain('j,j+1');
      expect(result.tested).toBeLessThan(50);
    }
  }, 45_000);

  it('requires the other blanks before searching a shared program', async () => {
    const result = await solveProgramBlank({ question: question(junior2024, 'cpp-t'), blankId: 'T1', language: 'cpp' });
    expect(result.status).toBe('unsupported');
    expect(result.tested).toBe(0);
  });

  it('stops when cancelled', async () => {
    let cancel = false;
    const result = await solveProgramBlank({ question: question(junior2025, 'cpp-o'), blankId: 'O', language: 'cpp',
      maxCandidates: 400 }, progress => { if (progress.found.length) cancel = true; }, () => cancel);
    expect(result.status).toBe('cancelled');
    expect(result.found.length).toBeGreaterThan(0);
  }, 45_000);
});
