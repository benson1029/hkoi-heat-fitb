import type { EngineResult, ProgramCase, ProgramEngine, ProgramTarget } from '../../core/types';
import { buildWasmSource, readWasmObservation } from './wasm-harness';

const CASE_TIMEOUT_MS = 90_000;

/** Browser-only, opt-in real Clang path. Each case runs off the UI thread. */
class BrowserWasmCppEngine implements ProgramEngine {
  private worker: Worker | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;

  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private runOne(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    if (typeof Worker === 'undefined' || typeof location === 'undefined')
      return Promise.resolve({ kind: 'unsupported', message: 'Clang WebAssembly mode requires a browser.' });
    this.worker ??= new Worker(new URL('./wasm-worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    const id = ++this.nextId;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.reset();
        resolve({ kind: 'wall-timeout', message: 'C++ compilation or execution exceeded 90 seconds' });
      }, CASE_TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<{ id: number; result: EngineResult }>) => {
        if (event.data.id !== id) return;
        clearTimeout(timer);
        resolve(event.data.result);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        this.reset();
        resolve({ kind: 'internal-error', message: event.message || 'Clang worker failed' });
      };
      const baseUrl = new URL(`${import.meta.env.BASE_URL}clang/`, location.href).href;
      worker.postMessage({ id, baseUrl, source, target, testCase });
    });
  }

  run(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    const task = this.queue.then(() => this.runOne(source, target, testCase));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}

class NodeWasmCppEngine implements ProgramEngine {
  private worker: import('node:worker_threads').Worker | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 0;

  private reset(): void {
    void this.worker?.terminate();
    this.worker = null;
  }

  private async runOne(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    if (target.language !== 'cpp') return { kind: 'unsupported', message: 'Clang WebAssembly mode supports C++ targets.' };
    let fullSource: string;
    try { fullSource = buildWasmSource(source, target, testCase); }
    catch (error) { return { kind: 'internal-error', message: error instanceof Error ? error.message : String(error) }; }
    const { Worker: NodeWorker } = await import('node:worker_threads');
    this.worker ??= new NodeWorker(new URL('./node-wasm-worker.mjs', import.meta.url));
    const worker = this.worker;
    worker.ref();
    const id = ++this.nextId;
    return new Promise(resolve => {
      const cleanup = () => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      const onMessage = (message: { id: number; error?: string; result?: {
        stdout: string; stderr: string; errors: string[]; exitCode: number | null;
      } }) => {
        if (message.id !== id) return;
        cleanup();
        worker.unref();
        if (message.error) return resolve({ kind: 'internal-error', message: message.error });
        const result = message.result;
        if (!result) return resolve({ kind: 'internal-error', message: 'Clang worker returned no result' });
        if (result.exitCode === null) return resolve({ kind: 'compile-error', message: result.errors.join('\n') || 'C++ compilation failed' });
        if (result.exitCode !== 0) return resolve({ kind: 'runtime-error', message: result.stderr || `C++ program exited with code ${result.exitCode}` });
        try {
          resolve({ kind: 'ok', observation: readWasmObservation(result.stdout, result.stderr, target), steps: 0 });
        } catch (error) {
          resolve({ kind: 'internal-error', message: error instanceof Error ? error.message : String(error) });
        }
      };
      const onError = (error: Error) => {
        cleanup();
        this.reset();
        resolve({ kind: 'internal-error', message: error.message || 'Clang worker failed' });
      };
      const onExit = (code: number) => {
        cleanup();
        this.worker = null;
        resolve({ kind: 'internal-error', message: `Clang worker exited during case (${code})` });
      };
      const timer = setTimeout(() => {
        cleanup();
        this.reset();
        resolve({ kind: 'wall-timeout', message: 'C++ compilation or execution exceeded 90 seconds' });
      }, CASE_TIMEOUT_MS);
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      worker.postMessage({ id, source: fullSource, stdin: testCase.stdin ?? '' });
    });
  }

  run(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    const task = this.queue.then(() => this.runOne(source, target, testCase));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}

export const cppEngineWasm: ProgramEngine = typeof Worker !== 'undefined' && typeof location !== 'undefined'
  ? new BrowserWasmCppEngine() : new NodeWasmCppEngine();
