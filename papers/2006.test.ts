import { describe, expect, it } from 'vitest';
import juniorRaw from './2006-junior.json';
import seniorRaw from './2006-senior.json';
import { gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

const junior = validatePaper(juniorRaw);
const senior = validatePaper(seniorRaw);
const question = (division: typeof junior, id: string) => division.questions.find(item => item.id === id)!;

describe('2006 Section B', () => {
  it('uses official calendar-year identities and the printed question map', () => {
    expect(junior.paper.season).toBe('2006');
    expect(senior.paper.season).toBe('2006');
    expect(junior.questions.map(item => item.printedRef)).toEqual([
      'Section B, Question 1, Blank A', 'Section B, Question 2, Blank B',
      'Section B, Question 3, Blank C', 'Section B, Question 3, Blank D',
      'Section B, Question 4, Blank E', 'Section B, Question 5, Blank F',
      'Section B, Question 6, Blank G', 'Section B, Question 7, Blank H',
      'Section B, Question 7, Blank I', 'Section B, Question 8, Blank J'
    ]);
    expect(senior.questions.map(item => item.printedRef)).toEqual([
      'Section B, Question 1, Blank A', 'Section B, Question 2, Blank B',
      'Section B, Question 2, Blank C', 'Section B, Question 2, Blank D',
      'Section B, Question 3, Blank E', 'Section B, Question 4(a), Blank F',
      'Section B, Question 4(b), Blank G', 'Section B, Question 5(a), Blank H',
      'Section B, Question 5(b), Blank I', 'Section B, Question 5(c), Blank J'
    ]);
    expect(question(junior, 'B').displayCode).toEqual(question(senior, 'A').displayCode?.c
      ? { c: question(senior, 'A').displayCode!.c.replace('{{A}}', '{{B}}') } : undefined);
    expect(question(junior, 'C').displayCode!.c.replace('{{C}}', '{{B}}')).toBe(question(senior, 'B').displayCode!.c);
    expect(question(junior, 'D').displayCode!.c.replace('{{D}}', '{{C}}')).toBe(question(senior, 'C').displayCode!.c);
    expect(junior.contexts?.find(item => item.id === 'q7-sieve')?.displayCode?.c).toContain('{{H}}');
    expect(junior.contexts?.find(item => item.id === 'q7-sieve')?.displayCode?.c).toContain('{{I}}');
  });

  it('accepts the Junior suggested answers and semantic alternatives', async () => {
    const answers: Record<string,string> = {
      A:'x+y', B:'(n%m+m)%m', C:'-max3(-a,-b,-c)',
      D:'a+b+c-max3(a,b,c)-min3(a,b,c)', E:'F[temp]+1',
      F:'17, 6, 13, 9, 10', G:'1+a*ans', H:'j=2; j<=999/i', I:'i*j', J:'rail'
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(junior,id), { [id]: answer }, 'c');
      expect(result.status, `${id}: ${result.cases.find(item => item.status !== 'pass')?.message ?? result.message}`).toBe('pass');
    }
    expect((await gradeQuestion(question(junior,'B'),{B:'(n%m+m)%m'},'c')).status).toBe('pass');
    expect((await gradeQuestion(question(junior,'F'),{F:'6,9,10,13,14'},'c')).status).toBe('fail');
  }, 240_000);

  it('accepts Senior solutions and rejects the erroneous printed suggested reversal', async () => {
    const answers: Record<string,string> = {
      A:'(n%m+m)%m', B:'-max3(-a,-b,-c)',
      C:'a+b+c-max3(a,b,c)-min3(a,b,c)',
      D:'i+(i<5)*(9-2*i)', E:'(!(i+j&1) && j&3)',
      F:'rail', G:'computerprogrammingcomputerprogramming', H:'720', I:'360', J:'3/1,4/5,6,2'
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(senior,id), { [id]: answer }, 'c');
      expect(result.status, `${id}: ${result.cases.find(item => item.status !== 'pass')?.message ?? result.message}`).toBe('pass');
    }
    expect((await gradeQuestion(question(senior,'D'),{D:'(i%2)*(10-2*i)+i'},'c')).status).toBe('fail');
    expect((await gradeQuestion(question(senior,'J'),{J:'3/4,1/2,5,6'},'c')).status).toBe('fail');
  }, 240_000);
});
