import { describe, expect, it } from 'vitest';
import { checkRobot } from './index';
import type { RobotGridGrading } from '../../core/types';

const robot: RobotGridGrading = {
  kind: 'robot-grid', answerBlank: 'R',
  dialect: { commands: { R: [1, 0], D: [0, 1] }, repeatSyntax: 'bracket-number', invalidMove: 'error' },
  worlds: [{ id: 'small', width: 3, height: 2, starts: [[0, 0]], blocked: [],
    requiredVisited: [[1, 0], [2, 0], [2, 1]], finalPosition: [2, 1], maxMoves: 4 }]
};

describe('robot grid', () => {
  it('expands repetitions and verifies visits', () => {
    expect(checkRobot(robot, '[R]2D')).toBeNull();
    expect(checkRobot({ ...robot, dialect: { ...robot.dialect, repeatSyntax: 'both' } }, '(R)2D')).toBeNull();
    expect(checkRobot({ ...robot, dialect: { ...robot.dialect, maxRepeat: 1 } }, '[R]2D')).toMatch(/dialect limit/);
  });
  it('rejects missed cells and excess moves', () => {
    expect(checkRobot(robot, 'RDD')).toMatch(/Invalid move|not visited/);
    expect(checkRobot(robot, '[R]999999')).toMatch(/Repeat count/);
  });
});
