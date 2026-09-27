import { expect, it } from 'vitest';
import p25raw from './2024-25-junior.json';
import p26raw from './2025-26-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradePaper } from '../src/core/grader';
import type { PaperAnswers } from '../src/core/types';

const p25 = validatePaper(p25raw);
const p26 = validatePaper(p26raw);

const a26: PaperAnswers = {
  'paper1-a': {A:'24'}, 'paper1-b': {B:'2'}, 'paper1-c': {C:'1/8'},
  'paper1-d': {D:'14'}, 'paper1-e': {E:'21'}, 'paper1-f': {F:'16'},
  'paper1-g': {G1:'10',G2:'1'}, 'paper1-h': {H1:'d',H2:'x+r'},
  'paper1-i': {I:'a+b>c'}, 'paper1-j': {J1:'k<n',J2:'k-i-1'},
  'python-a': {A:'27'}, 'python-b': {B:'78'}, 'python-c': {C:'28'},
  'python-d': {D:'is_cube(n-i*i)'}, 'python-e': {E:'"101",3'},
  'python-f': {F:'(C|D)^B'}, 'python-g': {G:'a[i]-a[i-1]'},
  'python-h': {H:'a[0]+i'}, 'python-i': {I:'a[n-1]-a[0]==n-1'},
  'python-j': {J:'x[-4:]'}, 'python-k': {K:'sorted(x)'},
  'cpp-l': {L:'18'}, 'cpp-m': {M:'21'}, 'cpp-n': {N:'7'},
  'cpp-o': {O:'x-y'}, 'cpp-p': {P:'ok&a[i]'},
  'cpp-q': {Q:"1995+e<<'/'<<e-4"},
  'cpp-r': {R:'n%2==0&&m%2==0'}, 'cpp-s': {S:'m=n;m<=k;m++'},
  'cpp-t': {T:'n/2'}, 'cpp-u': {U1:'sum%3==0',U2:'a++'},
  'cpp-v': {V:'a+=p[sum%3]'}
};

const a25: PaperAnswers = {
  'paper1-a': {A:'2026'}, 'paper1-b': {B:'hkoi2025'},
  'paper1-c': {C:'5/8'}, 'paper1-d': {D:'fhi'},
  'paper1-e': {E:'186'}, 'paper1-f': {F:'19'},
  'paper1-g': {G:'j,j+1'}, 'paper1-h': {H:'i,j'},
  'paper1-i': {I:'15'}, 'paper1-j': {J:'10'},
  'python-a': {A:'-4'}, 'python-b': {B:'82'}, 'python-c': {C:'27'},
  'python-d': {D:'a[i]!=a[i-1]'}, 'python-e': {E:'s="H"+s[1:]'},
  'python-f': {F:'0<=ni<n and 0<=nj<m'},
  'python-g': {G:'a[0]==a[-1]'}, 'python-h': {H:'a[0]'},
  'python-i': {I1:'x',I2:'1'}, 'python-j': {J:'a[x]+a[y]<=w'},
  'python-k': {K1:'l<=r',K2:'l+=1',K3:'r-=1',K4:'r-=1'},
  'cpp-l': {L:'16'}, 'cpp-m': {M:'23'}, 'cpp-n': {N:'1213121'},
  'cpp-o': {O:'break'}, 'cpp-p': {P:'a[i]>x'},
  'cpp-q': {Q:'a[n-i]>=i'},
  'cpp-r': {R1:'x==-1||a[i]>a[x]',R2:'x=i'},
  'cpp-s': {S1:'i>=k',S2:'a[FindMax(a)]',S3:'FindMax(a)'},
  'cpp-t': {T1:'len-1',T2:'i-len+1'}, 'cpp-u': {U:'(double)'}
};

for (const [paper, answers, year] of [[p25,a25,'2024/25'],[p26,a26,'2025/26']] as const) {
  for (const track of ['python','cpp'] as const) {
    it(`${year} Junior ${track} official answers pass supported graders`, async () => {
      const grade = await gradePaper(paper, answers, ['paper1',track]);
      expect(paper.questions.filter(q => q.grading.kind === 'pending')).toEqual([]);
      expect(grade.questions).toHaveLength(year === '2024/25' && track === 'cpp' ? 20 : 21);
      expect(grade.possibleMaximum).toBe(30);
      const unexpected = grade.questions.filter(q => q.status !== 'pass');
      expect(unexpected.map(q => [q.questionId,q.status,q.cases.find(c=>c.status!=='pass')?.message ?? q.message])).toEqual([]);
      expect(grade.complete).toBe(true);
    }, 120_000);
  }
}
