import { expect, it } from 'vitest';
import source from '../../papers/2024-25-senior.json';
import cancelledSource from '../../papers/2019-20-junior.json';
import { gradeQuestion } from './grader';
import type { ProgramGrading, Question } from './types';
import { validatePaper } from './validate';

const paper = validatePaper(source);
const question = (id: string) => {
  const found = paper.questions.find(item => item.id === id);
  if (!found) throw new Error(`Missing ${id}`);
  return found;
};

it('grades the official graph construction through the shared API', async () => {
  const result = await gradeQuestion(question('paper1-j'), { J: '[["A","C"],["C","E"],["E","G"]]' });
  expect(result.status).toBe('pass');
  expect(result.score).toBe(question('paper1-j').points);
});

it('distinguishes a missing answer from a cancelled question', async () => {
  expect((await gradeQuestion(question('paper1-j'), {})).status).toBe('fail');
  const cancelled = validatePaper(cancelledSource);
  expect((await gradeQuestion(cancelled.questions.find(item => item.id === 'D')!, {})).status).toBe('cancelled');
});

it('enforces prohibited identifiers as whole tokens', async () => {
  const constrained: Question = { ...question('paper1-a'), blanks: [{ id: 'A', forbiddenIdentifiers: ['f'] }],
    grading: { kind: 'literal', accepted: { A: ['ff'] }, normalize: 'trim' } };
  const prohibited = await gradeQuestion(constrained, { A: 'f' });
  expect(prohibited.status).toBe('fail');
  expect(prohibited.message).toContain('prohibited identifier');
  expect((await gradeQuestion(constrained, { A: 'ff' })).status).toBe('pass');
});

it('can exclude whitespace from a printed character limit', async () => {
  const constrained: Question = { ...question('paper1-a'), blanks: [{ id: 'A', maxChars: 5, maxCharsExcludeWhitespace: true }],
    grading: { kind: 'literal', accepted: { A: ['z = i % j'] }, normalize: 'none' } };
  expect((await gradeQuestion(constrained, { A: 'z = i % j' })).status).toBe('pass');
  expect((await gradeQuestion(constrained, { A: 'z = i % jj' })).message).toContain('character limit');
});

it('accepts either program language and stops after an accepted target', async () => {
  const grading: ProgramGrading = {
    kind: 'program', targetPolicy: 'any',
    targets: [
      { language: 'python', source: 'print({{A}})', harness: { kind: 'program' } },
      { language: 'cpp', source: '#include <iostream>\nint main() { std::cout << ({{A}} + 1) << "\\n"; }', harness: { kind: 'program' } }
    ],
    cases: [{ id: 'one', expected: { stdout: '7\n' }, maxSteps: 1000 }]
  };
  const base: Question = {
    id: 'either-language', track: 'paper1', printedRef: 'A', title: '', prompt: { en: '' }, points: 1,
    blanks: [{ id: 'A' }], grading
  };
  const pythonPass = await gradeQuestion(base, { A: '7' });
  expect(pythonPass.status).toBe('pass');
  expect(pythonPass.cases.map(item => item.id)).toEqual(['python:one']);

  const cppPass: Question = { ...base, grading: { ...grading, targets: [
    { language: 'python', source: 'print({{A}} + 1)', harness: { kind: 'program' } },
    { language: 'cpp', source: '#include <iostream>\nint main() { std::cout << {{A}} << "\\n"; }', harness: { kind: 'program' } }
  ] } };
  const result = await gradeQuestion(cppPass, { A: '7' });
  expect(result.status).toBe('pass');
  expect(result.cases.map(item => item.id)).toEqual(['python:one', 'cpp:one']);
});

it('rejects a non-JSON Python return when a JSON value is required', async () => {
  const candidate: Question = {
    id: 'function-value', track: 'python', printedRef: 'A', title: '', prompt: { en: '' }, points: 1,
    blanks: [{ id: 'A' }],
    grading: {
      kind: 'program', targetPolicy: 'all',
      targets: [{ language: 'python', source: 'def f():\n    return {{A}}', harness: { kind: 'call', function: 'f' } }],
      cases: [{ id: 'one', expected: { returnValue: 1 }, maxSteps: 1000 }],
    },
  };
  const grade = await gradeQuestion(candidate, { A: 'tuple' }, undefined, undefined, { pythonRuntime: 'custom' });
  expect(grade.status).toBe('fail');
  expect(grade.cases[0].message).toContain('non-json-return');
});

it('rejects a non-JSON Python mutation when argument state is asserted', async () => {
  const candidate: Question = {
    id: 'non-json-mutation', track: 'python', printedRef: 'A', title: '', prompt: { en: '' }, points: 1,
    blanks: [{ id: 'A' }],
    grading: {
      kind: 'program', targetPolicy: 'all',
      targets: [{ language: 'python', source: 'def f(a):\n    a[0] = {{A}}\n    return 0', harness: { kind: 'call', function: 'f' } }],
      cases: [{ id: 'one', args: [[0]], expected: { returnValue: 0, argsAfter: [[1]] }, maxSteps: 1000 }],
    },
  };
  const grade = await gradeQuestion(candidate, { A: 'a' }, undefined, undefined, { pythonRuntime: 'custom' });
  expect(grade.status).toBe('fail');
  expect(grade.cases[0].message).toContain('Expected');
});
