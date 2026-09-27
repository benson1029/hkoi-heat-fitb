import { describe, expect, it } from 'vitest';
import { checkGraph, checkGraphReversal } from './index';
import type { GraphGrading, GraphReversalGrading } from '../../core/types';

const graph: GraphGrading = {
  kind: 'graph', answerBlank: 'J', nodes: 'ABCDEFG'.split(''), directed: true,
  baseEdges: [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F'], ['F', 'G']],
  assertions: { addedEdgeCount: 3, acyclic: true, pathCount: { from: 'A', to: 'G', count: 8 } }
};

describe('graph assertions', () => {
  it('counts paths over a valid edge set', () => {
    expect(checkGraph(graph, '[["A","C"],["C","E"],["E","G"]]')).toBeNull();
  });
  it('rejects duplicate and cyclic additions', () => {
    expect(checkGraph(graph, '[["A","B"],["C","E"],["E","G"]]')).toMatch(/Duplicate/);
    expect(checkGraph(graph, '[["A","C"],["C","E"],["G","A"]]')).toMatch(/cycle/);
  });
});

const reversal: GraphReversalGrading = {
  kind: 'graph-reversal', answerBlank: 'C', nodes: ['0', '1', '2', '3', '4'],
  edges: [
    { label: 'a', from: '0', to: '1' }, { label: 'b', from: '0', to: '2' },
    { label: 'c', from: '1', to: '2' }, { label: 'd', from: '1', to: '4' },
    { label: 'e', from: '3', to: '2' }, { label: 'f', from: '3', to: '4' }
  ], requireStronglyConnected: true, requireMinimum: true
};

it('accepts a minimum strong-connectivity reversal', () => {
  expect(checkGraphReversal(reversal, 'b,f')).toBeNull();
  expect(checkGraphReversal(reversal, 'b,f,a')).toMatch(/not strongly connected|only 2/);
});
