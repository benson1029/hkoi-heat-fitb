/// <reference lib="webworker" />
import { solveRequest } from './solve';
import type { WorkerRequest, WorkerResponse } from './types';

const cancelled = new Set<number>();
const send = (message: WorkerResponse) => self.postMessage(message);

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') { cancelled.add(message.id); return; }
  const { id, request } = message;
  void solveRequest(request, progress => send({ type: 'progress', id, progress }), () => cancelled.has(id))
    .then(result => send({ type: 'result', id, result }))
    .catch(error => send({ type: 'result', id, result: {
      status: 'error', message: error instanceof Error ? error.message : String(error),
      tested: 0, generated: 0, found: [], elapsedMs: 0
    } }))
    .finally(() => cancelled.delete(id));
};
