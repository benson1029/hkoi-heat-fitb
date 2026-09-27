import type { DrawingRobotGrading } from './types';
import { parsePrefixRepeatCommands } from './command-language';

type Point = [number, number];
function edgeKey(a: Point, b: Point): string {
  const ends = [a.join(','), b.join(',')].sort();
  return ends.join('|');
}

export function checkDrawingRobot(spec: DrawingRobotGrading, answer: string): string | null {
  const parsed = parsePrefixRepeatCommands(answer, 'FT', spec.maxRepeat, spec.maxCommands);
  if (!parsed.commands) return parsed.error ?? 'Invalid command.';
  const facing = ['up', 'right', 'down', 'left'].indexOf(spec.facing);
  const vectors: Point[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  let direction = facing;
  let position: Point = [...spec.start];
  const painted = new Set<string>();
  for (const token of parsed.commands) {
    if (token === 'T') direction = (direction + 1) % 4;
    else {
      const vector = vectors[direction];
      const next: Point = [position[0] + vector[0], position[1] + vector[1]];
      painted.add(edgeKey(position, next));
      position = next;
    }
  }
  const target = new Set(spec.targetEdges.map(([a, b]) => edgeKey(a, b)));
  return painted.size === target.size && [...target].every(edge => painted.has(edge))
    ? null : 'The commands do not paint the required segments.';
}
