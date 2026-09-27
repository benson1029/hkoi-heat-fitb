import type { EngineResult, ProgramEngine, ProgramTarget, ProgramCase } from '../../core/types';
import { CppFault, parse } from './syntax';
import { CheckedRuntime } from './runtime';

export function runCpp(source: string, target: ProgramTarget, testCase: ProgramCase): EngineResult {
  if (target.language !== 'cpp' && target.language !== 'c')
    return { kind: 'unsupported', message: `Language ${target.language} is not a C/C++ target` };
  if (!Number.isSafeInteger(testCase.maxSteps) || testCase.maxSteps < 1)
    return { kind: 'internal-error', message: 'Invalid step budget' };
  let runtime: CheckedRuntime | undefined;
  try {
    runtime = new CheckedRuntime(parse(source, target.language), target, testCase);
    const observation = runtime.run();
    return { kind: 'ok', observation, steps: runtime.stepCount };
  } catch (error) {
    if (error instanceof CppFault) return { kind: error.kind, message: error.message, steps: runtime?.stepCount };
    return { kind: 'internal-error', message: error instanceof Error ? error.message : String(error), steps: runtime?.stepCount };
  }
}

export const cppEngine: ProgramEngine = { run: runCpp };
