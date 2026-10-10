import { describe, expect, it } from 'vitest';
import type { Question } from '../core/types';
import { generateCandidates } from './candidates';

function question(source: string, id = 'A'): Question {
  return {
    blanks: [{ id }],
    grading: { kind: 'program', targets: [{ language: 'cpp', source,
      harness: { kind: 'call', function: 'f' } }], cases: [] }
  } as unknown as Question;
}

function firstCandidates(item: Question, count: number): string[] {
  const first: string[] = [];
  for (const value of generateCandidates(item, 'A', 'cpp', 'hybrid')) {
    first.push(value);
    if (first.length >= count) break;
  }
  return first;
}

describe('source-aware candidate ordering', () => {
  it('reaches a nearby pointer variable before unrelated code identifiers', () => {
    const unrelated = Array.from({ length: 25 }, (_, i) => `int unused${i}=0;`).join('');
    const source = `${unrelated} int f(){Node *src,*dst;src->next={{A}};return 0;}`;
    const first = firstCandidates(question(source), 50);
    expect(first).toContain('dst');
  });

  it('reaches a syntax-shaped continuation of a printed loop bound', () => {
    const source = 'int f(int n){int i;for(i=0;i<n{{A}};i++){}return i;}';
    const first = firstCandidates(question(source), 50);
    expect(first).toContain('/2');
  });
});
