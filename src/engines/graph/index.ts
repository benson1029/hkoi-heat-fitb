import type { GraphGrading, GraphReversalGrading } from '../../core/types';

const key = (from: string, to: string): string => JSON.stringify([from, to]);

/** Evaluate an added directed-edge set encoded as a JSON array of pairs. */
export function checkGraph(spec: GraphGrading, answer: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return 'Enter added edges as JSON, for example [["A","C"],["C","E"]].';
  }
  if (!Array.isArray(parsed) || !parsed.every(edge => Array.isArray(edge) && edge.length === 2 && edge.every(node => typeof node === 'string'))) {
    return 'Added edges must be a JSON array of [from, to] pairs.';
  }
  const additions = parsed as [string, string][];
  if (spec.assertions.addedEdgeCount !== undefined && additions.length !== spec.assertions.addedEdgeCount) {
    return `Expected ${spec.assertions.addedEdgeCount} added edges.`;
  }
  const nodes = new Set(spec.nodes);
  const base = new Set(spec.baseEdges.map(([from, to]) => key(from, to)));
  const allowed = spec.allowedAddedEdges && new Set(spec.allowedAddedEdges.map(([from, to]) => key(from, to)));
  const seen = new Set<string>();
  for (const [from, to] of additions) {
    const edgeKey = key(from, to);
    if (!nodes.has(from) || !nodes.has(to)) return `Unknown node in ${from} → ${to}.`;
    if (base.has(edgeKey) || seen.has(edgeKey)) return `Duplicate edge ${from} → ${to}.`;
    if (allowed && !allowed.has(edgeKey)) return `Edge ${from} → ${to} is not allowed.`;
    seen.add(edgeKey);
  }
  const adjacency = new Map(spec.nodes.map(node => [node, [] as string[]]));
  for (const [from, to] of [...spec.baseEdges, ...additions]) adjacency.get(from)?.push(to);

  const colors = new Map<string, number>();
  const order: string[] = [];
  const visit = (node: string): boolean => {
    const color = colors.get(node) ?? 0;
    if (color === 1) return false;
    if (color === 2) return true;
    colors.set(node, 1);
    for (const next of adjacency.get(node) ?? []) if (!visit(next)) return false;
    colors.set(node, 2);
    order.push(node);
    return true;
  };
  const acyclic = spec.nodes.every(node => visit(node));
  if (spec.assertions.acyclic === true && !acyclic) return 'The graph contains a directed cycle.';
  if (spec.assertions.acyclic === false && acyclic) return 'The graph must contain a directed cycle.';

  const path = spec.assertions.pathCount;
  if (path) {
    if (!acyclic) return 'Cannot count paths in a cyclic graph.';
    const counts = new Map<string, number>([[path.to, 1]]);
    for (const node of order) {
      if (node === path.to) continue;
      let count = 0;
      for (const next of adjacency.get(node) ?? []) count += counts.get(next) ?? 0;
      counts.set(node, count);
    }
    const observed = counts.get(path.from) ?? 0;
    if (observed !== path.count) return `Expected ${path.count} paths from ${path.from} to ${path.to}; found ${observed}.`;
  }
  return null;
}

function stronglyConnected(spec: GraphReversalGrading, reversed: Set<string>): boolean {
  const edges = spec.edges.map(edge => reversed.has(edge.label)
    ? [edge.to, edge.from] as const : [edge.from, edge.to] as const);
  const reachable = (backward: boolean): Set<string> => {
    const seen = new Set([spec.nodes[0]]);
    const stack = [spec.nodes[0]];
    while (stack.length) {
      const here = stack.pop()!;
      for (const [from, to] of edges) {
        const next = backward ? from : to;
        if ((backward ? to : from) === here && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  };
  return reachable(false).size === spec.nodes.length && reachable(true).size === spec.nodes.length;
}

/** Check a comma-separated set of labeled edge reversals against the graph optimum. */
export function checkGraphReversal(spec: GraphReversalGrading, answer: string): string | null {
  const chosen = answer.split(',').map(label => label.trim());
  if (chosen.some(label => !label)) return 'Enter edge labels separated by commas.';
  const labels = new Set(spec.edges.map(edge => edge.label));
  if (new Set(chosen).size !== chosen.length) return 'An edge label is repeated.';
  for (const label of chosen) if (!labels.has(label)) return `Unknown edge label ${label}.`;
  if (!stronglyConnected(spec, new Set(chosen))) return 'The graph is not strongly connected after those reversals.';
  const edgeLabels = spec.edges.map(edge => edge.label);
  for (let mask = 0; mask < (1 << edgeLabels.length); mask++) {
    let count = 0;
    for (let bit = mask; bit; bit &= bit - 1) count++;
    if (count >= chosen.length) continue;
    const candidate = new Set(edgeLabels.filter((_, index) => (mask & (1 << index)) !== 0));
    if (stronglyConnected(spec, candidate)) return `A strongly connected graph needs only ${count} reversals.`;
  }
  return null;
}
