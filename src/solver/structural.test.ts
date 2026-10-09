import { describe, expect, it } from 'vitest';
import { gradeQuestion } from '../core/grader';
import { validatePaper } from '../core/validate';
import junior2017 from '../../papers/2017-18-junior.json';
import senior2017 from '../../papers/2017-18-senior.json';
import junior2006 from '../../papers/2006-junior.json';
import junior2026 from '../../papers/2025-26-junior.json';
import junior2008 from '../../papers/2008-junior.json';
import { generateStructuralCandidates } from './structural';

const papers = [validatePaper(junior2017), validatePaper(senior2017), validatePaper(junior2006), validatePaper(junior2026), validatePaper(junior2008)];

async function firstPassing(paperIndex: number, questionId: string, blankId: string, limit = 180) {
  const question = papers[paperIndex].questions.find(item => item.id === questionId)!;
  const language = paperIndex === 2 || paperIndex === 4 ? 'c' : 'cpp';
  let examined = 0;
  for (const answer of generateStructuralCandidates(question, blankId, language)) {
    if (++examined > limit) break;
    const grade = await gradeQuestion(question, { [blankId]: answer }, language);
    if (grade.status === 'pass') return { answer, examined };
  }
  return undefined;
}

describe('source-derived structural completions', () => {
  it('finds the printed reversal bound in both 2017/18 papers', async () => {
    expect(await firstPassing(0, 'section-b-c', 'C', 55)).toBeDefined();
    expect(await firstPassing(1, 'cpp-c', 'C', 55)).toBeDefined();
  }, 30_000);

  it('finds helper-call compositions for the reversal and prime count', async () => {
    expect(await firstPassing(0, 'section-b-d', 'D', 100)).toBeDefined();
    expect(await firstPassing(0, 'section-b-k', 'K', 180)).toBeDefined();
  }, 30_000);

  it('finds a three-assignment swap without an answer dictionary', async () => {
    expect(await firstPassing(0, 'section-b-b', 'B', 100)).toBeDefined();
    expect(await firstPassing(1, 'cpp-b', 'B', 100)).toBeDefined();
  }, 30_000);

  it('finds a bounded sieve loop header in the 2006 Junior paper', async () => {
    expect(await firstPassing(2, 'H', 'H', 120)).toBeDefined();
    expect(await firstPassing(2, 'I', 'I', 120)).toBeDefined();
  }, 30_000);

  it('combines a boolean accumulator with the current vector element', async () => {
    expect(await firstPassing(3, 'cpp-p', 'P', 20)).toBeDefined();
  }, 30_000);

  it('uses the visible C standard library include to generate absolute-value expressions', async () => {
    expect(await firstPassing(4, 'section-b-h', 'H', 180)).toBeDefined();
  }, 30_000);
});
