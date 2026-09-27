import { expect, it } from 'vitest';
import { gradePaper, gradeQuestion } from './grader';
import { validatePaper } from './validate';

const helper = 'int double_it(int x) { return x * 2; }';
const body = 'int f() { return double_it({{A}}); }';

function fixture() {
  const target = (helperSource?: string) => ({
    language: 'cpp', dialect: 'c++20', helperSource, source: body,
    harness: { kind: 'call', function: 'f' }
  });
  const question = (id: string, targets: ReturnType<typeof target>[], expectedByLanguage?: { python: { returnValue: number } }) => ({
    id, track: 'main', printedRef: id, title: id, prompt: { en: id }, points: 1,
    blanks: [{ id: 'A', maxChars: 2 }],
    grading: { kind: 'program', targetPolicy: 'all', targets, cases: [
      { id: 'value', args: [], expected: { returnValue: 42 }, expectedByLanguage, maxSteps: 1000 }
    ] }
  });
  return {
    schemaVersion: 1, paper: { id: 'helper-fixture', season: 'test', division: 'senior' },
    tracks: [
      { id: 'main', label: 'Main', selection: 'required' },
      { id: 'cpp', label: 'C++', selection: 'choice', choiceGroup: 'language' },
      { id: 'python', label: 'Python', selection: 'choice', choiceGroup: 'language' }
    ],
    questions: [
      question('with-helper', [target(helper)]),
      question('without-helper', [target()]),
      question('target-isolation', [target(helper), target()]),
      question('language-select', [target(helper), {
        language: 'python', dialect: 'python3.11', helperSource: undefined,
        source: 'def f():\n    return {{A}}', harness: { kind: 'call', function: 'f' }
      }], { python: { returnValue: 21 } })
    ]
  };
}

it('runs fixed helper functions only in the owning target and question', async () => {
  const paper = validatePaper(fixture());
  const [withHelper, withoutHelper, targetIsolation] = paper.questions;
  expect(await gradeQuestion(withHelper, { A: '21' })).toMatchObject({ status: 'pass', score: 1 });
  expect(await gradeQuestion(withoutHelper, { A: '21' })).toMatchObject({ status: 'inconclusive', score: null });
  expect(await gradeQuestion(targetIsolation, { A: '21' })).toMatchObject({ status: 'inconclusive', score: null });
});

it('prepends a question-local Python helper to its Python target', async () => {
  const raw = fixture();
  raw.questions[0].grading.targets = [{
    language: 'python', dialect: 'python3.11',
    helperSource: 'def double_it(x):\n    return x * 2',
    source: 'def f():\n    return double_it({{A}})',
    harness: { kind: 'call', function: 'f' }
  }];
  const paper = validatePaper(raw);
  expect(await gradeQuestion(paper.questions[0], { A: '21' })).toMatchObject({ status: 'pass', score: 1 });
}, 60_000);

it('selects the matching language target from a choice track', async () => {
  const paper = validatePaper(fixture());
  const question = paper.questions.find(item => item.id === 'language-select')!;
  expect(await gradeQuestion(question, { A: '21' }, 'cpp')).toMatchObject({ status: 'pass', score: 1, cases: [{ id: 'cpp:value' }] });
  expect(await gradeQuestion(question, { A: '21' }, 'python')).toMatchObject({ status: 'pass', score: 1, cases: [{ id: 'python:value' }] });
  const result = await gradePaper(paper, { 'language-select': { A: '21' } }, ['main', 'cpp']);
  expect(result.questions.find(item => item.questionId === 'language-select')).toMatchObject({ status: 'pass', score: 1, cases: [{ id: 'cpp:value' }] });
});

it('rejects answer markers and oversize composed helper source', () => {
  const marked = fixture();
  marked.questions[0].grading.targets[0].helperSource = 'int double_it(int x) { return {{A}}; }';
  expect(() => validatePaper(marked)).toThrow(/helperSource cannot contain answer markers/);

  const oversize = fixture();
  oversize.questions[0].grading.targets[0].helperSource = ' '.repeat(128 * 1024);
  expect(() => validatePaper(oversize)).toThrow(/composed source byte limit/);
});

it('validates language-specific display code markers independently of grading source', () => {
  const paper = fixture();
  const question = paper.questions[0] as typeof paper.questions[0] & { displayCode?: Record<string, string> };
  question.displayCode = { cpp: 'int x = {{A}};', python: 'print(42)' };
  expect(() => validatePaper(paper)).not.toThrow();
  question.displayCode.cpp = 'int x = {{UNKNOWN}};';
  expect(() => validatePaper(paper)).toThrow(/unknown displayCode marker UNKNOWN/);
});
