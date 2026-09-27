/** Geometry and graph distance for the 2010 Regular Polygon Graph question. */
export interface RegularPolygonSpec {
  kind: 'regular-polygon-graph';
  answerBlank: string;
  totalEdges: number;
  objective: 'max-vertices' | 'min-horizontal' | 'min-diagonal';
}

export interface RegularPolygonStats {
  edges: number;
  vertices: number;
  horizontalDistance: number;
  diagonalDistance: number;
}

interface Vertex { x: number; y: number }

const EPSILON = 1e-8;

function distance(adjacency: Set<number>[], start: number[], finish: Set<number>): number {
  const seen = new Set(start);
  const queue: [number, number][] = start.map(index => [index, 0]);
  for (let at = 0; at < queue.length; at++) {
    const [vertex, steps] = queue[at];
    if (finish.has(vertex)) return steps;
    for (const neighbor of adjacency[vertex]) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);
      queue.push([neighbor, steps + 1]);
    }
  }
  throw new Error('Regular Polygon Graph is disconnected');
}

/** Construct a unit-side chain with vertical shared edges and co-linear centres. */
export function regularPolygonStats(sequence: string): RegularPolygonStats | null {
  if (!/^[3-6]{2,12}$/.test(sequence)) return null;
  const sides = [...sequence].map(Number);
  if (sides.slice(1, -1).some(side => side % 2 !== 0)) return null;
  const vertices: Vertex[] = [];
  const adjacency: Set<number>[] = [];
  const edges = new Set<string>();
  let nextLeftEdgeX = 0;

  function vertex(x: number, y: number): number {
    const existing = vertices.findIndex(item => Math.abs(item.x - x) < EPSILON && Math.abs(item.y - y) < EPSILON);
    if (existing >= 0) return existing;
    vertices.push({ x, y });
    adjacency.push(new Set());
    return vertices.length - 1;
  }

  for (const [index, sideCount] of sides.entries()) {
    const radius = 1 / (2 * Math.sin(Math.PI / sideCount));
    const apothem = radius * Math.cos(Math.PI / sideCount);
    const leftOdd = index === 0 && sideCount % 2 === 1;
    const rightOdd = index === sides.length - 1 && sideCount % 2 === 1;
    const centreX = leftOdd ? radius : nextLeftEdgeX + apothem;
    const firstAngle = rightOdd ? Math.PI - Math.PI / sideCount : Math.PI / sideCount;
    const ring: number[] = [];
    for (let step = 0; step < sideCount; step++) {
      const angle = firstAngle + 2 * Math.PI * step / sideCount;
      ring.push(vertex(centreX + radius * Math.cos(angle), radius * Math.sin(angle)));
    }
    for (let step = 0; step < sideCount; step++) {
      const a = ring[step], b = ring[(step + 1) % sideCount];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.add(key);
      adjacency[a].add(b);
      adjacency[b].add(a);
    }
    nextLeftEdgeX = centreX + apothem;
  }

  const minX = Math.min(...vertices.map(v => v.x));
  const maxX = Math.max(...vertices.map(v => v.x));
  const maxY = Math.max(...vertices.map(v => v.y));
  const minY = Math.min(...vertices.map(v => v.y));
  const leftmost = vertices.flatMap((v, i) => Math.abs(v.x - minX) < EPSILON ? [i] : []);
  const rightmost = new Set(vertices.flatMap((v, i) => Math.abs(v.x - maxX) < EPSILON ? [i] : []));
  const topmost = vertices.flatMap((v, i) => Math.abs(v.y - maxY) < EPSILON ? [i] : []);
  const bottommost = vertices.flatMap((v, i) => Math.abs(v.y - minY) < EPSILON ? [i] : []);
  const topLeft = topmost.reduce((best, candidate) => vertices[candidate].x < vertices[best].x ? candidate : best);
  const bottomRight = bottommost.reduce((best, candidate) => vertices[candidate].x > vertices[best].x ? candidate : best);
  return {
    edges: edges.size,
    vertices: vertices.length,
    horizontalDistance: distance(adjacency, leftmost, rightmost),
    diagonalDistance: distance(adjacency, [topLeft], new Set([bottomRight]))
  };
}

function metric(stats: RegularPolygonStats, objective: RegularPolygonSpec['objective']): number {
  if (objective === 'max-vertices') return stats.vertices;
  if (objective === 'min-horizontal') return stats.horizontalDistance;
  return stats.diagonalDistance;
}

const optimumCache = new Map<string, number>();

/** Exhaust all short legal chains for the requested edge count. */
export function optimalRegularPolygonValue(spec: RegularPolygonSpec): number {
  if (!Number.isInteger(spec.totalEdges) || spec.totalEdges < 5 || spec.totalEdges > 30) {
    throw new Error('Regular Polygon Graph edge count must be between 5 and 30');
  }
  const cacheKey = `${spec.totalEdges}:${spec.objective}`;
  const cached = optimumCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let best = spec.objective === 'max-vertices' ? -Infinity : Infinity;
  function visit(prefix: string, rawEdges: number): void {
    if (prefix.length >= 2) {
      const graph = regularPolygonStats(prefix);
      if (graph && graph.edges === spec.totalEdges) {
        const value = metric(graph, spec.objective);
        best = spec.objective === 'max-vertices' ? Math.max(best, value) : Math.min(best, value);
      }
    }
    if (prefix.length >= 12) return;
    for (let side = 3; side <= 6; side++) {
      const nextEdges = rawEdges + side - (prefix ? 1 : 0);
      if (nextEdges > spec.totalEdges) continue;
      // Once another polygon is appended, the former right end becomes interior.
      if (prefix.length > 1 && Number(prefix.at(-1)) % 2 !== 0) continue;
      visit(prefix + side, nextEdges);
    }
  }
  visit('', 0);
  if (!Number.isFinite(best)) throw new Error('No Regular Polygon Graph has the requested edge count');
  optimumCache.set(cacheKey, best);
  return best;
}

/** Return a failure reason, or null when the sequence achieves the requested optimum. */
export function checkRegularPolygonGraph(spec: RegularPolygonSpec, answer: string): string | null {
  const sequence = answer.trim();
  const graph = regularPolygonStats(sequence);
  if (!graph) return 'Use a sequence of 3–6 sided polygons, with only even-sided polygons in the middle.';
  if (graph.edges !== spec.totalEdges) return `The graph has ${graph.edges} edges, not ${spec.totalEdges}.`;
  const target = optimalRegularPolygonValue(spec);
  const actual = metric(graph, spec.objective);
  return actual === target ? null : `The ${spec.objective.replaceAll('-', ' ')} is ${actual}; the optimum is ${target}.`;
}
