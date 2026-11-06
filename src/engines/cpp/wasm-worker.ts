import { createCompiler, type Compiler } from '@live-codes/clang-wasm';
import type { EngineResult, ProgramCase, ProgramTarget } from '../../core/types';
import { buildWasmSource, readWasmObservation } from './wasm-harness';

let compiler: Compiler | undefined;
let baseUrl = '';
// The compiler's memory probe references this constructor even on browsers
// that do not expose shared memory; normal compilation never allocates one.
if (typeof SharedArrayBuffer === 'undefined') (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer = class {};

async function run(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
  if (target.language !== 'cpp') return { kind: 'unsupported', message: 'Clang WebAssembly mode supports C++ targets.' };
  try {
    compiler ??= await createCompiler('cpp', { baseUrl: new URL(baseUrl), std: 'gnu++17' });
    const fullSource = buildWasmSource(source, target, testCase);
    const result = await compiler.run(fullSource, testCase.stdin ?? '');
    if (result.exitCode === null) return { kind: 'compile-error', message: result.errors.join('\n') || 'C++ compilation failed' };
    if (result.exitCode !== 0) return { kind: 'runtime-error', message: result.stderr || `C++ program exited with code ${result.exitCode}` };
    return { kind: 'ok', observation: readWasmObservation(result.stdout, result.stderr, target), steps: 0 };
  } catch (error) {
    return { kind: 'internal-error', message: error instanceof Error ? error.message : String(error) };
  }
}

self.onmessage = async (event: MessageEvent<{
  id: number; baseUrl: string; source: string; target: ProgramTarget; testCase: ProgramCase;
}>) => {
  const { id, source, target, testCase } = event.data;
  baseUrl = event.data.baseUrl;
  const result = await run(source, target, testCase);
  self.postMessage({ id, result });
};
