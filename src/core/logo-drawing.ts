type Point = [number, number];
export type DrawingSegment = [Point, Point];

function distanceToSegment(point: Point, [a, b]: DrawingSegment): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-10) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function along([a, b]: DrawingSegment, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Compare the recognizable strokes, rather than requiring an accurate tracing. */
export function matchesLogoDrawing(drawing: DrawingSegment[], target: DrawingSegment[], tolerance: number): boolean {
  const substantial = drawing.filter(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) >= 0.04);
  if (substantial.length < target.length || !target.length) return false;

  // Short touch-up strokes should not move the drawing's bounding box.
  const bounds = substantial.flatMap(segment => segment);
  const xs = bounds.map(point => point[0]), ys = bounds.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const width = maxX - minX, height = maxY - minY;
  if (width < 0.08 || height < 0.08 || width * 400 / (height * 320) < 0.65 || width * 400 / (height * 320) > 1.7) return false;
  const lines: DrawingSegment[] = substantial.map(([a, b]) => [
    [(a[0] - minX) / width, (a[1] - minY) / height],
    [(b[0] - minX) / width, (b[1] - minY) / height]
  ]);

  // Each intended edge needs most of its length, but endpoints and joins may be rough.
  const nearby = (point: Point, segments: DrawingSegment[], radius: number) =>
    segments.some(segment => distanceToSegment(point, segment) <= radius);
  for (const edge of target) {
    let covered = 0;
    for (let i = 0; i < 15; i++) if (nearby(along(edge, (i + 0.5) / 15), lines, tolerance)) covered++;
    if (covered < 10) return false;
  }

  // Reject large unrelated strokes while allowing retracing and small corrections.
  let totalLength = 0, unrelatedLength = 0;
  for (const line of lines) {
    const length = Math.hypot(line[0][0] - line[1][0], line[0][1] - line[1][1]);
    totalLength += length;
    let unrelated = 0;
    for (let i = 0; i < 12; i++) if (!nearby(along(line, (i + 0.5) / 12), target, tolerance * 1.3)) unrelated++;
    if (length >= 0.6 && unrelated >= 4) return false;
    unrelatedLength += length * unrelated / 12;
  }
  return unrelatedLength / totalLength <= 0.18;
}
