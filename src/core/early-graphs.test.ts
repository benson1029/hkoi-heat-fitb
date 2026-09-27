import { expect, it } from 'vitest';
import { checkBoxStackRobot, checkGraphLabeling, checkRiverRoute, checkTripleSortNetwork } from './early-graphs';

it('checks edge costs of the 2009 labeling', () => {
  const spec = { kind: 'graph-labeling' as const, answerBlank: 'B', nodes: ['a','b','c','d','e','f'], edges: [['a','b'],['b','c'],['c','d'],['d','e'],['d','f']] as [string,string][] };
  expect(checkGraphLabeling(spec, '2 3 5 1 4 6')).toBeNull();
  expect(checkGraphLabeling(spec, '1 2 3 4 5 6')).not.toBeNull();
});

it('executes the 2009 box arm commands and checks complete stacks', () => {
  const spec = { kind: 'box-stack-robot' as const, answerBlank: 'C', initial: [[1,2,3,4],[],[]], target: [[],[],[1,2,3,4]], maxCommands: 1000, maxRepeat: 999 };
  expect(checkBoxStackRobot(spec, '2(4(URDL)R)')).toBeNull();
  expect(checkBoxStackRobot(spec, '4(URRDLL)')).not.toBeNull();
});

it('follows the 2009 river rule and uses the least eligible downstream limit', () => {
  const spec = { kind: 'river-route' as const, answerBlank: 'H', start: 'S', goal: 'B', passengers: 10, maxCommands: 5,
    edges: [
      {from:'S',to:'u',limit:11},{from:'S',to:'l',limit:9},
      {from:'l',to:'l1',limit:15},{from:'l',to:'l2',limit:8},
      {from:'l2',to:'l2a',limit:9},{from:'l2',to:'l2b',limit:7},
      {from:'l2a',to:'l2aa',limit:12},{from:'l2aa',to:'B',limit:9}
    ] };
  expect(checkRiverRoute(spec, '--++-')).toBeNull();
  expect(checkRiverRoute(spec, '+++++')).not.toBeNull();
});

it('tests a three-input sort network against all permutations', () => {
  const spec = { kind: 'triple-sort-network' as const, answerBlank: 'C', variables: ['a','b','c','d','e','f'], answerToken: 'ANSWER', answerCount: 2,
    calls: [['a','b','c'],['d','e','f'],['a','d','e'],['b','c','f'],['a','ANSWER'],['c','d','e']] };
  expect(checkTripleSortNetwork(spec, '&b,&d')).toBeNull();
  expect(checkTripleSortNetwork(spec, '&b,&c')).not.toBeNull();
});
