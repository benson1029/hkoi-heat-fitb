import { parentPort } from 'node:worker_threads';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPyodide } from 'pyodide';

if (!parentPort) throw new Error('Python worker requires a parent thread');

let pyodide = null;
let queue = Promise.resolve();

async function handle(message) {
  if (message.type === 'init') {
    try {
      const modulePath = fileURLToPath(import.meta.resolve('pyodide'));
      pyodide = await loadPyodide({ indexURL: dirname(modulePath) + sep });
      parentPort.postMessage({ type: 'ready' });
    } catch (error) {
      parentPort.postMessage({ type: 'init-error', message: error instanceof Error ? error.message : 'Could not initialize Python' });
    }
    return;
  }
  if (message.type !== 'run') return;
  let result;
  if (!pyodide) {
    result = { kind: 'internal-error', message: 'Python worker was not initialized' };
  } else {
    try {
      pyodide.globals.set('__hkoi_payload', message.payload);
      const raw = await pyodide.runPythonAsync(message.harness);
      result = typeof raw === 'string' ? JSON.parse(raw) : { kind: 'internal-error', message: 'Python harness returned a non-string result' };
    } catch (error) {
      result = { kind: 'internal-error', message: error instanceof Error ? error.message : 'Python runtime failed' };
    } finally {
      pyodide.globals.delete('__hkoi_payload');
    }
  }
  parentPort.postMessage({ type: 'result', id: message.id, result });
}

parentPort.on('message', (message) => {
  queue = queue.then(() => handle(message)).catch((error) => {
    if (message.type === 'run') parentPort.postMessage({ type: 'result', id: message.id, result: { kind: 'internal-error', message: error instanceof Error ? error.message : 'Python worker failed' } });
  });
});
