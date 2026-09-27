import { expect, it } from 'vitest';
import raw2012 from './2011-12-senior.json';
import raw2013 from './2012-13-senior.json';
import raw2014 from './2013-14-senior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

it('2011/12 Senior official numeric and code answers pass', async () => {
  const paper = validatePaper(raw2012);
  const answers: Record<string, Record<string,string>> = {
    A:{A:'m(x,y,32767)'}, B:{B:'m(x,y,32767)'},
    C:{C:'1'}, D:{D:'6'}, E:{E:'is_prime[j]&&i%j==0'}, F:{F:'32760'},
    G:{G:'((>)9v(<)9)9'}, H:{H:'(<)9(^)9((>)9v(<)9)9'},
    I:{I:'((>)9v(<)9^(<)9v)9'}, J:{J:'(<^)9((>)9v(<)9^(<)9v)9'},
    K:{K:'(<)9v(<^)9((>)9(<)9v)9(>)9^(>v)9((<)9(>)9^)9'}
  };
  for (const [id, answer] of Object.entries(answers)) {
    const q=paper.questions.find(q=>q.id===id)!;
    const result=await gradeQuestion(q,answer,'c');
    expect(result.status, `${id}: ${result.message}`).toBe('pass');
  }
},120_000);

it('2013/14 Senior official Section B answers pass, including cancellation', async () => {
  const paper=validatePaper(raw2014);
  expect(paper.questions.reduce((sum,q)=>sum+q.points,0)).toBe(18);
  const answers:Record<string,Record<string,string>>={
    A:{A:'76545336'},B:{B:'A43D'},C:{C:'x%200+200'},D:{D:'324'},E:{E:'84'},
    G:{G:'Logic'},H:{H:'59'},I:{I:'return 0;}'},J:{J:'swap(p,p+1)'},
    K:{K1:'p>0',K2:'p=p-1'},L:{L:'p=p+1'},
    M:{M:'...><...>.'},N:{N:'...<.....>'},O:{O:'..<......>'}
  };
  for (const question of paper.questions) {
    if(question.id==='F'){
      const result=await gradeQuestion(question,{},'c');
      expect(result.status).toBe('cancelled');
      continue;
    }
    const result=await gradeQuestion(question,answers[question.id],'c');
    expect(result.status,`${question.id}: ${result.cases.find(c=>c.status!=='pass')?.message??result.message}`).toBe('pass');
  }
},120_000);

it('2012/13 Senior official Section B answers pass', async () => {
  const paper=validatePaper(raw2013);
  expect(paper.questions.reduce((sum,q)=>sum+q.points,0)).toBe(26);
  const answers:Record<string,string>={A:'16',B:'108',C:'2916',D:'peek(r)',E:'s,pop(r)',
    F:'54',G:'return abs(x1-x2)+abs(y1-y2);',H:'(i+j)/2',I:'max(0,k)',J:'max(0,n-1)',
    K:'ooo/.../ooo',L:'o../.o./..o',M:'..o/.../o..'};
  for (const [id, answer] of Object.entries(answers)) {
    const q=paper.questions.find(q=>q.id===id)!;
    const result=await gradeQuestion(q,{[id]:answer},'c');
    expect(result.status,`${id}: ${result.cases.find(c=>c.status!=='pass')?.message??result.message}`).toBe('pass');
  }
},120_000);

it('older Senior partial-credit rubrics distinguish correct value and exact orientation', async () => {
  const p2012=validatePaper(raw2012);
  const f=p2012.questions.find(q=>q.id==='F')!;
  const partial=await gradeQuestion(f,{F:'32751'},'c');
  expect(partial.score).toBe(2);
  const p2013=validatePaper(raw2013);
  const k=p2013.questions.find(q=>q.id==='K')!;
  const rotated=await gradeQuestion(k,{K:'o.o/o.o/o.o'},'c');
  expect(rotated.score).toBe(1);
});
