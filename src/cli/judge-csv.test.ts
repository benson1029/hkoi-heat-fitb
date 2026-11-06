import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { parseCsv } from './csv';

const execFileAsync = promisify(execFile);

it('grades a CSV with the offline WebAssembly Clang option', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hkoi-clang-cli-'));
  try {
    const paperPath = join(directory, 'synthetic.json');
    const inputPath = join(directory, 'answers.csv');
    const outputPath = join(directory, 'scores.csv');
    await writeFile(paperPath, JSON.stringify({
      schemaVersion: 1,
      paper: { id: 'synthetic', season: 'test', division: 'junior' },
      tracks: [{ id: 'cpp', label: 'C++', selection: 'required' }],
      questions: [{
        id: 'count', track: 'cpp', printedRef: 'Synthetic blank A', title: 'Synthetic blank A',
        prompt: { en: 'Complete the function.' }, points: 1,
        blanks: [{ id: 'A', maxChars: 5 }],
        grading: {
          kind: 'program', targetPolicy: 'all',
          targets: [{ language: 'cpp', source: 'int count_bits(int x) { return __builtin_popcount({{A}}); }',
            harness: { kind: 'call', function: 'count_bits' } }],
          cases: [{ id: 'five', args: [5], expected: { returnValue: 2 }, maxSteps: 100 }]
        }
      }]
    }), 'utf8');
    await writeFile(inputPath, 'id,count.A\ncase-1,x\n', 'utf8');
    await execFileAsync(process.execPath, [
      '--import', 'tsx', 'src/cli/judge-csv.ts', '--paper', paperPath,
      '--input', inputPath, '--output', outputPath, '--cpp-runtime', 'wasm'
    ], { cwd: new URL('../../', import.meta.url), timeout: 120_000 });
    const rows = parseCsv(await readFile(outputPath, 'utf8'));
    expect(rows[1][rows[0].indexOf('status.count')]).toBe('pass');
    expect(rows[1][rows[0].indexOf('score.total')]).toBe('1');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
