import { describe, expect, it } from 'vitest';
import juniorRaw from './2011-junior.json';
import seniorRaw from './2011-senior.json';
import { gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

const junior = validatePaper(juniorRaw);
const senior = validatePaper(seniorRaw);
const question = (paper: typeof junior, id: string) => paper.questions.find(item => item.id === id)!;
const editorAnswer = (target: string) => [...target].map((letter,index)=>`${index?'r':''}m${letter}`).join('');

describe('2011 Section B', () => {
  it('keeps shared source code and separately labeled grouped blanks', () => {
    for (const paper of [junior, senior]) {
      expect(paper.paper.season).toBe('2011');
      expect(paper.questions).toHaveLength(10);
      expect(paper.questions.every(item => item.printedRef.includes('Section B, Question'))).toBe(true);
      expect(question(paper,'A').contextId).toBe(question(paper,'B').contextId);
    }
    expect(question(junior,'I').contextId).toBe('q7-fraction');
    expect(junior.contexts?.find(item=>item.id==='q7-fraction')?.displayCode?.c).toContain('int a = _____;');
    expect(question(senior,'F').blanks.map(blank=>blank.id)).toEqual(['F1','F2']);
    expect(question(senior,'I').blanks.map(blank=>blank.id)).toEqual(['I1','I2']);
    expect(question(junior,'D').figure?.kind).toBe('paper-image');
    expect(question(junior,'J').figure?.kind).toBe('paper-image');
  });

  it('grades Junior constructive and C program answers', async () => {
    const answers: Record<string,string> = {
      A:editorAnswer('AGAGAGAGAGAG'), B:editorAnswer('ABCCCCCCABCCCCCA'), C:'mid=(left+right+1)/2', D:'0,1,2,6,9', E:'0,1,2,6,10,13',
      F:'9', G:'2*x<n && 2*z<n', H:'cnt==2 && i>1', I:'5 4', J:'14'
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(junior,id),{[id]:answer},'c');
      expect(result.status,`${id}: ${result.cases.find(item=>item.status!=='pass')?.message ?? result.message}`).toBe('pass');
    }
    expect((await gradeQuestion(question(junior,'D'),{D:'0,1,4,7,9'},'c')).status).toBe('pass');
    expect((await gradeQuestion(question(junior,'F'),{F:'7'},'c')).status).toBe('fail');
  }, 240_000);

  it('grades Senior grouped code blanks and mathematical counterexamples', async () => {
    const answers: Record<string,Record<string,string>> = {
      A:{A:editorAnswer('AGAGAGAGAGAG')}, B:{B:editorAnswer('YYYYYYXYX')}, C:{C:'mid=(left+right+1)/2'},
      D:{D:'0,1,2,6,9'}, E:{E:'0,1,2,6,10,13'},
      F:{F1:'A[j]==i',F2:'vis[j]=1'}, G:{G:'9'}, H:{H:'5 5 1 2 3'},
      I:{I1:'a%100>9',I2:'a/100*10'}, J:{J:'750'}
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(senior,id),answer,'c');
      expect(result.status,`${id}: ${result.cases.find(item=>item.status!=='pass')?.message ?? result.message}`).toBe('pass');
    }
    expect((await gradeQuestion(question(senior,'H'),{H:'1 2 3 4 5'},'c')).status).toBe('fail');
    expect((await gradeQuestion(question(senior,'F'),{F1:'A[j]=i',F2:'vis[j]=1'},'c')).status).toBe('fail');
  }, 240_000);
});
