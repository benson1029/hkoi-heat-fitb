import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { gradePaper } from '../src/core/grader';
import { validatePaper } from '../src/core/validate';

it('preserves indentation in the Junior C programs shared with Senior', () => {
  const paper = validatePaper(JSON.parse(readFileSync(new URL('./2015-16-junior.json', import.meta.url), 'utf8')));
  const crosses = paper.contexts?.find(item => item.id === 'crosses')?.displayCode?.c;
  expect(crosses).toContain('\n    printf("They are connected");');
  expect(paper.questions.find(item => item.id === 'GH')?.displayCode?.c).toContain('\n57         l = mid + 1;');
  expect(paper.questions.find(item => item.id === 'I')?.displayCode?.c).toContain('\n            while (k % i == 0) {');
});

it('grades the 2015/16 Junior printed Section B answers', async () => {
  const paper = validatePaper(JSON.parse(readFileSync(new URL('./2015-16-junior.json', import.meta.url), 'utf8')));
  const result = await gradePaper(paper, {
    A: { A: 'printf("%.3f",sqrt(x))' },
    B: { B: 'x>1' }, C: { C: 'x%2==1' }, D: { D: 'x=x/2' },
    E: { E: '7' }, F: { F: '4' },
    GH: { G: '61', H: 'if(l<n&&a[l]==x)' },
    I: { I1: '32', I2: '33' },
    J: { J: 'abs(a-x)+abs(y-b)==3' },
    K: { K: 'abs(a-x)+abs(y-b)==4&&a!=x&&b!=y' }, L: { L: 'strlen(s)' },
    M: { M: "s[i-1]==' '&&s[i]<='Z'" }
  }, ['section-b']);
  expect(result.questions.map(q => [q.questionId, q.status])).toEqual(paper.questions.map(q => [q.id, 'pass']));
  expect(result.scoredPoints).toBe(20);
});
