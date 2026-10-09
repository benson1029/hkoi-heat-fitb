import type { EngineResult, JsonValue, ProgramCase, ProgramTarget } from '../../core/types';
import { evaluatePythonExpression, PythonDict, PythonSet, PythonTuple } from './expression';
import { tryRunPythonProgram } from './program';

function isJsonValue(value: unknown): value is JsonValue {
  if (value instanceof PythonTuple) return false;
  if (value instanceof PythonDict || value instanceof PythonSet) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value === 'object' && value && !('builtin' in value)) return Object.values(value).every(isJsonValue);
  return false;
}

function normalizeTuple(value: unknown): unknown {
  if (value instanceof PythonTuple) return value.values.map(normalizeTuple);
  if (value instanceof PythonSet) return value;
  if (value instanceof PythonDict) {
    const entries = value.keys().map((key) => {
      if (key instanceof PythonTuple) throw new Error('JSON cannot encode tuple dictionary keys');
      const label = key === null ? 'null' : key === true ? 'true' : key === false ? 'false' : String(key);
      return [label, normalizeTuple(value.get(key).value)] as const;
    });
    return Object.fromEntries(entries);
  }
  if (Array.isArray(value)) return value.map(normalizeTuple);
  if (value && typeof value === 'object' && !('builtin' in value))
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeTuple(item)]));
  return value;
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
  const hasObjectArg = (value: unknown): boolean => Array.isArray(value) ? value.some(hasObjectArg) : value !== null && typeof value === 'object';
  if (args.some(hasObjectArg)) return tryRunPythonProgram(source, target, testCase);
  if (args.length !== names.length) return tryRunPythonProgram(source, target, testCase);
  const variables = Object.fromEntries(names.map((name, index) => [name, args[index]]));
  const result = evaluatePythonExpression(match[3], variables, Math.min(testCase.maxSteps, 10_000));
  if (result.kind !== 'ok' || result.steps * 10 > testCase.maxSteps) return tryRunPythonProgram(source, target, testCase);
  try {
    const returned = normalizeTuple(result.value);
    if (!isJsonValue(returned)) return tryRunPythonProgram(source, target, testCase);
    const observation = { returnValue: returned, argsAfter: args, stdout: '' };
    JSON.stringify(observation);
    return { kind: 'ok', observation, steps: result.steps * 10 };
  } catch {
    return tryRunPythonProgram(source, target, testCase);
  }
}
