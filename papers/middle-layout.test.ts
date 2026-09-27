import { expect, it } from 'vitest';
import junior2017 from './2016-17-junior.json';
import senior2017 from './2016-17-senior.json';
import junior2018 from './2017-18-junior.json';
import senior2018 from './2017-18-senior.json';
import junior2019 from './2018-19-junior.json';
import senior2019 from './2018-19-senior.json';
import junior2020 from './2019-20-junior.json';
import senior2020 from './2019-20-senior.json';
import junior2021 from './2020-21-junior.json';
import senior2021 from './2020-21-senior.json';
import { validatePaper } from '../src/core/validate';

const papers = [
  junior2017, senior2017, junior2018, senior2018, junior2019,
  senior2019, junior2020, senior2020, junior2021, senior2021,
].map(validatePaper);

it('shows the printed code for every 2016/17–2020/21 code completion', () => {
  for (const paper of papers) {
    for (const question of paper.questions) {
      if (question.grading.kind !== 'program') continue;
      const context = paper.contexts?.find(item => item.id === question.contextId);
      const visible = question.displayCode?.cpp ?? context?.displayCode?.cpp ?? context?.markdown;
      expect(visible, `${paper.paper.id} ${question.id}`).toBeTruthy();
      expect(visible, `${paper.paper.id} ${question.id}`).toMatch(/\{\{|```/);
    }
  }
});

it('preserves the printed multiline C++ programs in 2020/21', () => {
  const junior = validatePaper(junior2021);
  const senior = validatePaper(senior2021);
  const jq = (id: string) => junior.questions.find(item => item.id === id)!;
  const sq = (id: string) => senior.questions.find(item => item.id === id)!;
  const jc = (id: string) => junior.contexts?.find(item => item.id === id)!;
  const sc = (id: string) => senior.contexts?.find(item => item.id === id)!;

  expect(jq('section-b-e').displayCode?.cpp).toContain("char q[11] =\n    {'h', 'k', 'o', 'i',");
  expect(jc('q5-swap-code').markdown).toContain('void SwapChar(char& x,\n');
  expect(jc('q6-prime-code').markdown).toContain('51             a = false;');
  expect(jc('q7-pattern-code').displayCode?.cpp).toContain("            if ({{pattern}})\n                cout << '#';");

  expect(sq('cpp-b').displayCode?.cpp).toContain('for (i = 0; i <= {{B1}}; i++)\n        sum = sum + {{B2}};');
  expect(sq('cpp-e').displayCode?.cpp).toContain('for (i = 2; i <= 6; i++)\n        if ({{E2}})');
  expect(sq('cpp-l').displayCode?.cpp).toContain('int a[801], b[801];\nint c[101];\nint i, j;');
  expect(sq('cpp-m').displayCode?.cpp).toContain('    else\n        return UP; // default');
  expect(sc('q5-functions').markdown).toContain('for (i = 1; i <= 64; i++)\n        y = y + f(i);');

  for (const [question, source] of [
    [jq('section-b-e'), jq('section-b-e').grading],
    [sq('cpp-b'), sq('cpp-b').grading],
    [sq('cpp-e'), sq('cpp-e').grading],
    [sq('cpp-l'), sq('cpp-l').grading],
  ] as const) {
    expect(source.kind).toBe('program');
    if (source.kind === 'program') expect(source.targets[0].source).toBe(question.displayCode?.cpp);
  }
});

it('keeps line-repair numbering aligned with the displayed program', () => {
  const prime = validatePaper(junior2021).questions.find(item => item.id === 'section-b-j')!;
  const expression = validatePaper(senior2020).questions.find(item => item.id === 'cpp-l')!;
  const primeContext = validatePaper(junior2021).contexts?.find(item => item.id === prime.contextId)!;
  expect(primeContext.markdown).toContain('48     while (i * i < x)');
  expect(primeContext.markdown).toContain('51             a = false;');
  if (prime.grading.kind === 'cpp-line-repair')
    expect(prime.grading.source.split('\n')[7]).toBe('    while (i * i < x)');
  if (expression.grading.kind === 'cpp-line-repair')
    expect(expression.grading.source).toBe(expression.displayCode?.cpp);
});

it('uses one printed 2016/17 Junior Question 5 program for alternative blanks J and K', () => {
  const paper = validatePaper(junior2017);
  const context = paper.contexts?.find(item => item.id === 'q5-code')!;
  expect(context.displayCode?.cpp).toContain('val = {{value}};');
  expect(context.markdown).not.toContain('```cpp');
  expect(context.answerSets).toEqual([
    { questionId: 'section-b-j', label: 'J', bindings: { value: 'J' } },
    { questionId: 'section-b-k', label: 'K', bindings: { value: 'K' } },
  ]);
});

it('uses one printed 2020/21 Junior Question 7 program for alternative blanks K and L', () => {
  const paper = validatePaper(junior2021);
  const context = paper.contexts?.find(item => item.id === 'q7-pattern-code')!;
  expect(context.displayCode?.cpp).toContain('if ({{pattern}})');
  expect(context.answerSets).toEqual([
    { questionId: 'section-b-k', label: 'K', bindings: { pattern: 'K' } },
    { questionId: 'section-b-l', label: 'L', bindings: { pattern: 'L' } },
  ]);
});

it('shows the 2018/19 bubble-sort and dangling-else programs once per context', () => {
  for (const raw of [junior2019, senior2019]) {
    const paper = validatePaper(raw);
    for (const question of paper.questions) {
      if (!['section-b-h', 'section-b-i', 'section-b-j', 'cpp-h', 'cpp-i', 'cpp-j', 'cpp-n'].includes(question.id)) continue;
      const context = paper.contexts?.find(item => item.id === question.contextId);
      expect(context?.markdown, question.id).toContain('```cpp');
      expect(question.displayCode, question.id).toBeUndefined();
    }
  }
});
