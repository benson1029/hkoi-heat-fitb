import { describe, expect, it } from 'vitest';
import juniorRaw from './2007-junior.json';
import seniorRaw from './2007-senior.json';
import { gradePaper, gradeQuestion } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

const junior = validatePaper(juniorRaw);
const senior = validatePaper(seniorRaw);
const question = (division: typeof junior, id: string) => division.questions.find(item => item.id === id)!;

describe('2007 Section B', () => {
  it('uses calendar-year identity and correct question/blank labels in both groups', () => {
    expect(junior.paper.season).toBe('2007');
    expect(senior.paper.season).toBe('2007');
    expect(junior.questions.map(item => item.printedRef)).toEqual([
      'Section B, Question 1, Blank A','Section B, Question 1, Blank B',
      'Section B, Question 2, Blank C','Section B, Question 2, Blank D',
      'Section B, Question 3, Blank E','Section B, Question 3, Blank F',
      'Section B, Question 4, Blank G','Section B, Question 4, Blank H',
      'Section B, Question 5, Blank I','Section B, Question 5, Blank J'
    ]);
    expect(senior.questions.map(item => item.printedRef)).toEqual([
      'Section B, Question 1, Blank A','Section B, Question 1, Blank B',
      'Section B, Question 2, Blank C','Section B, Question 3, Blank D',
      'Section B, Question 4, Blank E','Section B, Question 4, Blank F',
      'Section B, Question 5(a), Blank G','Section B, Question 5(b), Blank H',
      'Section B, Question 5(c), Blank I','Section B, Question 6, Blank J'
    ]);
    expect(question(junior,'I').figure).toEqual(question(senior,'E').figure);
    expect(question(junior,'J').figure).toEqual(question(senior,'F').figure);
    for (const id of ['q1-hamming','q2-pattern','q3-expand','q4-search']) {
      expect(junior.contexts?.find(item => item.id === id)?.displayCode?.c).toBeTruthy();
    }
  });

  it('grades the Junior code blanks using nontrivial inputs', async () => {
    const answers: Record<string,string> = {
      A:'hamming[i]', B:'i*a[j]', C:'j-i<=4 && j+i>=4', D:'j>2 && j<6',
      E:'A[i]-j+1', F:'k=k+1', G:'hi=m', H:'lo=m+1', I:'6', J:'25'
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(junior,id),{[id]:answer},'c');
      expect(result.status,`${id}: ${result.cases.find(item=>item.status!=='pass')?.message ?? result.message}`).toBe('pass');
    }
    expect((await gradeQuestion(question(junior,'A'),{A:'1'},'c')).status).toBe('fail');
    expect((await gradeQuestion(question(junior,'F'),{F:'k=k+2'},'c')).status).toBe('fail');
  },240_000);

  it('grades the Senior code and numeric blanks and preserves the weighted network', async () => {
    const answers: Record<string,string> = {
      A:'return 0', B:'return hamming(n/i)', C:'i-1+(i+1)%3', D:'n/=2', E:'6', F:'25'
    };
    for (const [id, answer] of Object.entries(answers)) {
      const result = await gradeQuestion(question(senior,id),{[id]:answer},'c');
      expect(result.status,`${id}: ${result.cases.find(item=>item.status!=='pass')?.message ?? result.message}`).toBe('pass');
    }
    const route = question(senior,'G').figure;
    expect(route?.kind).toBe('undirected-graph');
    if (route?.kind === 'undirected-graph') {
      expect(route.edges).toHaveLength(13);
      expect(route.edges.find(edge => edge.from==='s' && edge.to==='f')?.label).toBe('3');
      expect(route.edges.find(edge => edge.from==='g' && edge.to==='t')?.label).toBe('6');
    }
    expect(question(senior,'J').displayCode?.c).toContain('struct man');
    expect(question(senior,'J').displayCode?.c).toContain('if ({{J}})');
    const official='A[j].height<A[j+1].height || A[j].height==A[j+1].height && A[j].weight<A[j+1].weight';
    expect((await gradeQuestion(question(senior,'J'),{J:official},'c')).status).toBe('pass');
    expect((await gradeQuestion(question(senior,'J'),{J:'A[j].height<A[j+1].height'},'c')).status).toBe('fail');
  },240_000);

  it('accepts both shortest routes and scores H against the chosen first route', async () => {
    const first = { G:{G:'s→f→g→t'}, H:{H:'s→a→c→g→t'}, I:{I:'s→f→g→e→c→a→b→d→t'} };
    const second = { G:{G:'s→a→c→d→t'}, H:{H:'s→f→g→t'}, I:{I:'s→f→g→e→c→a→b→d→t'} };
    for (const answers of [first,second]) {
      for (const id of ['G','H','I']) {
        const result = await gradeQuestion(question(senior,id),answers[id as keyof typeof answers], 'c', answers);
        expect(result.status,`${id}: ${result.message}`).toBe('pass');
      }
    }
    const repeat = {G:{G:'s→f→g→t'},H:{H:'s→f→g→t'}};
    expect((await gradeQuestion(question(senior,'H'),repeat.H,'c',repeat)).status).toBe('fail');
    const whole=await gradePaper(senior,{...first,A:{A:'return 0'},B:{B:'return hamming(n/i)'},C:{C:'i-1+(i+1)%3'},D:{D:'n/=2'},E:{E:'6'},F:{F:'25'},J:{J:'A[j].height<A[j+1].height || A[j].height==A[j+1].height && A[j].weight<A[j+1].weight'}},['section-b']);
    expect(whole.questions.find(item=>item.questionId==='H')?.status).toBe('pass');
    expect(whole.complete).toBe(true);
    expect(whole.scoredPoints).toBe(10);
  },120_000);
});
