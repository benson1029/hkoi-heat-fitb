import type { BoxStackRobotGrading, GraphLabelingGrading, RiverRouteGrading, TripleSortNetworkGrading } from './types';
import { parsePrefixRepeatCommands } from './command-language';

export function checkGraphLabeling(spec: GraphLabelingGrading, answer: string): string | null {
  const values = (answer.match(/\d+/g) ?? []).map(Number);
  if (!/^[\s\d,;=a-zA-Z:]+$/.test(answer) || values.length !== spec.nodes.length ||
      values.some(value => !Number.isInteger(value) || value < 1 || value > spec.nodes.length) ||
      new Set(values).size !== values.length) return `Assign the labels 1 to ${spec.nodes.length} once each, in node order.`;
  const labels = new Map(spec.nodes.map((node, index) => [node, values[index]]));
  const costs = spec.edges.map(([a, b]) => Math.abs(labels.get(a)! - labels.get(b)!));
  return new Set(costs).size === costs.length ? null : 'Two edges have the same cost.';
}

export function checkBoxStackRobot(spec: BoxStackRobotGrading, answer: string): string | null {
  const parsed = parsePrefixRepeatCommands(answer, 'LRUD', spec.maxRepeat, spec.maxCommands);
  if (!parsed.commands) return parsed.error ?? 'Invalid command.';
  const rooms = spec.initial.map(stack => [...stack].reverse());
  let room = 0, held: number | null = null;
  for (const command of parsed.commands) {
    if (command === 'L') room = Math.max(0, room - 1);
    else if (command === 'R') room = Math.min(rooms.length - 1, room + 1);
    else if (command === 'U' && held === null && rooms[room].length) held = rooms[room].pop()!;
    else if (command === 'D' && held !== null) { rooms[room].push(held); held = null; }
  }
  if (held !== null) return 'The arm is still holding a box.';
  return rooms.every((stack, index) => stack.slice().reverse().join(',') === spec.target[index].join(','))
    ? null : 'The final stacks do not match the target.';
}

export function checkRiverRoute(spec: RiverRouteGrading, answer: string): string | null {
  if (!/^[+\-<\s]*$/.test(answer)) return 'Use only +, -, and <.';
  const commands = answer.replace(/\s/g, '');
  if (commands.length > spec.maxCommands) return 'The command exceeds the printed length limit.';
  const outgoing = new Map<string, { to: string; limit: number }[]>();
  const parent = new Map<string, string>();
  for (const edge of spec.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push({ to: edge.to, limit: edge.limit });
    outgoing.set(edge.from, list);
    parent.set(edge.to, edge.from);
  }
  let node = spec.start, passengers = spec.passengers;
  for (const command of commands) {
    if (command === '<') node = parent.get(node) ?? node;
    else {
      passengers += command === '+' ? 1 : -1;
      if (passengers < 0) return 'Passenger count became negative.';
      const next = (outgoing.get(node) ?? []).filter(edge => edge.limit >= passengers)
        .sort((a, b) => a.limit - b.limit)[0];
      if (next) node = next.to;
    }
  }
  return node === spec.goal ? null : `The boat ends at ${node}, not ${spec.goal}.`;
}

export function checkTripleSortNetwork(spec: TripleSortNetworkGrading, answer: string): string | null {
  const names = spec.variables;
  const items = answer.replace(/\s/g, '').split(',');
  if (items.length !== spec.answerCount || items.some(item => !/^&[a-zA-Z]$/.test(item) || !names.includes(item.slice(1))))
    return `Enter ${spec.answerCount} distinct variable pointers.`;
  const selected = items.map(item => item.slice(1));
  if (new Set(selected).size !== selected.length) return 'Each sort call needs distinct variables.';
  const calls = spec.calls.map(call => call.map(name => name === spec.answerToken ? selected : name).flat());
  if (calls.some(call => call.length !== 3 || new Set(call).size !== 3 || call.some(name => !names.includes(name)))) return 'Invalid sort call.';
  function permutations(values: number[]): number[][] {
    if (!values.length) return [[]];
    return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]));
  }
  for (const order of permutations(names.map((_, index) => index))) {
    const state = new Map(names.map((name, index) => [name, order[index]]));
    for (const call of calls) {
      const sorted = call.map(name => state.get(name)!).sort((a, b) => a - b);
      call.forEach((name, index) => state.set(name, sorted[index]));
    }
    if (names.some((name, index) => state.get(name) !== index)) return 'The six values are not sorted for every input ordering.';
  }
  return null;
}
