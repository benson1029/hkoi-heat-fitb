import { describe, expect, it } from 'vitest';
import juniorRaw from './2010-junior.json';
import seniorRaw from './2010-senior.json';
import { gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

const junior = validatePaper(juniorRaw);
const senior = validatePaper(seniorRaw);
const question = (paper: typeof junior, id: string) => paper.questions.find(item => item.id === id)!;

describe('2010 Section B', () => {
  it('has year-only identities, printed references, and one shared RPG statement per division', () => {
    for (const paper of [junior, senior]) {
      expect(paper.paper.season).toBe('2010');
      expect(paper.questions.filter(item => item.contextId === 'q5-rpg')).toHaveLength(2);
      expect(paper.contexts?.find(item => item.id === 'q5-rpg')?.markdown).toContain('A Regular Polygon Graph');
      expect(paper.questions.find(item => item.id === 'G')?.prompt.en).toBe('Write down a RPG with 13 edges which has the maximum number of vertices.');
      expect(paper.questions.every(item => item.printedRef.includes('Section B, Question'))).toBe(true);
    }
    expect(junior.questions).toHaveLength(8);
    expect(senior.questions).toHaveLength(10);
    expect(question(senior,'C').contextId).toBe(question(senior,'D').contextId);
  });

  it('grades Junior Boolean and C program blanks', async () => {
    const answers: Record<string,string> = {
      A:'FTT', B:'b OR (a XNOR b)', C:'T[i]!=i', D:'i=T[i]', E:'i+j/3', F:'(j+2)%5',
      G:'465', H:'4444'
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(junior,id),{[id]:answer},'c');
      expect(result.status,`${id}: ${result.cases.find(item=>item.status!=='pass')?.message ?? result.message}`).toBe('pass');
    }
    expect((await gradeQuestion(question(junior,'D'),{D:'i=i+1'},'c')).status).toBe('fail');
  }, 240_000);

  it('grades Senior shared sort blanks independently and the remaining C blanks', async () => {
    const answers: Record<string,string> = {
      A:'FTFF', B:'b OR (a XNOR b)', C:'&b,&d', D:'&c,&d,&e',
      E:'20*b-100*a+11', F:'131197531', G:'465', H:'5443', I:'5-i+2*j', J:'23314412314412'
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(senior,id),{[id]:answer},'c');
      expect(result.status,`${id}: ${result.cases.find(item=>item.status!=='pass')?.message ?? result.message}`).toBe('pass');
    }
    expect((await gradeQuestion(question(senior,'C'),{C:'&b,&c'},'c')).status).toBe('fail');
    expect((await gradeQuestion(question(senior,'D'),{D:'&c,&e,&f'},'c')).status).toBe('fail');
    expect((await gradeQuestion(question(senior,'H'),{H:'4444'},'c')).status).toBe('fail');
  }, 240_000);
});
