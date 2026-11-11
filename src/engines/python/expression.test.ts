import { describe, expect, it } from 'vitest';
import type { ProgramCase, ProgramTarget } from '../../core/types';
import { evaluatePythonExpression } from './expression';
import { tryRunFastPythonFunction } from './fast-function';

function value(source: string, variables: Record<string, unknown> = {}): unknown {
  const result = evaluatePythonExpression(source, variables);
  expect(result.kind, JSON.stringify(result)).toBe('ok');
  return result.kind === 'ok' ? result.value : undefined;
}

describe('bounded Python expression subset', () => {
  it('preserves Python floor division, modulo, power, and bitwise semantics', () => {
    expect(value('-7 // 3')).toBe(-3);
    expect(value('-7 % 3')).toBe(2);
    expect(value('7 % -3')).toBe(-2);
    expect(value('-2 ** 2')).toBe(-4);
    expect(value('2 ** 3 ** 2')).toBe(512);
    expect(value('(1 << 40) | 3')).toBe(1099511627779);
    expect(value('~2')).toBe(-3);
  });

  it('short circuits, chains comparisons, and handles negative indices', () => {
    expect(value('False and 1 // 0')).toBe(false);
    expect(value('0 or 9')).toBe(9);
    expect(value('1 < 2 < 3')).toBe(true);
    expect(value('1 < 2 > 3')).toBe(false);
    expect(value('2 != 3 < 2')).toBe(false);
    expect(value('a[-1] == 4 and len(a) == 3', { a: [2, 3, 4] })).toBe(true);
    expect(value('True == 1')).toBe(true);
    expect(value('True != False')).toBe(true);
    expect(value('False < True')).toBe(true);
    expect(value('True <= 1')).toBe(true);
    expect(value('[1, 3] < [2]')).toBe(true);
    expect(value('(1, 2) < (1, 3)')).toBe(true);
    expect(value('"ab" * -2')).toBe('');
    expect(value('2 * [1, 2]')).toEqual([1, 2, 1, 2]);
  });

  it('recognizes Python numeric literals and conservative identity comparisons', () => {
    expect(value('0b_1010 + 0xF + 1_000 + 1.e2')).toBe(1125);
    expect(value('None is None')).toBe(true);
    expect(value('True is not 1')).toBe(true);
    expect(evaluatePythonExpression('01').kind).toBe('compile-error');
    expect(evaluatePythonExpression('1 is 1').kind).toBe('unsupported');
    expect(value('len({True: 1, 1: 2})')).toBe(1);
    expect(value('True in {1, 2}')).toBe(true);
    expect(evaluatePythonExpression('[1] in {1, 2}').kind).toBe('unsupported');
  });

  it('returns unsupported for syntax or values that need Pyodide', () => {
    expect(evaluatePythonExpression('[x for x in a]', { a: [1] }).kind).toBe('unsupported');
    expect(evaluatePythonExpression('2 ** 60').kind).toBe('unsupported');
    expect(evaluatePythonExpression('a.sort()', { a: [2, 1] }).kind).toBe('unsupported');
    expect(evaluatePythonExpression('x + 1', { x: 3 }, 1).kind).toBe('step-limit');
    expect(evaluatePythonExpression('1 // 0').kind).toBe('runtime-error');
  });

  it('separates malformed expressions from Python runtime errors', () => {
    expect(evaluatePythonExpression('1+')).toMatchObject({ kind: 'compile-error', message: expect.stringContaining('SyntaxError') });
    expect(evaluatePythonExpression('f(x=1, 2)')).toMatchObject({ kind: 'compile-error', message: expect.stringContaining('SyntaxError') });
    expect(evaluatePythonExpression('items(0)+1', { items: [2] })).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('TypeError') });
    expect(evaluatePythonExpression('items[0]+MISSING', { items: [2] })).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('NameError') });
    expect(evaluatePythonExpression('3+list')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('TypeError') });
    expect(evaluatePythonExpression('int[0]+1')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('TypeError') });
    expect(value('len(items)', { items: [2, 4] })).toBe(2);
    expect(evaluatePythonExpression('len(3)')).toMatchObject({ kind: 'runtime-error', message: expect.stringContaining('TypeError') });
    expect(evaluatePythonExpression('2 @ 3').kind).toBe('unsupported');
  });

  it('runs only a safe, single-return function and leaves other sources to Pyodide', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'a', args: [[1, 2, 3]], expected: { returnValue: 3 }, maxSteps: 1000 };
    const result = tryRunFastPythonFunction('def f(a: list[int]) -> int:\n    return len(a)', target, testCase);
    expect(result).toMatchObject({ kind: 'ok', observation: { returnValue: 3, argsAfter: [[1, 2, 3]], stdout: '' } });
    expect(tryRunFastPythonFunction('def f(a):\n    a.sort()\n    return a', target, testCase)?.kind).toBe('ok');
    expect(tryRunFastPythonFunction('def f(a):\n    return sum(a)', target, { ...testCase, maxSteps: 10 })).toBeUndefined();
  });
});
