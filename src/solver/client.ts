import type { SolveProgress, SolveRequest, SolveResult, WorkerResponse } from './types';

export interface SolverJob {
  done: Promise<SolveResult>;
  cancel(): void;
}

/** One disposable worker per search keeps cancellation immediate, even during a slow interpreter call. */
export function startSolver(request: SolveRequest, onProgress?: (progress: SolveProgress) => void): SolverJob {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const id = 1;
  let resolveResult!: (result: SolveResult) => void;
  let finished = false;
  let latest: SolveProgress = { tested: 0, generated: 0, found: [], elapsedMs: 0 };
  const done = new Promise<SolveResult>(resolve => { resolveResult = resolve; });
  const finish = (result: SolveResult) => {
    if (finished) return;
    finished = true;
    worker.terminate();
    resolveResult(result);
  };
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.id !== id) return;
    if (message.type === 'progress') { latest = message.progress; onProgress?.(latest); }
    else finish(message.result);
  };
  worker.onerror = event => finish({ ...latest, status: 'error', message: event.message });
  worker.postMessage({ type: 'start', id, request });
  return {
    done,
    cancel() {
      if (finished) return;
      worker.postMessage({ type: 'cancel', id });
      finish({ ...latest, status: 'cancelled' });
    }
  };
}
