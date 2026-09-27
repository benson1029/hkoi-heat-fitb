import { expect, it } from 'vitest';
import { checkDrawingRobot } from './drawing-robot';
import type { DrawingRobotGrading } from './types';

const spec: DrawingRobotGrading = {
  kind: 'drawing-robot', answerBlank: 'C', start: [0, 0], facing: 'up', maxCommands: 200, maxRepeat: 8,
  targetEdges: [
    [[0,0],[0,1]], [[0,1],[1,1]], [[1,1],[1,0]], [[1,0],[0,0]],
    [[0,0],[-1,0]], [[-1,0],[-1,-1]], [[-1,-1],[0,-1]], [[0,-1],[0,0]]
  ]
};

it('executes nested F/T repeats and compares painted undirected segments', () => {
  expect(checkDrawingRobot(spec, '2(4(FT)TT)')).toBeNull();
  expect(checkDrawingRobot(spec, '0(FT)2(4(FT)TT)')).toBeNull();
  expect(checkDrawingRobot(spec, '4(FT)')).not.toBeNull();
  expect(checkDrawingRobot(spec, '2(4(TF)TT)')).not.toBeNull();
  expect(checkDrawingRobot(spec, '99(FT)')).not.toBeNull();
});
