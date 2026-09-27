import { cp, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const source = join(process.cwd(), 'node_modules', 'pyodide');
const target = join(process.cwd(), 'public', 'pyodide');
await mkdir(target, { recursive: true });
const names = await readdir(source);
for (const name of names) {
  if (/^(pyodide(\.asm)?\.(js|mjs|wasm)|python_stdlib\.zip|repodata\.json)$/.test(name)) {
    await cp(join(source, name), join(target, name));
  }
}
