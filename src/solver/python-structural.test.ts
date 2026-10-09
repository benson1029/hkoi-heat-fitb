import { describe, expect, it } from 'vitest';
import { gradeQuestion } from '../core/grader';
import { validatePaper } from '../core/validate';
import junior2024 from '../../papers/2024-25-junior.json';
import senior2024 from '../../papers/2024-25-senior.json';
import junior2025 from '../../papers/2025-26-junior.json';
import senior2025 from '../../papers/2025-26-senior.json';
import { generatePythonStructuralCandidates } from './python-structural';

const papers = [junior2024, senior2024, junior2025, senior2025].map(validatePaper);

async function firstPassing(paperIndex: number, questionId: string, blankId: string, limit = 300) {
  const question = papers[paperIndex].questions.find(item => item.id === questionId)!;
  let examined = 0;
  for (const answer of generatePythonStructuralCandidates(question, blankId)) {
    if (++examined > limit) break;
    const grade = await gradeQuestion(question, { [blankId]: answer }, 'python');
    if (grade.status === 'pass') return { answer, examined };
  }
  return undefined;
}

describe('source-derived Python completions', () => {
  it('finds adjacent loop indices for the supplied swap helper', async () => {
    expect((await firstPassing(0, 'paper1-g', 'G', 100))?.answer).toBe('j,j+1');
    expect((await firstPassing(0, 'paper1-h', 'H', 100))?.answer).toBe('i,j');
  }, 30_000);

  it('generates a list slice for a recursive list transformation', async () => {
    const result = await firstPassing(1, 'python-e', 'E', 300);
    expect(result?.answer).toBe('a[:idx]+a[idx+1:]');
  }, 30_000);

  it('uses adjacent cumulative values in a list assignment', async () => {
    expect((await firstPassing(3, 'python-g', 'G', 300))?.answer).toBe('X[i-1]+X[i]');
  }, 30_000);

  it('derives two-dimensional bounds from a later array access', async () => {
    const result = await firstPassing(0, 'python-f', 'F', 300);
    expect(result?.answer).toBe('0<=ni<n and 0<=nj<m');
    expect(result?.examined).toBeLessThan(5);
  }, 30_000);

  it('extends a printed base-case product to adjacent list entries', async () => {
    expect((await firstPassing(3, 'python-h', 'H', 300))?.answer).toBe('A[i]*B[i]-A[i-1]*B[i-1]');
  }, 30_000);
});
