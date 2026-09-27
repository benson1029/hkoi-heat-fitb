import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validatePaper } from '../core/validate';

const directory = resolve(process.cwd(), process.argv[2] ?? 'papers');
const names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
if (!names.length) throw new Error(`No paper JSON files in ${directory}`);
for (const name of names) {
  const paper = validatePaper(JSON.parse(await readFile(resolve(directory, name), 'utf8')));
  console.log(`${name}: ${paper.paper.id}, ${paper.questions.length} questions, ${paper.tracks.length} tracks`);
}
