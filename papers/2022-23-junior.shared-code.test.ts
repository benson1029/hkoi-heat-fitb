import { expect, it } from 'vitest';
import source from './2022-23-junior.json';
import { validatePaper } from '../src/core/validate';
import { gradeQuestion } from '../src/core/grader';

const paper = validatePaper(source);

it('uses one printed grid program with independent I, J, K answers', async () => {
  const context = paper.contexts?.find(item => item.id === 'q6-grid');
  if (!context) throw new Error('Question 6 program is missing');
  const answers = [
    ['junior-i', 'I', 'x%4!=2&&y%4!=2'],
    ['junior-j', 'J', 'x%8&&y%8'],
    ['junior-k', 'K', '(x==4)==(y==4)']
  ] as const;
  expect(context.answerSets?.map(item => item.questionId)).toEqual(answers.map(([id]) => id));
  for (const [id, blank, value] of answers) {
    const question = paper.questions.find(item => item.id === id);
    if (!question || question.grading.kind !== 'program') throw new Error(`${id} is missing`);
    expect(question.contextId).toBe(context.id);
    expect(context.answerSets?.find(item => item.questionId === id)?.bindings).toEqual({ expression: blank });
    expect(context.displayCode?.cpp?.replace('{{expression}}', `{{${blank}}}`)).toBe(question.grading.targets[0].source);
    expect((await gradeQuestion(question, { [blank]: value })).status).toBe('pass');
  }
});
