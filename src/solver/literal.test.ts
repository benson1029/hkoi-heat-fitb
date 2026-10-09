import { describe, expect, it } from 'vitest';
import { gradeQuestion } from '../core/grader';
import { validatePaper } from '../core/validate';
import senior2008 from '../../papers/2008-senior.json';
import junior2010 from '../../papers/2010-junior.json';
import junior2013 from '../../papers/2013-junior.json';
import { generateLiteralCandidates } from './literal';

async function firstPassing(rawPaper: unknown, id: string, blankId: string, limit: number) {
  const paper = validatePaper(rawPaper);
  const question = paper.questions.find(item => item.id === id)!;
  let rank = 0;
  for (const answer of generateLiteralCandidates(question, blankId)) {
    if (++rank > limit) break;
    if ((await gradeQuestion(question, { [blankId]: answer })).status === 'pass') return { answer, rank };
  }
  return undefined;
}

describe('source-guided literal candidates', () => {
  it('finds a small numeric answer from a printed number problem', async () => {
    expect(await firstPassing(junior2013, 'section-b-a', 'A', 120)).toBeDefined();
  });

  it('enumerates permutations of the letters printed in the question', async () => {
    expect(await firstPassing(senior2008, 'section-b-i', 'I', 130)).toBeDefined();
  });

  it('covers a lexicographic rank as a bounded integer', async () => {
    expect(await firstPassing(senior2008, 'section-b-j', 'J', 140)).toBeDefined();
  });

  it('produces truth assignments without reading accepted lists', async () => {
    expect(await firstPassing(junior2010, 'A', 'A', 200)).toBeDefined();
  });
});
