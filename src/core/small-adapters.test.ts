import { expect, it } from 'vitest';
import { gradeQuestion } from './grader';
import type { Question } from './types';

const base = { track: 'section-b', title: 'Test', printedRef: 'Section B Q1', prompt: { en: '' }, points: 2 };

it('checks checksum collisions by value instead of accepting a fixed list', async () => {
  const question: Question = { ...base, id: 'checksum', blanks: [{ id: 'E' }],
    grading: { kind: 'checksum-collision', answerBlank: 'E', reference: 'PAGE', powers: [4, 3, 2, 1], alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' } };
  expect((await gradeQuestion(question, { E: 'PAFR' })).status).toBe('pass');
  expect((await gradeQuestion(question, { E: 'PAGE' })).status).toBe('fail');
  expect((await gradeQuestion(question, { E: 'PAGR' })).status).toBe('fail');
});

it('checks a route from move lengths, key, and blocked landings', async () => {
  const question: Question = { ...base, id: 'path', blanks: [{ id: 'F' }],
    grading: { kind: 'zigzag-path', answerBlank: 'F', steps: [2, 2, 3, 4, 5, 6], start: 0, end: 22, key: 11,
      blocked: [1, 4, 7, 9, 13, 14, 17, 19, 20] } };
  for (const answer of ['236524', '263524', '326524', '623524', '242356']) {
    expect((await gradeQuestion(question, { F: answer })).status, answer).toBe('pass');
  }
  expect((await gradeQuestion(question, { F: '223456' })).status).toBe('fail');
  expect((await gradeQuestion(question, { F: '236522' })).status).toBe('fail');
});

it('uses the candidate text as stdin and enforces an allowed alphabet', async () => {
  const question: Question = { ...base, id: 'input', blanks: [{ id: 'F', allowedChars: ' 0123456789' }],
    grading: { kind: 'program-input', answerBlank: 'F', target: { language: 'cpp',
      source: 'int main(){int x;cin>>x;cout<<x*2;}', harness: { kind: 'program' } },
      expected: { stdout: '40' }, maxSteps: 1000 } };
  expect((await gradeQuestion(question, { F: '20' })).status).toBe('pass');
  expect((await gradeQuestion(question, { F: '21' })).status).toBe('fail');
  expect((await gradeQuestion(question, { F: '20a' })).status).toBe('fail');
});
