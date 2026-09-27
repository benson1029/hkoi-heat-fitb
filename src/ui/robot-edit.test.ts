import { describe, expect, it } from 'vitest';
import { deleteBeforeCursor, insertRobotToken } from './robot-edit';

describe('robot command editing', () => {
  it('inserts at the cursor and replaces a selection', () => {
    expect(insertRobotToken('˄˅', 1, 1, '<', 3)).toEqual({ value: '˄<˅', cursor: 2 });
    expect(insertRobotToken('˄˅', 0, 1, '>', 2)).toEqual({ value: '>˅', cursor: 1 });
  });

  it('rejects an insertion over the printed character limit', () => {
    expect(insertRobotToken('˄˅', 1, 1, '<', 2)).toBeNull();
    expect(insertRobotToken('😀', 2, 2, '<', 2)).toEqual({ value: '😀<', cursor: 3 });
  });

  it('deletes a selected range or the prior Unicode character', () => {
    expect(deleteBeforeCursor('˄<˅', 1, 2)).toEqual({ value: '˄˅', cursor: 1 });
    expect(deleteBeforeCursor('😀<', 2, 2)).toEqual({ value: '<', cursor: 0 });
  });
});
