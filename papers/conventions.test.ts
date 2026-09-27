import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PaperConfig } from '../src/core/types';

const paperDir = fileURLToPath(new URL('.', import.meta.url));
const papers = readdirSync(paperDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join(paperDir, name), 'utf8')) as PaperConfig);

describe('bundled paper metadata conventions', () => {
  it('uses one Section B track before the two-paper format', () => {
    for (const paper of papers) {
      if (paper.tracks.length === 1) {
        expect(paper.tracks, paper.paper.id).toEqual([{ id: 'section-b', label: 'Section B', selection: 'required' }]);
      } else {
        expect(paper.tracks, paper.paper.id).toEqual([
          { id: 'paper1', label: 'Paper 1', selection: 'required' },
          { id: 'python', label: 'Paper 2 · Python', selection: 'choice', choiceGroup: 'paper2' },
          { id: 'cpp', label: 'Paper 2 · C++', selection: 'choice', choiceGroup: 'paper2' }
        ]);
      }
    }
  });

  it('uses one paper title and printed reference style', () => {
    const reference = /^(?:(?:Paper 1|Paper 2 \((?:Python|C\+\+)\)), )?Section [BC], Question \d+(?:\([a-z]\))?, Blanks? [A-Z][0-9]*(?:, [A-Z][0-9]*)*$/;
    for (const paper of papers) {
      const division = paper.paper.division === 'junior' ? 'Junior' : 'Senior';
      const sample = paper.paper.id.includes('sample') ? ' Sample Paper' : '';
      expect(paper.paper.season, paper.paper.id).toMatch(/^\d{4}\/\d{2}$/);
      expect(paper.paper.title, paper.paper.id).toBe(`HKOI ${paper.paper.season} Heat Event${sample} — ${division} Group FITB`);
      for (const question of paper.questions) {
        expect(question.printedRef, `${paper.paper.id}: ${question.id}`).toMatch(reference);
        expect(question.printedRef.startsWith(`${question.title}, Blank`), `${paper.paper.id}: ${question.id}`).toBe(true);
      }
    }
  });

  it('uses one cancellation message outside question prompts', () => {
    for (const paper of papers) for (const question of paper.questions) {
      if (question.grading.kind !== 'cancelled') continue;
      expect(question.points, `${paper.paper.id}: ${question.id}`).toBe(0);
      expect(question.grading.reason, `${paper.paper.id}: ${question.id}`).toBe('Cancelled by HKOI.');
      expect(question.prompt.en, `${paper.paper.id}: ${question.id}`).not.toMatch(/cancelled/i);
    }
  });
});
