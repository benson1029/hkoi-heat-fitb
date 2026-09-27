import { describe, expect, it } from 'vitest';
import raw08j from './2008-junior.json';
import raw08s from './2008-senior.json';
import raw09j from './2009-junior.json';
import raw09s from './2009-senior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

const papers = [raw08j, raw08s, raw09j, raw09s].map(validatePaper);
const find = (paper: typeof papers[number], letter: string) => paper.questions.find(q => q.id === `section-b-${letter.toLowerCase()}`)!;

describe('2008 and 2009 Heat paper transcription', () => {
  it('uses calendar-year identity, one Section B track, and the printed blank mapping', () => {
    for (const paper of papers) {
      const year = paper.paper.id.slice(0, 4);
      expect(paper.paper.season).toBe(year);
      expect(paper.tracks.map(track => track.id)).toEqual(['section-b']);
      for (const question of paper.questions) {
        expect(question.printedRef).toBe(`${question.title}, Blank ${question.blanks[0].id}`);
        expect(question.source?.paperUrl).toContain(`/${year}h`);
      }
    }
    expect(papers[0].questions.map(q => q.blanks[0].id)).toEqual('ABCDEFGHIJKL'.split(''));
    expect(papers[1].questions.map(q => q.blanks[0].id)).toEqual('ABCDEFGHIJK'.split(''));
    expect(papers[2].questions.map(q => q.blanks[0].id)).toEqual('ABCDEFGHIJ'.split(''));
    expect(papers[3].questions.map(q => q.blanks[0].id)).toEqual('ABCDEFGHIJ'.split(''));
  });

  it('keeps shared code with unresolved markers and the 2008 cancellation', () => {
    expect(papers[2].contexts?.find(c => c.id === 'q1-code')?.displayCode?.c).toContain('{{A}}');
    expect(papers[2].contexts?.find(c => c.id === 'q1-code')?.displayCode?.c).toContain('{{D}}');
    expect(papers[3].contexts?.find(c => c.id === 'q4-functions')?.displayCode?.c).toContain('{{E}}');
    expect(papers[3].contexts?.find(c => c.id === 'q4-functions')?.displayCode?.c).toContain('{{G}}');
    expect(find(papers[0], 'L').grading).toEqual({ kind: 'cancelled', reason: 'Cancelled by HKOI.' });
  });

  const official: [number, Record<string, string>][] = [
    [0, { A: '3-2*n', B: '2222002211', C: '2(4(FT)TT)', D: '4(FFT)4(FT)', E: 'n/1000+(n%1000)*1000', F: '(average*i+A[i])/(i+1)', G: 'cnt+1', H: '5-abs(3-i)', I: 'i*i!=num', J: '(11-i)%7', K: 'F[k]=F[k]+1;' }],
    [1, { A: '2(4(FT)TT)', B: '2(F3(FT))TTF', C: '^b[i]', D: '(11-i)%7', E: 'i*i!=num', F: '999-f(a)-f(b)-f(c)+f(a*b)+f(b*c)+f(a*c)-f(a*b*c)', G: '74', H: 'z=i%j', I: 'CAEDB', J: '83', K: '66' }],
    [2, { A: 'getMax(a,b,c,100)', B: 'largest!=ceiling', C: 'largest', D: 'getMax(a,b,c,ceiling)', E: '188', F: 'j>i&&isprime[i]==1&&j%i==0', G: '(id-1)%m+1', H: '(id-C)/m+1', I: 'low=mid+1', J: 'high' }],
    [3, { A: 'n/2-n/4-n/10', B: '2 3 5 1 4 6', C: '2(4(URDL)R)', D: '3(URDLURRDLL)', E: 'A(x,B(A(x,x)))', F: 'x', G: 'A(A(x,A(A(y,y),y)),B(A(x,x)))', H: '--++-', I: '+-+++++++<+--', J: '+-++++++<+++<++' }]
  ];

  for (const [paperIndex, answers] of official) {
    it(`${papers[paperIndex].paper.id} suggested C answers pass`, async () => {
      for (const [letter, value] of Object.entries(answers)) {
        const result = await gradeQuestion(find(papers[paperIndex], letter), { [letter]: value }, 'c');
        expect(result.status, `${letter}: ${result.message ?? result.cases?.find(c => c.status !== 'pass')?.message}`).toBe('pass');
      }
    }, 120_000);
  }

  it('grades 2009 Junior against stated grid semantics instead of answer-table typos', async () => {
    const wrongColumn = await gradeQuestion(find(papers[2], 'G'), { G: '(id+m-1)%(m+1)' }, 'c');
    expect(wrongColumn.status).toBe('fail');
    const wrongPrime = await gradeQuestion(find(papers[2], 'F'), { F: 'i>j&&isprime[i]==1&&j%i==0' }, 'c');
    expect(wrongPrime.status).toBe('fail');
  }, 120_000);

  it('accepts an alternate painted route and rejects the mirrored square pair', async () => {
    const alternate = await gradeQuestion(find(papers[0], 'D'), { D: '4(FT)4(FFT)' }, 'c');
    expect(alternate.status).toBe('pass');
    for (const [paper, blank] of [[papers[0], 'C'], [papers[1], 'A']] as const) {
      const mirrored = await gradeQuestion(find(paper, blank), { [blank]: '2(4(TF)TT)' }, 'c');
      expect(mirrored.status).toBe('fail');
    }
  });

  it('does not count spaces in the 2008 Senior replacement limit', async () => {
    const result = await gradeQuestion(find(papers[1], 'H'), { H: 'z    =    i    %    j' }, 'c');
    expect(result.status).toBe('pass');
  });

  it('accepts another valid graph labeling and rejects a repeated edge cost', async () => {
    const question = find(papers[3], 'B');
    expect((await gradeQuestion(question, { B: '5,4,2,6,3,1' }, 'c')).status).toBe('pass');
    expect((await gradeQuestion(question, { B: '1 2 3 4 5 6' }, 'c')).status).toBe('fail');
  });

  it('rejects wrong box stacks and river endpoints', async () => {
    for (const [letter, answer] of [
      ['C', '4(URRDLL)'],
      ['D', 'R'],
      ['H', '+++++'],
      ['I', '--++-'],
      ['J', '+-++++++<+++<+']
    ]) {
      expect((await gradeQuestion(find(papers[3], letter), { [letter]: answer }, 'c')).status, letter).toBe('fail');
    }
  });
});
