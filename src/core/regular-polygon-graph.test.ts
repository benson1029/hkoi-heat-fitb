import { expect, it } from 'vitest';
import {
  checkRegularPolygonGraph, optimalRegularPolygonValue, regularPolygonStats,
  type RegularPolygonSpec
} from './regular-polygon-graph';

const spec = (objective: RegularPolygonSpec['objective']): RegularPolygonSpec => ({
  kind:'regular-polygon-graph', answerBlank:'G', totalEdges:13, objective
});

it('reconstructs the printed 5643 example, including both paths', () => {
  expect(regularPolygonStats('5643')).toEqual({
    edges:15, vertices:12, horizontalDistance:6, diagonalDistance:3
  });
});

it('accepts exactly the six suggested maximum-vertex sequences', () => {
  const grading = spec('max-vertices');
  expect(optimalRegularPolygonValue(grading)).toBe(11);
  for (const answer of ['465','645','564','546','366','663']) {
    expect(checkRegularPolygonGraph(grading, answer)).toBeNull();
  }
  expect(checkRegularPolygonGraph(grading, '4444')).not.toBeNull();
});

it('checks the separate Junior horizontal and Senior diagonal objectives', () => {
  const junior = spec('min-horizontal');
  const senior = spec('min-diagonal');
  expect(optimalRegularPolygonValue(junior)).toBe(4);
  expect(optimalRegularPolygonValue(senior)).toBe(2);
  expect(checkRegularPolygonGraph(junior, '4444')).toBeNull();
  expect(checkRegularPolygonGraph(junior, '5443')).not.toBeNull();
  expect(checkRegularPolygonGraph(senior, '5443')).toBeNull();
  expect(checkRegularPolygonGraph(senior, '3445')).toBeNull();
  expect(checkRegularPolygonGraph(senior, '4444')).not.toBeNull();
});

it('rejects geometrically impossible and wrong-edge chains', () => {
  for (const bad of ['35','4354','54453','3333','4 4 4 4']) {
    expect(checkRegularPolygonGraph(spec('max-vertices'), bad)).not.toBeNull();
  }
  expect(checkRegularPolygonGraph(spec('max-vertices'), '5643')).toMatch(/15 edges/);
});
