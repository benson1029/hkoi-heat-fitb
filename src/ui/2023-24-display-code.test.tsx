import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import juniorRaw from '../../papers/2023-24-junior.json';
import seniorRaw from '../../papers/2023-24-senior.json';
import { validatePaper } from '../core/validate';
import { ContextBlock, QuestionCard } from './App';
import type { PaperAnswers, Question } from '../core/types';

const junior = validatePaper(juniorRaw);
const senior = validatePaper(seniorRaw);

function renderQuestion(question: Question, paper: typeof junior | typeof senior): string {
  const context = question.contextId ? paper.contexts?.find(item => item.id === question.contextId) : undefined;
  return renderToStaticMarkup(<QuestionCard
    question={question}
    selectedLanguage="cpp"
    pythonRuntime="custom"
    sharedCode={false}
    contextShowsCode={!!context?.markdown && /```(?:c|cpp|c\+\+|python)(?:\s|$)/i.test(context.markdown)}
    paperSource={paper.paper.source}
    values={{}}
    allAnswers={{} as PaperAnswers}
    busy={false}
    onAnswer={() => undefined}
    onCheck={() => undefined}
  />);
}

function renderedText(markup: string): string {
  return markup.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

describe('2023/24 Section B J and K function display', () => {
  const renderCases = [
    [junior, 'junior-j', 'char f(string s)', 'return (char)('],
    [junior, 'junior-k', 'int f(int x)', 'return r;'],
    [senior, 'cpp-j', 'int g(int x)', 'return res;'],
    [senior, 'cpp-k', 'int h(int x)', 'return res;'],
  ] as const;

  it.each(renderCases)('renders the function for $1.paper.id $2', (paper, questionId, ...snippets) => {
    const question = paper.questions.find(item => item.id === questionId);
    expect(question).toBeDefined();
    expect(question?.track).toBe('section-b');
    expect(question?.printedRef).toContain('Section B');

    const markup = renderQuestion(question!, paper);
    const text = renderedText(markup);
    for (const snippet of snippets) expect(text).toContain(snippet);
    expect(markup).toContain('code-source');
  });

  it('renders the senior shared reference function in the Section B context', () => {
    const context = senior.contexts?.find(item => item.id === 'bitshift');
    const questions = senior.questions.filter(item => item.contextId === 'bitshift');
    expect(context).toBeDefined();
    const markup = renderToStaticMarkup(<ContextBlock
      context={context!}
      questions={questions}
      answers={{}}
      selectedLanguage="cpp"
      onSelectAnswerSet={() => undefined}
      onAnswer={() => undefined}
    />);
    const text = renderedText(markup);
    expect(text).toContain('int f(int x)');
    expect(text).toContain('a = 1 << x');
  });
});
