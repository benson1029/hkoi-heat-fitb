import type { EngineResult, JsonValue, ProgramCase, ProgramTarget } from '../../core/types';
import { evaluatePythonExpression, PythonTuple } from './expression';
import { tryRunPythonProgram } from './program';

function isJsonValue(value: unknown): value is JsonValue {
  if (value instanceof PythonTuple) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object' && value && !('builtin' in value)) return Object.values(value).every(isJsonValue);
  return false;
}

/** Returns undefined whenever the full Python runtime should decide the case. */
export function tryRunFastPythonFunction(source: string, target: ProgramTarget, testCase: ProgramCase): EngineResult | undefined {
  if (target.language !== 'python') return undefined;
  if (target.harness.kind !== 'call' || testCase.maxSteps < 100) return tryRunPythonProgram(source, target, testCase);
  const match = /^def ([A-Za-z_]\w*)\(([^()]*)\)(?:\s*->\s*[A-Za-z_][\w\[\], ]*)?\s*:\r?\n[ \t]+return ([^\r\n]+)\s*$/.exec(source);
  if (!match || match[1] !== target.harness.function) return tryRunPythonProgram(source, target, testCase);
  const declarations = match[2].trim() ? match[2].split(',') : [];
  const names: string[] = [];
  for (const declaration of declarations) {
    const param = /^\s*([A-Za-z_]\w*)(?:\s*:\s*[A-Za-z_][\w\[\] ]*)?\s*$/.exec(declaration);
    if (!param || names.includes(param[1])) return tryRunPythonProgram(source, target, testCase);
    names.push(param[1]);
  }
  const args = testCase.args ?? [];
  if (args.length !== names.length) return tryRunPythonProgram(source, target, testCase);
  const variables = Object.fromEntries(names.map((name, index) => [name, args[index]]));
  const result = evaluatePythonExpression(match[3], variables, Math.min(testCase.maxSteps, 10_000));
  if (result.kind !== 'ok' || result.steps * 10 > testCase.maxSteps || !isJsonValue(result.value)) return tryRunPythonProgram(source, target, testCase);
  try {
    const observation = { returnValue: result.value, argsAfter: args, stdout: '' };
    JSON.stringify(observation);
    return { kind: 'ok', observation, steps: result.steps * 10 };
  } catch {
    return tryRunPythonProgram(source, target, testCase);
  }
}
