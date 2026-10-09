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

  it('supports common iterator helpers, tuple unpacking, and list methods', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'iterators', args: [[2, 3], [4, 5]], expected: {}, maxSteps: 10_000 };
    const source = `def f(a, b):
    out = []
    for i, x in enumerate(a, 1):
        out.append(i * x)
    for x, y in zip(a, b):
        out.append(x + y)
    out.extend(reversed(a))
    return out`;
    expect(tryRunFastPythonFunction(source, target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: [2, 6, 6, 8, 3, 2], argsAfter: [[2, 3], [4, 5]] },
    });
  });

  it('supports conversions, text methods, and bounded numeric builtins', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'builtins', args: [], expected: {}, maxSteps: 10_000 };
    const source = `def f():
    a = "  a-b-a  ".strip().replace("a", "x", 1)
    return [a, "-".join(["a", "b"]), ord(chr(65)), pow(2, 10, 7), bin(5), sum((1, 2), 3), max("cat")]`;
    expect(tryRunFastPythonFunction(source, target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: ['x-b-a', 'a-b', 65, 2, '0b101', 6, 't'] },
    });
  });

  it('handles keyword arguments in sorted calls and user functions', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'keywords', args: [[3, 1, 2]], expected: {}, maxSteps: 10_000 };
    const source = `def add(x, y):
    return x + y
def f(a):
    b = sorted(a, reverse=True)
    a.sort(reverse=True)
    return [b, add(2, y=5)]`;
    expect(tryRunFastPythonFunction(source, target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: [[3, 2, 1], 7], argsAfter: [[3, 2, 1]] },
    });
  });

  it('evaluates filtered comprehensions and generators', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'filtered', args: [[1, 2, 3, 4]], expected: {}, maxSteps: 10_000 };
    const source = `def f(a):
    b = [x*x for x in a if x%2==0]
    return [b, any(x>3 for x in a if x%2==0), all(x>0 for x in a if x%2==1), sum(x for x in a if x%2==0)]`;
    expect(tryRunFastPythonFunction(source, target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: [[4, 16], true, true, 6] },
    });
  });

  it('serializes tuples like Python JSON and keeps numeric bounds exact', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'tuple', args: [], expected: {}, maxSteps: 10_000 };
    expect(tryRunFastPythonFunction('def f():\n    return divmod(-7, 3)', target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: [-3, 2] },
    });
    expect(tryRunFastPythonFunction('def f():\n    return sum([9007199254740991, 2, -2])', target, testCase)).toBeUndefined();
  });

  it('supports lambda keys, map, and filter on bounded sequences', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'lambda', args: [[3, 1, 2]], expected: {}, maxSteps: 10_000 };
    const source = `def f(a):
    b = sorted(a, key=lambda x: -x)
    c = list(map(lambda x: x*2, a))
    d = list(filter(lambda x: x%2, a))
    return [b, c, d]`;
    expect(tryRunFastPythonFunction(source, target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: [[3, 2, 1], [6, 2, 4], [3, 1]] },
    });
    expect(tryRunFastPythonFunction('def f(a):\n    return [max(a, key=lambda x: -x), sorted(a, key=abs)]', target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: [1, [1, 2, 3]] },
    });
    expect(tryRunFastPythonFunction('def f(a):\n    x = 1\n    g = lambda: x\n    x = 2\n    return g()', target, testCase)).toBeUndefined();
  });

  it('supports hashable dict and set literals without object key coercion', () => {
    const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'f' } };
    const testCase: ProgramCase = { id: 'mapping', args: [{ a: 7 }], expected: {}, maxSteps: 10_000 };
    const source = `def f(arg):
    d = {'x': 2, 1: 3}
    d['x'] += 1
    s = set([1, 2, 2])
    return [d, len(s), 2 in s, sorted(s), arg['a']]`;
    expect(tryRunFastPythonFunction(source, target, testCase)).toMatchObject({
      kind: 'ok', observation: { returnValue: [{ x: 3, '1': 3 }, 2, true, [1, 2], 7], argsAfter: [{ a: 7 }] },
    });
    expect(tryRunFastPythonFunction('def f(arg):\n    return {1, 2}', target, testCase)).toBeUndefined();
  });
});
