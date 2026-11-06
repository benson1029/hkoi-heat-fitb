import { parentPort } from 'node:worker_threads';
import { createCompiler } from '@live-codes/clang-wasm';

let compiler;
parentPort.on('message', async ({ id, source, stdin }) => {
  try {
    compiler ??= await createCompiler('cpp', { std: 'gnu++17' });
    const result = await compiler.run(source, stdin);
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
