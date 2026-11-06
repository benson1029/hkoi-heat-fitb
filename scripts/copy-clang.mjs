import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const source = join(root, 'node_modules', '@live-codes', 'clang-wasm', 'assets');
const target = join(root, 'public', 'clang');
await mkdir(target, { recursive: true });
await cp(join(source, 'bin'), join(target, 'bin'), { recursive: true });
await cp(join(source, 'runtime-manifest.v1.json'), join(target, 'runtime-manifest.v1.json'));
await cp(join(root, 'node_modules', '@live-codes', 'clang-wasm', 'THIRD-PARTY-NOTICES.md'), join(target, 'THIRD-PARTY-NOTICES.md'));
await cp(join(root, 'node_modules', '@live-codes', 'clang-wasm', 'LICENSE'), join(target, 'LICENSE'));
