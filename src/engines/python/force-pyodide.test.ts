import { expect, it, vi } from 'vitest';
import type { ProgramCase, ProgramTarget } from '../../core/types';

const fastRunner = vi.hoisted(() => vi.fn(() => ({
  kind: 'ok' as const, observation: { returnValue: 999 }, steps: 1
})));
vi.mock('./fast-function', () => ({ tryRunFastPythonFunction: fastRunner }));

import { createPythonEngine } from './index';

const target: ProgramTarget = { language: 'python', source: '', harness: { kind: 'call', function: 'double' } };
const testCase: ProgramCase = { id: 'supported', args: [4], expected: { returnValue: 8 }, maxSteps: 1_000 };

it('runs Pyodide even when the custom runner could handle the source', async () => {
  const source = 'def double(n):\n    return n * 2';
  expect(await createPythonEngine().run(source, target, testCase)).toMatchObject({
    kind: 'ok', observation: { returnValue: 999 }
  });
  fastRunner.mockClear();
  const result = await createPythonEngine(true).run(source, target, testCase);
  expect(result).toMatchObject({ kind: 'ok', observation: { returnValue: 8 } });
  expect(fastRunner).not.toHaveBeenCalled();
}, 60_000);
