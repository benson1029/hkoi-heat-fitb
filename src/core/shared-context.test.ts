import { expect, it } from 'vitest';
import { gradePaper } from './grader';
import { validatePaper } from './validate';

function paper(code: string, secondBlank = 'B') {
  const context: {
    id: string; track: string; markdown: string; displayCode: { cpp: string };
    answerSets?: { questionId: string; label: string; bindings: Record<string, string> }[];
  } = { id: 'function', track: 'section-b', markdown: 'Complete the function.', displayCode: { cpp: code } };
  return {
    schemaVersion: 1,
    paper: { id: 'shared-code-test', season: 'test', division: 'junior' },
    tracks: [{ id: 'section-b', label: 'Section B', selection: 'required' }],
    contexts: [context],
    questions: [
      {
        id: 'a', track: 'section-b', contextId: 'function', printedRef: 'Section B, Question 1, Blank A',
        title: 'Section B, Question 1', prompt: { en: '' }, points: 1, blanks: [{ id: 'A' }],
        grading: { kind: 'literal', accepted: { A: ['1'] }, normalize: 'trim' }
      },
      {
        id: 'b', track: 'section-b', contextId: 'function', printedRef: 'Section B, Question 1, Blank B',
        title: 'Section B, Question 1', prompt: { en: '' }, points: 1, blanks: [{ id: secondBlank }],
        grading: { kind: 'literal', accepted: { [secondBlank]: ['2'] }, normalize: 'trim' }
      }
    ]
  };
}

it('keeps shared editable code and scores the printed blanks independently', async () => {
  const config = validatePaper(paper('int f() { return {{A}} + {{B}}; }'));
  const grade = await gradePaper(config, { a: { A: '1' }, b: { B: '9' } }, ['section-b']);
  expect(grade.questions.map((item) => [item.questionId, item.status, item.score])).toEqual([
    ['a', 'pass', 1], ['b', 'fail', 0]
  ]);
});

it('rejects a shared code marker without one owning blank', () => {
  expect(() => validatePaper(paper('int f() { return {{A}} + {{C}}; }'))).toThrow(/unknown displayCode marker C/);
  expect(() => validatePaper(paper('int f() { return {{A}} + {{B}}; }', 'A'))).toThrow(/multiple owners/);
});

it('binds alternative answer sets to the same printed code slots', async () => {
  const source = paper('int f() { return {{slot}}; }');
  source.contexts[0].answerSets = [
    { questionId: 'a', label: '(a)', bindings: { slot: 'A' } },
    { questionId: 'b', label: '(b)', bindings: { slot: 'B' } }
  ];
  const config = validatePaper(source);
  const grade = await gradePaper(config, { a: { A: '1' }, b: { B: '9' } }, ['section-b']);
  expect(grade.questions.map((item) => item.score)).toEqual([1, 0]);
  source.contexts[0].answerSets[1].bindings = { wrong: 'B' };
  expect(() => validatePaper(source)).toThrow(/bind every code slot/);
});
