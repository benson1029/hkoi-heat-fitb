import type { EngineResult, ProgramCase, ProgramEngine, ProgramTarget } from '../../core/types';

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
      }, 90_000);
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

export const cppEngineWasm: ProgramEngine = new BrowserWasmCppEngine();
