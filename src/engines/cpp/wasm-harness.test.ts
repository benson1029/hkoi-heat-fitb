import { expect, it } from 'vitest';
import type { ProgramTarget } from '../../core/types';
import { buildWasmSource, readWasmObservation } from './wasm-harness';

it('builds a call harness and extracts an observation', () => {
  const target: ProgramTarget = { language: 'cpp', source: '', harness: { kind: 'call', function: 'increment' } };
  const source = buildWasmSource('int increment(int& x){ return ++x; }', target,
    { id: 'generic', args: [4], expected: {}, maxSteps: 100 });
  expect(source).toContain('hkoi_invoke(&increment');
  expect(source).toContain('int increment(int& x)');
  expect(readWasmObservation('', '__HKOI_OBS_BEGIN__5__HKOI_ARGS_BEGIN__[5]__HKOI_OBS_END__', target))
    .toEqual({ returnValue: 5, stdout: '', argsAfter: [5] });
});
