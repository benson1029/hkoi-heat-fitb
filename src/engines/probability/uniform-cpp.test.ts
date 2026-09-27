import { expect, it } from 'vitest';
import { checkUniformCppExpression } from './uniform-cpp';
import type { UniformCppExpressionGrading } from '../../core/types';

const grading: UniformCppExpressionGrading = {
  kind: 'uniform-cpp-expression', answerBlank: 'O', randomFunction: 'f',
  randomMin: 0, randomMax: 99, outputMin: 0, outputMax: 79, maxCalls: 3
};

it('proves different official constructions exactly uniform', () => {
  for (const expression of ['(f()*100+f())/125', 'f()/25*20+f()/5', 'f()/5*4+f()/25']) {
    expect(checkUniformCppExpression(grading, expression), expression).toMatchObject({ status: 'pass' });
  }
});

it('rejects bias, out-of-range output, and possible undefined arithmetic', () => {
  for (const expression of ['f()%80', 'f()', 'f()/(f()-50)']) {
    expect(checkUniformCppExpression(grading, expression).status, expression).toBe('fail');
  }
});

it('returns inconclusive for expressions outside its exact grammar', () => {
  expect(checkUniformCppExpression(grading, 'f()<80?f():0').status).toBe('inconclusive');
});
