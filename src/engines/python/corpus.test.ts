import { expect, it } from 'vitest';
import junior25 from '../../../papers/2024-25-junior.json';
import junior26 from '../../../papers/2025-26-junior.json';
import senior25 from '../../../papers/2024-25-senior.json';
import senior26 from '../../../papers/2025-26-senior.json';
import sample25 from '../../../papers/2024-25-sample-senior.json';
import type { Observation, PaperConfig, ProgramCase, ProgramTarget } from '../../core/types';
import { tryRunFastPythonFunction } from './fast-function';
import { supportsFastPythonSource } from './program';

const fixtures: { paper: PaperConfig; answers: Record<string, Record<string, string>> }[] = [
  { paper: junior25 as PaperConfig, answers: {
    'paper1-b': { B: 'hkoi2025' }, 'paper1-g': { G: 'j,j+1' }, 'paper1-h': { H: 'i,j' },
    'python-d': { D: 'a[i]!=a[i-1]' }, 'python-e': { E: 's="H"+s[1:]' },
    'python-f': { F: '0<=ni<n and 0<=nj<m' }, 'python-g': { G: 'a[0]==a[-1]' },
    'python-h': { H: 'a[0]' }, 'python-i': { I1: 'x', I2: '1' },
    'python-j': { J: 'a[x]+a[y]<=w' }, 'python-k': { K1: 'l<=r', K2: 'l+=1', K3: 'r-=1', K4: 'r-=1' }
  } },
  { paper: junior26 as PaperConfig, answers: {
    'paper1-d': { D: '14' }, 'paper1-g': { G1: '10', G2: '1' },
    'paper1-h': { H1: 'd', H2: 'x+r' }, 'paper1-i': { I: 'a+b>c' },
    'paper1-j': { J1: 'k<n', J2: 'k-i-1' },
    'python-d': { D: 'is_cube(n-i*i)' }, 'python-e': { E: '"101",3' },
    'python-f': { F: '(C|D)^B' }, 'python-g': { G: 'a[i]-a[i-1]' },
    'python-h': { H: 'a[0]+i' }, 'python-i': { I: 'a[n-1]-a[0]==n-1' },
    'python-j': { J: 'x[-4:]' }, 'python-k': { K: 'sorted(x)' }
  } },
  { paper: senior25 as PaperConfig, answers: {
    'paper1-d': { D: 'aaabbabb' }, 'python-d': { D: '3<=i<=5' },
    'python-e': { E: 'a[:idx]+a[idx+1:]' }, 'python-f': { F: '1-x,1-y' },
    'python-g': { G: 'm in (4,6,9,11)' }, 'python-h': { H: '(m>7)^(m%2)' },
    'python-i': { I1: 'i*2', I2: 'i*2+1' },
    'python-j': { J1: 'n//4', J2: 'l+n//4+i', J3: 'l+n//2+i' }
  } },
  { paper: sample25 as PaperConfig, answers: {
    'python-d': { D: '1,n' }, 'python-e': { E: 'x%4!=2 and y%4!=2' },
    'python-f': { F: 'f(x*2-2)' },
    'python-g': { G: 'a[i]==1 and a[j]==0 and a[k]==1' },
    'python-h': { H1: 'a[i]==0', H2: 'b[i]*(b[n-1]-b[i])' },
    'python-j': { J1: '15', J2: '51', J3: '85' }
  } },
  { paper: senior26 as PaperConfig, answers: {
    'paper1-f': { F: '(a+b+c)%3' }, 'paper1-g': { G1: '3-j', G2: 'i' },
    'paper1-h': { H1: 'i//2', H2: 'j%2*2' },
    'python-d': { D: 'a[i]=10-a[i]' }, 'python-e': { E: 'b-a-(a_m>b_m)*40' },
    'python-f': { F: '-i%4' }, 'python-g': { G: 'X[i-1]+X[i]' },
    'python-h': { H: 'A[i]*B[i]-A[i-1]*B[i-1]' },
    'python-i': { I: '(a==b)&(c==d)' }, 'python-j': { J1: 'x&y', J2: '~x&z' }
  } }
];

function expectedFor(testCase: ProgramCase): Observation {
  return testCase.expectedByLanguage?.python ?? testCase.expected;
}

it('matches the configured observations for officially filled Python paper targets', () => {
  const covered: string[] = [];
  const fallback: string[] = [];
  const mismatches: string[] = [];
  let total = 0;
  for (const { paper, answers } of fixtures) {
    for (const question of paper.questions) {
      if (question.grading.kind !== 'program') continue;
      const target = question.grading.targets.find((item) => item.language === 'python') as ProgramTarget | undefined;
      if (!target) continue;
      total++;
      const name = `${paper.paper.id}/${question.id}`;
      const fills = answers[question.id];
      if (!fills) { fallback.push(`${name}:no fixture`); continue; }
      const body = target.source.replace(/\{\{([^{}]+)\}\}/g, (_, blank: string) => fills[blank] ?? '');
      const source = target.helperSource ? `${target.helperSource}\n${body}` : body;
      const cases = question.grading.cases;
      const results = cases.map((testCase) => tryRunFastPythonFunction(source, target, testCase));
      if (results.some((result) => result?.kind !== 'ok')) { const first = results.find((result) => result?.kind !== 'ok'); fallback.push(`${name} (syntax ${supportsFastPythonSource(source, target) ? 'yes' : 'no'}, first ${first?.kind ?? 'unsupported'}${first && 'message' in first ? `: ${first.message}` : ''})`); continue; }
      covered.push(name);
      results.forEach((result, index) => {
        if (result?.kind !== 'ok') return;
        const expected = expectedFor(cases[index]);
        for (const [key, value] of Object.entries(expected)) {
          if (JSON.stringify(result.observation[key as keyof Observation]) !== JSON.stringify(value)) {
            mismatches.push(`${name}/${cases[index].id}/${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(result.observation[key as keyof Observation])}`);
          }
        }
      });
    }
  }
  expect(mismatches).toEqual([]);
  expect(total).toBeGreaterThanOrEqual(47);
  expect(covered.length, `covered ${covered.length}/${total}; fallback: ${fallback.join(', ')}`).toBe(total);
});
