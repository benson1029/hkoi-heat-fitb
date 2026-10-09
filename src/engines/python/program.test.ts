import { describe, expect, it } from 'vitest';
import junior25 from '../../../papers/2024-25-junior.json';
import junior26 from '../../../papers/2025-26-junior.json';
import senior26 from '../../../papers/2025-26-senior.json';
import sample25 from '../../../papers/2024-25-sample-senior.json';
import type { ProgramCase, ProgramTarget, Question } from '../../core/types';
import { tryRunFastPythonFunction } from './fast-function';

function run(paper: { questions: unknown[] }, id: string, answers: Record<string, string>, caseIndex = 0) {
  const question = (paper.questions as Question[]).find((q) => q.id === id)!;
  expect(question.grading.kind).toBe('program');
  if (question.grading.kind !== 'program') throw new Error('Expected program target');
  const target = question.grading.targets.find((t) => t.language === 'python') as ProgramTarget;
  const source = `${target.helperSource ? `${target.helperSource}\n` : ''}${target.source.replace(/\{\{([^{}]+)\}\}/g, (_, blank: string) => answers[blank] ?? '')}`;
  const testCase = question.grading.cases[caseIndex] as ProgramCase;
  return tryRunFastPythonFunction(source, target, testCase);
}

describe('custom Python paper runner', () => {
  it('executes nested loops, list mutation, and function calls from 2024/25 Junior', () => {
    expect(run(junior25, 'python-d', { D: 'a[i]!=a[i-1]' })?.kind).toBe('ok');
    expect(run(junior25, 'python-f', { F: '0<=ni<n and 0<=nj<m' })?.kind).toBe('ok');
    expect(run(junior25, 'python-g', { G: 'a[0]==a[-1]' })?.kind).toBe('ok');
    expect(run(junior25, 'python-k', { K1: 'l<=r', K2: 'l+=1', K3: 'r-=1', K4: 'r-=1' })?.kind).toBe('ok');
  });

  it('executes input, printing, recursion, and list comprehensions', () => {
    expect(run(junior26, 'python-e', { E: '"101",3' })?.kind).toBe('ok');
    expect(run(junior26, 'python-j', { J: 'x[-4:]' })?.kind).toBe('ok');
    expect(run(sample25, 'python-h', { H1: 'b[i-1]>b[i] and b[i+1]>b[i]', H2: '1' })?.kind).toBe('ok');
    expect(run(senior26, 'python-g', { G: 'X[i-1]+X[i]' })?.kind).toBe('ok');
  });

  it('leaves unsupported Python to Pyodide', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'x', args: [1], expected: {}, maxSteps: 1_000 };
    expect(tryRunFastPythonFunction('import math\ndef f(x):\n    return math.sin(x)', target, testCase)).toBeUndefined();
  });

  it('preserves alias mutation and Python signed arithmetic', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'alias', args: [[1, 2]], expected: {}, maxSteps: 1_000 };
    const result = tryRunFastPythonFunction('def f(a):\n    b = a\n    b += [9]\n    return -7 // 3, -7 % 3', target, testCase);
    expect(result).toMatchObject({ kind: 'ok', observation: { returnValue: [-3, 2], argsAfter: [[1, 2, 9]] } });
    expect(testCase.args).toEqual([[1, 2]]);
  });

  it('counts Unicode code points and keeps printed Unicode exact', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'program' } };
    const testCase: ProgramCase = { id: 'unicode', expected: {}, maxSteps: 1_000 };
    const result = tryRunFastPythonFunction('s = "🐱"\nprint(len(s), end=" ")\nprint(s)', target, testCase);
    expect(result).toMatchObject({ kind: 'ok', observation: { stdout: '1 🐱\n' } });
    expect(tryRunFastPythonFunction('print([1, 2])', target, testCase)).toBeUndefined();
  });
});
