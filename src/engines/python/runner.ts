import type { EngineResult, ProgramCase, ProgramTarget } from '../../core/types';

const MAX_SOURCE_BYTES = 200_000;
const MAX_INPUT_BYTES = 100_000;
const encoder = new TextEncoder();

export function preparePythonPayload(source: string, target: ProgramTarget, testCase: ProgramCase): { payload: string } | { error: EngineResult } {
  if (target.language !== 'python') return { error: { kind: 'unsupported', message: 'This engine supports Python only' } };
  if (encoder.encode(source).length > MAX_SOURCE_BYTES) return { error: { kind: 'unsupported', message: 'Source byte limit exceeded' } };
  if (encoder.encode(testCase.stdin || '').length > MAX_INPUT_BYTES) return { error: { kind: 'unsupported', message: 'Input byte limit exceeded' } };
  if (testCase.maxSteps < 1 || testCase.maxSteps > 50_000) return { error: { kind: 'unsupported', message: 'Invalid Python step budget' } };
  const payload = JSON.stringify({ source, target: { harness: target.harness }, testCase: { args: testCase.args || [], stdin: testCase.stdin || '', maxSteps: testCase.maxSteps } });
  if (encoder.encode(payload).length > 400_000) return { error: { kind: 'unsupported', message: 'Case payload limit exceeded' } };
  return { payload };
}
