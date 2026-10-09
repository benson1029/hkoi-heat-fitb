import { describe, expect, it } from 'vitest';
import paper from '../../papers/2004-junior.json';
import junior2017 from '../../papers/2017-18-junior.json';
import senior2023 from '../../papers/2023-24-senior.json';
import { gradeQuestion } from '../core/grader';
import type { Question } from '../core/types';
import { generateExampleCandidates } from './synthesis';

const questions = paper.questions as Question[];

describe('example-guided scalar synthesis', () => {
  for (const [id, expression] of [
    ['section-b-b', 'len-i-1'],
    ['section-b-d', '(n+m-1)/m'],
    ['section-b-f', 'i==j||8==i+j'],
    ['section-b-k', '-3*i+22'],
    ['section-b-l', '(m+2)*n'],
    ['section-b-n', 'n%i==0']
  ]) {
    it(`discovers and fully checks ${id}`, async () => {
      const question = questions.find(item => item.id === id)!;
      const blankId = question.blanks[0].id;
      const candidates = [...generateExampleCandidates(question, blankId, 'c')];
      expect(candidates).toContain(expression);
      const result = await gradeQuestion(question, { [blankId]: expression }, 'c');
      expect(result.status).toBe('pass');
    });
  }

  it('synthesizes a bitwise case toggle from a leading return function', async () => {
    const question = (junior2017.questions as Question[]).find(item => item.id === 'section-b-h')!;
    expect([...generateExampleCandidates(question, 'H', 'cpp')]).toContain('x^32');
    expect((await gradeQuestion(question, { H: 'x^32' }, 'cpp')).status).toBe('pass');
  });

  it('synthesizes a quotient offset for character classes', async () => {
    const question = (senior2023.questions as Question[]).find(item => item.id === 'cpp-a')!;
    expect([...generateExampleCandidates(question, 'A', 'cpp')]).toContain('c/32-1');
    expect((await gradeQuestion(question, { A: 'c/32-1' }, 'cpp')).status).toBe('pass');
  });
});
