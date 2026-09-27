import { expect, it } from 'vitest';
import { checkWeightedRoute } from './weighted-route';
import type { WeightedRouteGrading } from './types';

const base: WeightedRouteGrading = {
  kind: 'weighted-route', answerBlank: 'G',
  nodes: ['s', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 't'],
  edges: [
    ['s','a',2], ['s','f',3], ['a','b',6], ['a','c',4], ['b','d',3], ['b','t',9],
    ['c','d',3], ['d','t',7], ['c','e',5], ['c','g',4], ['e','g',2], ['f','g',7], ['g','t',6]
  ].map(([from, to, weight]) => ({ from: String(from), to: String(to), weight: Number(weight) })),
  directed: false, start: 's', end: 't', objective: 'shortest'
};

it('accepts any shortest route and rejects a longer one', () => {
  expect(checkWeightedRoute(base, 's→f→g→t').status).toBe('pass');
  expect(checkWeightedRoute(base, 's-a-c-d-t').status).toBe('pass');
  expect(checkWeightedRoute(base, 's-a-b-t').status).toBe('fail');
});

it('scores the second route relative to the submitted first route', () => {
  const second: WeightedRouteGrading = { ...base, answerBlank: 'H', objective: 'shortest-alternate', reference: { questionId: 'G', blankId: 'G' } };
  expect(checkWeightedRoute(second, 's-a-c-g-t', 's-f-g-t').status).toBe('pass');
  expect(checkWeightedRoute(second, 's-f-g-t', 's-f-g-t').status).toBe('fail');
  expect(checkWeightedRoute(second, 's-a-c-g-t').status).toBe('inconclusive');
});

it('finds the longest simple route', () => {
  const longest: WeightedRouteGrading = { ...base, answerBlank: 'I', objective: 'longest-simple' };
  expect(checkWeightedRoute(longest, 's-f-g-e-c-a-b-d-t').status).toBe('pass');
  expect(checkWeightedRoute(longest, 's-f-g-t').status).toBe('fail');
});
