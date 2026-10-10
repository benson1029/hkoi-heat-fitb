import { expect, it, vi } from 'vitest';
import type { Question } from '../core/types';

const fastRunner = vi.hoisted(() => vi.fn(() => { throw new Error('Custom Python runner was used'); }));
const pyodideRun = vi.hoisted(() => vi.fn(async (source: string) => {
  const result = /return\s+(\d+)(?:\s*\+\s*(\d+))?/.exec(source);
  return { kind: 'ok' as const, observation: { returnValue: result ? Number(result[1]) + Number(result[2] ?? 0) : -1 }, steps: 1 };
}));
vi.mock('../engines/python/fast-function', () => ({ tryRunFastPythonFunction: fastRunner }));
vi.mock('../engines/python', () => ({ pythonEnginePyodide: { run: pyodideRun } }));

import { solveProgramBlank } from './solve';
import { solveJointBlanks } from './joint';

function question(source: string, ids: string[]): Question {
  return { id: 'python-runtime', track: 'test', printedRef: 'Question 1', title: 'Python',
    prompt: { en: 'Complete the function.' }, points: ids.length,
    blanks: ids.map(id => ({ id, maxChars: 1, allowedChars: '01' })),
    grading: { kind: 'program', targetPolicy: 'any',
      targets: [{ language: 'python', source, harness: { kind: 'call', function: 'f' } }],
      cases: [{ id: 'zero', expected: { returnValue: 0 }, maxSteps: 1_000 }] } };
}

it('uses Pyodide for single and joint Python candidate checks when selected', async () => {
  const single = await solveProgramBlank({ question: question('def f():\n    return {{A}}', ['A']),
    blankId: 'A', language: 'python', pythonRuntime: 'pyodide', maxCandidates: 30, maxMs: 10_000, maxResults: 1 });
  expect(single.found).toContain('0');
  const joint = await solveJointBlanks({ question: question('def f():\n    return {{A}}+{{B}}', ['A', 'B']),
    blankIds: ['A', 'B'], language: 'python', pythonRuntime: 'pyodide',
    maxCandidates: 100, maxMs: 10_000, maxResults: 1 });
  expect(joint.assignments).toContainEqual({ A: '0', B: '0' });
  expect(pyodideRun).toHaveBeenCalled();
  expect(fastRunner).not.toHaveBeenCalled();
});
