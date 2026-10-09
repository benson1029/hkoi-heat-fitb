import type { EngineResult, ProgramCase, ProgramEngine, ProgramTarget } from '../../core/types';
import { preparePythonPayload } from './runner';
import { PYTHON_HARNESS } from './harness';
import { tryRunFastPythonFunction } from './fast-function';

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'init-error'; message: string }
  | { type: 'result'; id: number; result: EngineResult };

const CASE_TIMEOUT_MS = 5_000;
const INIT_TIMEOUT_MS = 45_000;
const CUSTOM_ONLY_MESSAGE = 'This Python feature is outside the built-in runtime. Enable Pyodide fallback to check it.';

class BrowserPythonEngine implements ProgramEngine {
  constructor(private readonly allowFallback: boolean) {}
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 0;
  private queue: Promise<unknown> = Promise.resolve();

  private startWorker(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL('./browser-worker.js', import.meta.url), { type: 'classic' });
      this.worker = worker;
      const timer = setTimeout(() => {
        this.reset();
        reject(new Error('Python runtime initialization timed out'));
      }, INIT_TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') {
          clearTimeout(timer);
          resolve();
        } else if (event.data.type === 'init-error') {
          clearTimeout(timer);
          this.reset();
          reject(new Error(event.data.message));
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        this.reset();
        reject(new Error(event.message || 'Python worker failed to load'));
      };
      const indexURL = new URL(`${import.meta.env.BASE_URL}pyodide/`, globalThis.location.href).href;
      worker.postMessage({ type: 'init', indexURL });
    });
    return this.ready;
  }

  private reset(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }

  private async runOne(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    try {
      await this.startWorker();
    } catch (error) {
      return { kind: 'internal-error', message: error instanceof Error ? error.message : 'Python runtime unavailable' };
    }
    const worker = this.worker;
    if (!worker) return { kind: 'internal-error', message: 'Python worker unavailable' };
    return new Promise<EngineResult>((resolve) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.reset();
        resolve({ kind: 'wall-timeout', message: `Python case exceeded ${CASE_TIMEOUT_MS} ms` });
      }, CASE_TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'result' && event.data.id === id) {
          clearTimeout(timer);
          resolve(event.data.result);
        }
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        this.reset();
        resolve({ kind: 'internal-error', message: event.message || 'Python worker failed' });
      };
      worker.postMessage({ type: 'run', id, source, target, testCase, harness: PYTHON_HARNESS });
    });
  }

  run(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    const prepared = preparePythonPayload(source, target, testCase);
    if ('error' in prepared) return Promise.resolve(prepared.error);
    const fast = tryRunFastPythonFunction(source, target, testCase);
    if (fast?.kind === 'ok') return Promise.resolve(fast);
    if (!this.allowFallback) return Promise.resolve(fast ?? { kind: 'unsupported', message: CUSTOM_ONLY_MESSAGE });
    const task = this.queue.then(() => this.runOne(source, target, testCase));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}

class NodePythonEngine implements ProgramEngine {
  constructor(private readonly allowFallback: boolean) {}
  private worker: import('node:worker_threads').Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 0;
  private queue: Promise<unknown> = Promise.resolve();

  private reset(): void {
    void this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }

  private startWorker(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { Worker: NodeWorker } = await import('node:worker_threads');
      const worker = new NodeWorker(new URL('./node-worker.mjs', import.meta.url));
      this.worker = worker;
      worker.on('error', () => { if (this.worker === worker) this.reset(); });
      worker.on('exit', () => { if (this.worker === worker) { this.worker = null; this.ready = null; } });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); this.reset(); reject(new Error('Python runtime initialization timed out')); }, INIT_TIMEOUT_MS);
        const onMessage = (message: WorkerResponse) => {
          if (message.type === 'ready') { cleanup(); resolve(); }
          else if (message.type === 'init-error') { cleanup(); this.reset(); reject(new Error(message.message)); }
        };
        const onError = (error: Error) => { cleanup(); this.reset(); reject(error); };
        const onExit = (code: number) => { cleanup(); reject(new Error(`Python worker exited during initialization (${code})`)); };
        const cleanup = () => {
          clearTimeout(timer);
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
        };
        worker.on('message', onMessage);
        worker.once('error', onError);
        worker.once('exit', onExit);
        worker.postMessage({ type: 'init' });
      });
    })();
    return this.ready;
  }

  private async runOne(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    const prepared = preparePythonPayload(source, target, testCase);
    if ('error' in prepared) return prepared.error;
    try {
      await this.startWorker();
    } catch (error) {
      return { kind: 'internal-error', message: error instanceof Error ? error.message : 'Python runtime unavailable' };
    }
    const worker = this.worker;
    if (!worker) return { kind: 'internal-error', message: 'Python worker unavailable' };
    worker.ref();
    return new Promise<EngineResult>((resolve) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        cleanup();
        this.reset();
        resolve({ kind: 'wall-timeout', message: `Python case exceeded ${CASE_TIMEOUT_MS} ms` });
      }, CASE_TIMEOUT_MS);
      const onMessage = (message: WorkerResponse) => {
        if (message.type !== 'result' || message.id !== id) return;
        cleanup();
        worker.unref();
        resolve(message.result);
      };
      const onError = (error: Error) => {
        cleanup();
        this.reset();
        resolve({ kind: 'internal-error', message: error.message || 'Python worker failed' });
      };
      const onExit = (code: number) => {
        cleanup();
        resolve({ kind: 'internal-error', message: `Python worker exited during case (${code})` });
      };
      const cleanup = () => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);
      };
      worker.on('message', onMessage);
      worker.once('error', onError);
      worker.once('exit', onExit);
      worker.postMessage({ type: 'run', id, payload: prepared.payload, harness: PYTHON_HARNESS });
    });
  }

  run(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> {
    const prepared = preparePythonPayload(source, target, testCase);
    if ('error' in prepared) return Promise.resolve(prepared.error);
    const fast = tryRunFastPythonFunction(source, target, testCase);
    if (fast?.kind === 'ok') return Promise.resolve(fast);
    if (!this.allowFallback) return Promise.resolve(fast ?? { kind: 'unsupported', message: CUSTOM_ONLY_MESSAGE });
    const task = this.queue.then(() => this.runOne(source, target, testCase));
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}

export function createPythonEngine(allowFallback = false): ProgramEngine {
  return typeof Worker !== 'undefined' && typeof globalThis.location !== 'undefined'
    ? new BrowserPythonEngine(allowFallback)
    : new NodePythonEngine(allowFallback);
}

export const pythonEngine = createPythonEngine();
export const pythonEngineWithFallback = createPythonEngine(true);
