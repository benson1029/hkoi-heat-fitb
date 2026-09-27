// Deliberately a classic worker: Pyodide 0.23 loads its asm.js runtime with importScripts.
// No imports here, so Vite can serve it as a classic worker in development and production.
let pyodide = null;
let queue = Promise.resolve();
const encoder = new TextEncoder();

async function handle(message) {
  if (message.type === 'init') {
    try {
      importScripts(`${message.indexURL}pyodide.js`);
      pyodide = await loadPyodide({ indexURL: message.indexURL });
      postMessage({ type: 'ready' });
    } catch (error) {
      postMessage({ type: 'init-error', message: error instanceof Error ? error.message : 'Could not initialize Python' });
    }
    return;
  }
  if (message.type !== 'run') return;
  let result;
  if (!pyodide) {
    result = { kind: 'internal-error', message: 'Python worker was not initialized' };
  } else if (message.target.language !== 'python') {
    result = { kind: 'unsupported', message: 'This engine supports Python only' };
  } else if (encoder.encode(message.source).length > 200000) {
    result = { kind: 'unsupported', message: 'Source byte limit exceeded' };
  } else if (encoder.encode(message.testCase.stdin || '').length > 100000) {
    result = { kind: 'unsupported', message: 'Input byte limit exceeded' };
  } else if (message.testCase.maxSteps < 1 || message.testCase.maxSteps > 50000) {
    result = { kind: 'unsupported', message: 'Invalid Python step budget' };
  } else {
    try {
      const payload = JSON.stringify({
        source: message.source,
        target: { harness: message.target.harness },
        testCase: { args: message.testCase.args || [], stdin: message.testCase.stdin || '', maxSteps: message.testCase.maxSteps },
      });
      if (encoder.encode(payload).length > 400000) {
        result = { kind: 'unsupported', message: 'Case payload limit exceeded' };
      } else {
        pyodide.globals.set('__hkoi_payload', payload);
        const raw = await pyodide.runPythonAsync(message.harness);
        result = typeof raw === 'string' ? JSON.parse(raw) : { kind: 'internal-error', message: 'Python harness returned a non-string result' };
      }
    } catch (error) {
      result = { kind: 'internal-error', message: error instanceof Error ? error.message : 'Python runtime failed' };
    } finally {
      pyodide.globals.delete('__hkoi_payload');
    }
  }
  postMessage({ type: 'result', id: message.id, result });
}

self.onmessage = (event) => {
  queue = queue.then(() => handle(event.data)).catch((error) => {
    if (event.data.type === 'run') {
      postMessage({ type: 'result', id: event.data.id, result: { kind: 'internal-error', message: error instanceof Error ? error.message : 'Python worker failed' } });
    }
  });
};
