import { expect, it } from 'vitest';
import { matchesLogoDrawing, type DrawingSegment } from './logo-drawing';

const target: DrawingSegment[] = [
  [[.25, 0], [1, .5]], [[1, .5], [.25, 1]], [[.25, 1], [.25, 0]],
  [[.75, 0], [0, .5]], [[0, .5], [.75, 1]], [[.75, 1], [.75, 0]]
];

it('accepts a hand-drawn shape with uneven lines, gaps, and touch-ups', () => {
  const sketch: DrawingSegment[] = [
    [[.23, .08], [.93, .47]], [[.96, .56], [.29, .94]], [[.27, .97], [.21, .06]],
    [[.73, .07], [.06, .48]], [[.04, .55], [.79, .92]], [[.77, .96], [.74, .09]],
    [[.21, .06], [.28, .11]], [[.74, .09], [.78, .13]]
  ];
  expect(matchesLogoDrawing(sketch, target, .14)).toBe(true);
});

it('accepts a recognizable shape drawn as several short strokes', () => {
  const sketch = target.flatMap(([a, b]) => {
    const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return [[a, midpoint], [midpoint, b]] as DrawingSegment[];
  });
  expect(matchesLogoDrawing(sketch, target, .14)).toBe(true);
});

it('rejects missing sides and unrelated shapes', () => {
  const square: DrawingSegment[] = [
    [[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]
  ];
  expect(matchesLogoDrawing(square, target, .14)).toBe(false);
  expect(matchesLogoDrawing(target.slice(0, 3), target, .14)).toBe(false);
  expect(matchesLogoDrawing([...target, [[0, 0], [1, 1]], [[0, 1], [1, 0]]], target, .14)).toBe(false);
});
