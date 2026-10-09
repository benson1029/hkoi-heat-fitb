import { describe, expect, it } from 'vitest';
import type { Language, ProgramCase, Question } from '../core/types';
import { gradeQuestion } from '../core/grader';
import { generateCandidates } from './candidates';
import { generateDeepCandidates } from './deep';
import { generateLibraryCandidates } from './libraries';

function question(language: Language, source: string, cases: ProgramCase[]): Question {
  return {
    id: 'library', track: 'paper1', printedRef: 'A', title: 'Library call', prompt: { en: 'Complete the code.' },
    points: 1, blanks: [{ id: 'B', maxChars: 60 }],
    grading: { kind: 'program', targets: [{ language, source, harness: { kind: 'call', function: 'f' } }],
      targetPolicy: 'all', cases }
  };
}

describe('source-derived library candidates', () => {
  it('finds a Python collection builtin and grades it with the fast runtime', async () => {
    const item = question('python', 'def f(a: list[int]):\n    return {{B}}', [
      { id: 'one', args: [[2, 3, 4]], expected: { returnValue: 9 }, maxSteps: 1000 },
      { id: 'empty', args: [[]], expected: { returnValue: 0 }, maxSteps: 1000 }
    ]);
    const candidates = [...generateLibraryCandidates(item, 'B', 'python', 'expression')];
    expect(candidates).toContain('sum(a)');
    expect((await gradeQuestion(item, { B: 'sum(a)' }, 'python')).status).toBe('pass');
  });

  it('finds a C++ algorithm using iterators printed by its container type', async () => {
    const item = question('cpp', 'void f(vector<int>& v){\n  {{B}}\n}', [
      { id: 'one', args: [[3, 1, 2]], expected: { argsAfter: [[1, 2, 3]] }, maxSteps: 1000 },
      { id: 'empty', args: [[]], expected: { argsAfter: [[]] }, maxSteps: 1000 }
    ]);
    const candidates = [...generateLibraryCandidates(item, 'B', 'cpp', 'statement')];
    expect(candidates).toContain('sort(v.begin(),v.end());');
    const generated: string[] = [];
    const search = generateCandidates(item, 'B', 'cpp', 'hybrid');
    for (let i = 0; i < 300; i++) {
      const next = search.next();
      if (next.done) break;
      generated.push(next.value);
    }
    expect(generated).toContain('sort(v.begin(),v.end());');
    expect((await gradeQuestion(item, { B: 'sort(v.begin(),v.end());' }, 'cpp')).status).toBe('pass');
  });

  it('separates Python word operators and excludes C++ negation', () => {
    const item = question('python', 'def f(a: int,b: int):\n    return {{B}}', []);
    const candidates = [...generateCandidates(item, 'B', 'python', 'templates')];
    expect(candidates).toContain('a and b');
    expect(candidates).toContain('a or b');
    expect(candidates).toContain('not a');
    expect(candidates).not.toContain('aandb');
    expect(candidates).not.toContain('!a');
    const generator = generateDeepCandidates(item, 'B', 'python', 'expression');
    const deep: string[] = [];
    for (let i = 0; i < 30; i++) {
      const next = generator.next();
      if (next.done) break;
      deep.push(next.value);
    }
    expect(deep.some(value => value.includes(' and ') && value.includes('a%2') && value.includes('b%2'))).toBe(true);
  });
});
