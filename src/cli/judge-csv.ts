import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gradePaper } from '../core/grader';
import type { PaperAnswers, PaperConfig } from '../core/types';
import { validatePaper } from '../core/validate';
import { parseCsv, writeCsv } from './csv';

function options(args: string[]): Record<string, string> {
  if (args.length >= 3 && !args[0].startsWith('--')) {
    const [paper, input, output, ...tracks] = args;
    return { paper, input, output, ...(tracks.length ? { tracks: tracks.join(',') } : {}) };
  }
  const parsed: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error('Usage: npm run judge:csv -- PAPER INPUT OUTPUT [TRACK ...]');
    parsed[args[i].slice(2)] = args[i + 1];
  }
  for (const key of ['paper', 'input', 'output']) if (!parsed[key]) throw new Error(`Missing --${key}`);
  return parsed;
}

function defaultTracks(paper: PaperConfig): string[] {
  const selected = paper.tracks.filter(track => track.selection === 'required').map(track => track.id);
  const groups = new Set<string>();
  for (const track of paper.tracks) if (track.choiceGroup && !groups.has(track.choiceGroup)) {
    selected.push(track.id);
    groups.add(track.choiceGroup);
  }
  return selected;
}

const args = options(process.argv.slice(2));
if (args['python-fallback'] && !['true', 'false'].includes(args['python-fallback'])) {
  throw new Error('--python-fallback must be true or false');
}
if (args['python-runtime'] && !['custom', 'pyodide'].includes(args['python-runtime'])) {
  throw new Error('--python-runtime must be custom or pyodide');
}
const pythonRuntime = (args['python-runtime'] ?? (args['python-fallback'] === 'true' ? 'pyodide' : 'custom')) as 'custom' | 'pyodide';
const paper = validatePaper(JSON.parse(await readFile(resolve(args.paper), 'utf8')));
const input = parseCsv(await readFile(resolve(args.input), 'utf8'));
if (input.length < 2) throw new Error('Input CSV needs a header and at least one submission');
const header = input[0];
if (new Set(header).size !== header.length) throw new Error('Duplicate CSV header');
const outputHeader = [
  ...header,
  ...paper.questions.flatMap(question => [`score.${question.id}`, `status.${question.id}`]),
  'score.total', 'score.maximum', 'score.possible', 'score.complete'
];
for (const column of outputHeader.slice(header.length)) if (header.includes(column)) throw new Error(`Output column already exists: ${column}`);
const output: string[][] = [outputHeader];

for (let rowIndex = 1; rowIndex < input.length; rowIndex++) {
  const row = input[rowIndex];
  if (row.length !== header.length) throw new Error(`Row ${rowIndex + 1} has ${row.length} columns; expected ${header.length}`);
  const record = Object.fromEntries(header.map((column, index) => [column, row[index]]));
  const answers: PaperAnswers = {};
  for (const question of paper.questions) {
    answers[question.id] = {};
    for (const blank of question.blanks) answers[question.id][blank.id] = record[`${question.id}.${blank.id}`] ?? '';
  }
  const tracks = (record.tracks || args.tracks)?.split(',').map(value => value.trim()).filter(Boolean) ?? defaultTracks(paper);
  const grade = await gradePaper(paper, answers, tracks, { pythonRuntime });
  const byId = new Map(grade.questions.map(question => [question.questionId, question]));
  output.push([
    ...row,
    ...paper.questions.flatMap(question => {
      const result = byId.get(question.id);
      return [result?.score === null || result?.score === undefined ? '' : String(result.score), result?.status ?? ''];
    }),
    String(grade.scoredPoints), String(grade.scoredMaximum), String(grade.possibleMaximum), String(grade.complete)
  ]);
}
await writeFile(resolve(args.output), writeCsv(output), 'utf8');
console.log(`Judged ${output.length - 1} submissions for ${paper.paper.id}; wrote ${args.output}`);
