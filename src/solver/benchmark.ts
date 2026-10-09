import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Language, PaperConfig, Question } from '../core/types';
import { validatePaper } from '../core/validate';
import { solveRequest } from './solve';

type Row = {
  paper: string;
  season: string;
  division: string;
  question: string;
  printedRef: string;
  kind: string;
  blanks: number;
  language?: Language;
  searched: string;
  fixturePassing: boolean;
  status: string;
  tested: number;
  generated: number;
  elapsedMs: number;
  answer?: Record<string, string>;
};

function option(flag: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const maxCandidates = positive(option('--max-candidates'), 250);
const maxMs = positive(option('--max-ms'), 500);
const programStrategy = option('--program-strategy') === 'deep' ? 'deep' : 'hybrid';
const outputPath = option('--out');
const onlyKind = option('--kind');
const onlyPaper = option('--paper');
const failedFrom = option('--failed-from');
const sampleMod = positive(option('--sample-mod'), 1);
const sampleIndex = Number(option('--sample-index', '0'));
const papersDirectory = resolve('papers');
const rows: Row[] = [];
const priorFailureKeys = failedFrom ? new Set((JSON.parse(await readFile(resolve(failedFrom), 'utf8')).rows as Row[])
  .filter(row => !row.fixturePassing).map(row => `${row.paper}:${row.question}`)) : undefined;

function sampled(key: string): boolean {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % sampleMod === sampleIndex;
}

function languages(question: Question): Language[] {
  if (question.grading.kind !== 'program') return [];
  const available = new Set(question.grading.targets.map(target => target.language));
  return (['cpp', 'c', 'python'] as Language[]).filter(language => available.has(language));
}

function summary() {
  const totals = { questions: rows.length, fixturePassing: rows.filter(row => row.fixturePassing).length };
  const group = (key: (row: Row) => string) => {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row]);
    return [...grouped].map(([name, items]) => ({ name, total: items.length,
      fixturePassing: items.filter(item => item.fixturePassing).length }));
  };
  const byKind = group(row => row.kind).map(({ name, ...counts }) => ({ kind: name, ...counts }))
    .sort((a, b) => b.total - a.total);
  const bySeason = group(row => row.season).map(({ name, ...counts }) => ({ season: name, ...counts }))
    .sort((a, b) => a.season.localeCompare(b.season));
  return { options: { maxCandidates, maxMs, programStrategy, onlyKind, onlyPaper,
    failedFrom, sampleMod, sampleIndex }, totals, byKind, bySeason, rows };
}

async function save() {
  if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(summary(), null, 2)}\n`);
}

async function search(question: Question, paper: PaperConfig): Promise<Row> {
  const base: Row = {
    paper: paper.paper.id, season: paper.paper.season, division: paper.paper.division,
    question: question.id, printedRef: question.printedRef, kind: question.grading.kind,
    blanks: question.blanks.length, searched: '', fixturePassing: false, status: 'unsupported',
    tested: 0, generated: 0, elapsedMs: 0
  };
  const targets = languages(question);
  const attempts: (Language | undefined)[] = targets.length ? targets : [undefined];
  const started = performance.now();
  for (const language of attempts) {
    const budgetLeft = Math.max(50, maxMs - (performance.now() - started));
    const blankIds = question.blanks.map(blank => blank.id);
    const strategy = question.grading.kind === 'program' ? programStrategy : 'exhaustive';
    const result = await solveRequest({ question, blankId: blankIds.length === 1 ? blankIds[0] : undefined,
      blankIds: blankIds.length > 1 ? blankIds : undefined, language, strategy,
      maxCandidates, maxMs: Math.ceil(budgetLeft), maxResults: 1 }, undefined,
    () => performance.now() - started >= maxMs);
    base.language = language;
    base.searched = strategy;
    base.status = result.status;
    base.tested += result.tested;
    base.generated += result.generated;
    base.elapsedMs = Math.round(performance.now() - started);
    const assignment = result.assignments?.[0] ?? (result.found[0] && blankIds.length === 1 ? { [blankIds[0]]: result.found[0] } : undefined);
    if (assignment) { base.fixturePassing = true; base.answer = assignment; break; }
    if (base.elapsedMs >= maxMs) break;
  }
  return base;
}

for (const name of (await readdir(papersDirectory)).filter(name => name.endsWith('.json')).sort()) {
  if (onlyPaper && !name.includes(onlyPaper)) continue;
  const paper = validatePaper(JSON.parse(await readFile(resolve(papersDirectory, name), 'utf8')));
  for (const question of paper.questions) {
    if (question.grading.kind === 'cancelled' || question.grading.kind === 'pending') continue;
    if (onlyKind && question.grading.kind !== onlyKind) continue;
    const key = `${paper.paper.id}:${question.id}`;
    if (priorFailureKeys && !priorFailureKeys.has(key)) continue;
    if (!sampled(key)) continue;
    rows.push(await search(question, paper));
  }
  await save();
  const passed = rows.filter(row => row.fixturePassing).length;
  process.stderr.write(`${name}: ${passed}/${rows.length} fixture-passing\n`);
}

await save();
const result = summary();
process.stdout.write(`${JSON.stringify({ options: result.options, totals: result.totals,
  byKind: result.byKind, bySeason: result.bySeason }, null, 2)}\n`);
