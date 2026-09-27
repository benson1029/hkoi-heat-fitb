import type { WeightedRouteGrading } from './types';

type RouteResult = { status: 'pass' | 'fail' | 'inconclusive'; message?: string };

function parseRoute(source: string, nodes: string[]): string[] | null {
  if (source.length > 500 || !/^[A-Za-z0-9\s,;>\-→]+$/.test(source)) return null;
  const labels = source.toLowerCase().split(/[\s,;>\-→]+/).filter(Boolean);
  return labels.length >= 2 && labels.length <= nodes.length && labels.every(node => nodes.includes(node))
    && new Set(labels).size === labels.length ? labels : null;
}

export function checkWeightedRoute(spec: WeightedRouteGrading, answer: string, referenceAnswer?: string): RouteResult {
  const nodes = spec.nodes.map(node => node.toLowerCase());
  const start = spec.start.toLowerCase(), end = spec.end.toLowerCase();
  const neighbors = new Map(nodes.map(node => [node, [] as { node: string; weight: number }[]]));
  for (const edge of spec.edges) {
    const from = edge.from.toLowerCase(), to = edge.to.toLowerCase();
    neighbors.get(from)!.push({ node: to, weight: edge.weight });
    if (!spec.directed) neighbors.get(to)!.push({ node: from, weight: edge.weight });
  }
  function weight(route: string[] | null): number | null {
    if (!route || route[0] !== start || route.at(-1) !== end) return null;
    let total = 0;
    for (let i = 1; i < route.length; i++) {
      const edge = neighbors.get(route[i - 1])?.find(item => item.node === route[i]);
      if (!edge) return null;
      total += edge.weight;
    }
    return total;
  }
  const route = parseRoute(answer, nodes);
  const candidateWeight = weight(route);
  if (candidateWeight === null) return { status: 'fail', message: 'Enter a valid simple route from start to finish.' };
  let excluded: string | undefined;
  if (spec.objective === 'shortest-alternate') {
    if (!referenceAnswer?.trim()) return { status: 'inconclusive', message: 'Enter the first route before checking this answer.' };
    const reference = parseRoute(referenceAnswer, nodes);
    if (weight(reference) === null) return { status: 'inconclusive', message: 'The first route is invalid.' };
    excluded = reference!.join('|');
    if (route!.join('|') === excluded) return { status: 'fail', message: 'The second route must differ from the first.' };
  }
  let best = spec.objective === 'longest-simple' ? -Infinity : Infinity;
  let visits = 0;
  const path = [start], seen = new Set([start]);
  function search(current: string, length: number): void {
    if (++visits > 200_000) throw new Error('Route search limit exceeded.');
    if (current === end) {
      if (path.join('|') !== excluded) {
        best = spec.objective === 'longest-simple' ? Math.max(best, length) : Math.min(best, length);
      }
      return;
    }
    for (const next of neighbors.get(current) ?? []) {
      if (seen.has(next.node)) continue;
      seen.add(next.node); path.push(next.node);
      search(next.node, length + next.weight);
      path.pop(); seen.delete(next.node);
    }
  }
  try { search(start, 0); }
  catch { return { status: 'inconclusive', message: 'Route search limit exceeded.' }; }
  if (!Number.isFinite(best)) return { status: 'inconclusive', message: 'No eligible route exists in this graph.' };
  return candidateWeight === best ? { status: 'pass' }
    : { status: 'fail', message: `This route has cost ${candidateWeight}; the required cost is ${best}.` };
}
