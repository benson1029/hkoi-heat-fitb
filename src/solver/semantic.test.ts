import { describe, expect, it } from 'vitest';
import type { PaperConfig, Question } from '../core/types';
import { gradeQuestion } from '../core/grader';
import junior2008 from '../../papers/2008-junior.json';
import senior2008 from '../../papers/2008-senior.json';
import senior2009 from '../../papers/2009-senior.json';
import senior2010 from '../../papers/2010-senior.json';
import junior2013 from '../../papers/2013-junior.json';
import junior2012 from '../../papers/2012-junior.json';
import junior2018 from '../../papers/2018-19-junior.json';
import junior2014 from '../../papers/2014-15-junior.json';
import junior2017 from '../../papers/2017-18-junior.json';
import junior2019 from '../../papers/2019-20-junior.json';
import junior2020 from '../../papers/2020-21-junior.json';
import senior2021 from '../../papers/2021-22-senior.json';
import { solveExhaustive } from './exhaustive';

function item(paper: unknown, id: string): Question {
  return (paper as PaperConfig).questions.find(question => question.id === id)!;
}

async function expectSolved(question: Question, maxMs = 3000) {
  const result = await solveExhaustive({ question, blankIds: question.blanks.map(blank => blank.id),
    strategy: 'exhaustive', maxCandidates: 250, maxMs, maxResults: 1 });
  expect(result.assignments?.length, `${question.id}: ${JSON.stringify(result)}`).toBeGreaterThan(0);
  expect((await gradeQuestion(question, result.assignments![0])).status).toBe('pass');
}

describe('semantic enumeration of published non-program questions', () => {
  it.each([
    [junior2008, 'section-b-c'], [junior2008, 'section-b-d'],
    [senior2008, 'section-b-a'], [senior2008, 'section-b-b']
  ])('finds a compact drawing robot program', async (paper, id) => {
    await expectSolved(item(paper, id), 3000);
  }, 10_000);

  it.each(['section-b-g', 'section-b-h', 'section-b-i', 'section-b-j'])
    ('constructs a grid visiting command for %s', async id => {
      await expectSolved(item(junior2012, id), 3000);
    }, 10_000);

  it.each(['section-b-c', 'section-b-d'])('plans box moves for %s', async id => {
    await expectSolved(item(senior2009, id));
  }, 10_000);

  it('builds a short inversion permutation under the printed character limit', async () => {
    await expectSolved(item(junior2018, 'section-b-j'));
  }, 10_000);

  it.each(['B', 'D'])('synthesizes the senior circuit and sorting network answer %s', async id => {
    await expectSolved(item(senior2010, id));
  }, 10_000);

  it.each(['section-b-i', 'section-b-j', 'section-b-k'])('enumerates pip geometry for %s', async id => {
    await expectSolved(item(junior2013, id));
  }, 10_000);

  it.each([
    [junior2014, 'HI'], [junior2017, 'section-b-l'],
    [junior2018, 'section-b-n'], [junior2019, 'M'],
    [junior2020, 'section-b-j'], [senior2021, 'cpp-i']
  ])('repairs C++ lines with source-derived edits', async (paper, id) => {
    const question = item(paper, id);
    const result = await solveExhaustive({ question, blankIds: question.blanks.map(blank => blank.id),
      strategy: 'exhaustive', maxCandidates: 250, maxMs: 3000, maxResults: 1 });
    expect(result.assignments?.length, `${question.id}: ${JSON.stringify(result)}`).toBeGreaterThan(0);
    const assignment = result.assignments![0];
    if (id === 'cpp-i') expect(assignment.I2).not.toContain('*');
    expect((await gradeQuestion(question, assignment)).status).toBe('pass');
  }, 10_000);
});
