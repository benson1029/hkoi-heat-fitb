import { describe, expect, it } from 'vitest';
import type { ProgramCase, ProgramTarget } from '../../core/types';
import { createPythonEngine } from './index';

const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'double' } };
const testCase: ProgramCase = { id: 'basic', args: [4], expected: { returnValue: 8 }, maxSteps: 1_000 };

describe('Python engine', () => {
  const engine = createPythonEngine(true);

  it('uses the custom runtime by default', async () => {
    const customOnly = createPythonEngine();
    const result = await customOnly.run('import math\ndef double(n):\n    return math.floor(n * 2)', target, testCase);
    expect(result.kind).toBe('unsupported');
    if (result.kind === 'unsupported') expect(result.message).toContain('Select Pyodide');
  });

  it('runs a function with a fresh namespace and captures the return value', async () => {
    const result = await engine.run('def double(n):\n    return n * 2', target, testCase);
    expect(result.kind, JSON.stringify(result)).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.observation.returnValue).toBe(8);
      expect(result.steps).toBeGreaterThan(0);
    }
  }, 60_000);

  it('reports syntax errors and deterministic opcode exhaustion', async () => {
    const syntax = await engine.run('def double(:\n    pass', target, testCase);
    expect(syntax.kind).toBe('compile-error');
    const infinite = await engine.run('def double(n):\n    while True:\n        n += 1', target, { ...testCase, maxSteps: 200 });
    expect(infinite.kind).toBe('step-limit');
  }, 60_000);

  it('returns an inconclusive result for unsupported imports', async () => {
    const result = await engine.run('import js\ndef double(n):\n    return n * 2', target, testCase);
    expect(result.kind).toBe('unsupported');
  }, 60_000);

  it('observes in-place changes to function arguments', async () => {
    const result = await engine.run('def double(a):\n    a.append(5)', target, { ...testCase, args: [[1, 2]] });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.observation.argsAfter).toEqual([[1, 2, 5]]);
  }, 60_000);

  it('terminates native work that opcode tracing cannot interrupt', async () => {
    const result = await engine.run('def double(n):\n    return sum(range(2000000000))', target, testCase);
    expect(result.kind).toBe('wall-timeout');
  }, 60_000);
});
