import type { Question, Coord, IntegerListGrading, MatrixSumsGrading, GridCheckpointsGrading, RiverRouteGrading, DrawingRobotGrading, BoxStackRobotGrading, RobotGridGrading, CppLineRepairGrading } from '../core/types';
import { checkSparseRuler, checkDifferencePyramid, checkBooleanCircuit, checkPrimeFactorCountCounterexample, checkTopTwoCounterexample } from '../core/early-semantics';
import { checkGraph, checkGraphReversal } from '../engines/graph';
import { checkGraphLabeling } from '../core/early-graphs';
import { checkRegularPolygonGraph } from '../core/regular-polygon-graph';

type Assignment = Record<string, string>;
const one = (blank: string, value: string): Assignment => ({ [blank]: value });

function* combinations<T>(values: T[], count: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === count) { yield [...prefix]; return; }
  for (let i = start; i <= values.length - (count - prefix.length); i++) {
    prefix.push(values[i]);
    yield* combinations(values, count, i + 1, prefix);
    prefix.pop();
  }
}

function* permutations<T>(values: T[], prefix: T[] = []): Generator<T[]> {
  if (!values.length) { yield [...prefix]; return; }
  for (let i = 0; i < values.length; i++) {
    prefix.push(values[i]);
    yield* permutations([...values.slice(0, i), ...values.slice(i + 1)], prefix);
    prefix.pop();
  }
}

function valuesForIntegerList(spec: IntegerListGrading): number[] {
  if (spec.allowed) return [...spec.allowed];
  const result: number[] = [];
  for (let n = spec.minimum; n <= spec.maximum && result.length < 500; n++) {
    if (spec.forbidden?.includes(n) || spec.squareOnly && (n < 0 || !Number.isInteger(Math.sqrt(n)))) continue;
    result.push(n);
  }
  return result;
}

function* integerLists(spec: IntegerListGrading): Generator<Assignment> {
  const values = valuesForIntegerList(spec);
  if (values.length < spec.count) return;
  if (spec.inversionCount !== undefined) {
    const remaining = [...values].sort((a, b) => String(a).length - String(b).length || Math.abs(a) - Math.abs(b) || a - b)
      .slice(0, spec.count).sort((a, b) => a - b);
    const permutation: number[] = [];
    let inversions = spec.inversionCount;
    while (remaining.length) {
      const index = Math.min(inversions, remaining.length - 1);
      permutation.push(remaining.splice(index, 1)[0]);
      inversions -= index;
    }
    if (inversions !== 0) return;
    yield formatIntegerList(spec, permutation);
    return;
  }
  const available = spec.minimumSpacing ? values.filter(value =>
    spec.minimumSpacing!.anchors.every(anchor => Math.abs(value - anchor) >= spec.minimumSpacing!.required)) : values;
  if (spec.minimumSpacing) {
    for (const group of combinations(available, spec.count)) {
      if (group.some((value, index) => index > 0 && value - group[index - 1] < spec.minimumSpacing!.required)) continue;
      yield formatIntegerList(spec, group);
      return;
    }
  } else {
    yield formatIntegerList(spec, available.slice(0, spec.count));
  }
}

function formatIntegerList(spec: IntegerListGrading, values: number[]): Assignment {
  return spec.answerBlanks.length === 1 ? one(spec.answerBlanks[0], values.join(' '))
    : Object.fromEntries(spec.answerBlanks.map((id, index) => [id, String(values[index])]));
}

function* matrices(spec: MatrixSumsGrading): Generator<Assignment> {
  const width = spec.colSums.length, height = spec.rowSums.length;
  const counts = new Map(spec.values.map(value => [value, spec.each]));
  const cells: number[] = [];
  const rowSums = Array<number>(height).fill(0), colSums = Array<number>(width).fill(0);
  function* visit(at: number): Generator<Assignment> {
    if (at === width * height) {
      if (rowSums.every((sum, row) => sum === spec.rowSums[row])
        && colSums.every((sum, col) => sum === spec.colSums[col])) yield one(spec.answerBlank, cells.join(' '));
      return;
    }
    const row = Math.floor(at / width), col = at % width;
    for (const value of spec.values) {
      if (!counts.get(value)) continue;
      if (rowSums[row] + value > spec.rowSums[row] || colSums[col] + value > spec.colSums[col]) continue;
      counts.set(value, counts.get(value)! - 1);
      cells.push(value); rowSums[row] += value; colSums[col] += value;
      if ((col !== width - 1 || rowSums[row] === spec.rowSums[row])
        && (row !== height - 1 || colSums[col] === spec.colSums[col])) yield* visit(at + 1);
      rowSums[row] -= value; colSums[col] -= value; cells.pop();
      counts.set(value, counts.get(value)! + 1);
    }
  }
  yield* visit(0);
}

function checkpointPaths(spec: GridCheckpointsGrading, a: Coord, b: Coord): number {
  const paths = Array.from({ length: spec.height }, () => Array.from({ length: spec.width }, () => [0, 0, 0]));
  paths[0][0][0] = 1;
  for (let y = 0; y < spec.height; y++) for (let x = 0; x < spec.width; x++) {
    if (x === 0 && y === 0) continue;
    const hit = Number(x === a[0] && y === a[1] || x === b[0] && y === b[1]);
    for (let visited = 0; visited <= 2; visited++) {
      const count = (x > 0 ? paths[y][x - 1][visited] : 0) + (y > 0 ? paths[y - 1][x][visited] : 0);
      paths[y][x][Math.min(2, visited + hit)] += count;
    }
  }
  return paths[spec.height - 1][spec.width - 1][1];
}

function* gridCheckpoints(spec: GridCheckpointsGrading): Generator<Assignment> {
  const cells: Coord[] = [];
  for (let y = 0; y < spec.height; y++) for (let x = 0; x < spec.width; x++) {
    if (x + y === 0 || x === spec.width - 1 && y === spec.height - 1) continue;
    cells.push([x, y]);
  }
  for (const [a, b] of combinations(cells, 2)) {
    if (checkpointPaths(spec, a, b) !== spec.expectedPaths) continue;
    const label = ([x, y]: Coord) => `${String.fromCharCode(65 + x)}${y + 1}`;
    yield one(spec.answerBlank, `${label(a)} ${label(b)}`);
  }
}

function* riverRoutes(spec: RiverRouteGrading): Generator<Assignment> {
  const outgoing = new Map<string, { to: string; limit: number }[]>();
  const parents = new Map<string, string>();
  for (const edge of spec.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), { to: edge.to, limit: edge.limit }]);
    parents.set(edge.to, edge.from);
  }
  const maximum = Math.max(spec.passengers, ...spec.edges.map(edge => edge.limit));
  const queue = [{ node: spec.start, passengers: spec.passengers, commands: '' }];
  const seen = new Set([`${spec.start}|${spec.passengers}`]);
  for (let at = 0; at < queue.length; at++) {
    const state = queue[at];
    if (state.node === spec.goal) { yield one(spec.answerBlank, state.commands); return; }
    if (state.commands.length >= spec.maxCommands) continue;
    for (const command of ['+', '-', '<'] as const) {
      const passengers = state.passengers + (command === '+' ? 1 : command === '-' ? -1 : 0);
      if (passengers < 0 || passengers > maximum) continue;
      let node = state.node;
      if (command === '<') node = parents.get(node) ?? node;
      else node = (outgoing.get(node) ?? []).filter(edge => edge.limit >= passengers)
        .sort((a, b) => a.limit - b.limit)[0]?.to ?? node;
      const key = `${node}|${passengers}`;
      if (seen.has(key)) continue;
      seen.add(key); queue.push({ node, passengers, commands: state.commands + command });
    }
  }
}

/** Shortest equivalent prefix-repeat spelling of one generated command trace. */
function compressCommands(source: string, maxRepeat: number): string {
  const best = Array.from({ length: source.length + 1 }, () => Array<string>(source.length + 1).fill(''));
  for (let length = 1; length <= source.length; length++) for (let start = 0; start + length <= source.length; start++) {
    const end = start + length;
    let chosen = source.slice(start, end);
    for (let split = start + 1; split < end; split++) {
      const alternative = best[start][split] + best[split][end];
      if (alternative.length < chosen.length) chosen = alternative;
    }
    for (let repetitions = 2; repetitions <= Math.min(maxRepeat, length); repetitions++) {
      if (length % repetitions !== 0) continue;
      const period = length / repetitions;
      const base = source.slice(start, start + period);
      if (base.repeat(repetitions) !== source.slice(start, end)) continue;
      const alternative = `${repetitions}(${best[start][start + period]})`;
      if (alternative.length < chosen.length) chosen = alternative;
    }
    best[start][end] = chosen;
  }
  return best[0][source.length];
}

function* drawingRobot(spec: DrawingRobotGrading, maxChars = 16): Generator<Assignment> {
  const key = (a: Coord, b: Coord) => [a.join(','), b.join(',')].sort().join('|');
  const adjacency = new Map<string, { next: Coord; edge: string }[]>();
  for (const [a, b] of spec.targetEdges) {
    const edge = key(a, b);
    for (const [from, to] of [[a, b], [b, a]] as [Coord, Coord][]) {
      const point = from.join(',');
      adjacency.set(point, [...(adjacency.get(point) ?? []), { next: to, edge }]);
    }
  }
  let facing = ['up', 'right', 'down', 'left'].indexOf(spec.facing);
  let position: Coord = [...spec.start];
  let commands = '';
  const seen = new Set<string>();
  const vectors: Coord[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  function move(to: Coord): void {
    const dx = to[0] - position[0], dy = to[1] - position[1];
    const direction = vectors.findIndex(([x, y]) => x === dx && y === dy);
    if (direction < 0) throw new Error('Target edge is not a unit grid segment.');
    const turns = (direction - facing + 4) % 4;
    commands += 'T'.repeat(turns) + 'F';
    facing = direction; position = to;
  }
  function visit(): void {
    const from: Coord = [...position];
    for (const neighbor of adjacency.get(from.join(',')) ?? []) {
      if (seen.has(neighbor.edge)) continue;
      seen.add(neighbor.edge);
      move(neighbor.next);
      visit();
      move(from);
    }
  }
  try { visit(); } catch { return; }
  if (seen.size === spec.targetEdges.length && commands.length <= spec.maxCommands)
    yield one(spec.answerBlank, compressCommands(commands, spec.maxRepeat));
  const compact = compactDrawingRobot(spec, maxChars);
  if (compact) yield one(spec.answerBlank, compact);
}

function compactDrawingRobot(spec: DrawingRobotGrading, maxChars: number): string | undefined {
  if (spec.targetEdges.length > 25 || maxChars > 24) return undefined;
  type Macro = { source: string; moves: string };
  const macros: Macro[] = [{ source: 'F', moves: 'F' }, { source: 'T', moves: 'T' }];
  const add = (source: string, moves: string) => {
    if (source.length <= maxChars && moves.length <= spec.maxCommands
      && !macros.some(macro => macro.source === source)) macros.push({ source, moves });
  };
  const bodies: string[] = [];
  for (let length = 2; length <= 4; length++) for (let bits = 0; bits < 1 << length; bits++) {
    const body = Array.from({ length }, (_, index) => bits & (1 << index) ? 'F' : 'T').join('');
    if (body.includes('F')) bodies.push(body);
  }
  for (const body of bodies) for (let count = 2; count <= Math.min(spec.maxRepeat, 9); count++) {
    if (body.length * count <= body.length + String(count).length + 2) continue;
    add(`${count}(${body})`, body.repeat(count));
  }
  const firstLayer = [...macros];
  for (const inner of firstLayer.filter(macro => macro.source.length >= 5 && macro.source.length <= 7)) {
    for (const suffix of ['', 'T', 'TT', 'F', 'FT']) for (const prefix of ['', 'F', 'T']) {
      const body = prefix + inner.source + suffix;
      const moves = prefix + inner.moves + suffix;
      for (let count = 2; count <= Math.min(spec.maxRepeat, 4); count++)
        if (body.length * count > body.length + String(count).length + 2) add(`${count}(${body})`, moves.repeat(count));
    }
  }
  const edgeKey = (a: Coord, b: Coord) => [a.join(','), b.join(',')].sort().join('|');
  const edges = new Map(spec.targetEdges.map(([a, b], index) => [edgeKey(a, b), index]));
  const targetMask = (1 << spec.targetEdges.length) - 1;
  const directions: Coord[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  type State = { x: number; y: number; facing: number; mask: number; source: string; cost: number };
  const start: State = { x: spec.start[0], y: spec.start[1], facing: ['up', 'right', 'down', 'left'].indexOf(spec.facing), mask: 0, source: '', cost: 0 };
  const buckets: State[][] = Array.from({ length: maxChars + 1 }, () => []);
  buckets[0].push(start);
  const signature = (state: State) => `${state.x},${state.y},${state.facing},${state.mask}`;
  const best = new Map([[signature(start), 0]]);
  let expanded = 0;
  for (let cost = 0; cost <= maxChars; cost++) for (const state of buckets[cost]) {
    if (best.get(signature(state)) !== cost) continue;
    if (state.mask === targetMask) return state.source;
    if (++expanded > 60_000) return undefined;
    for (const macro of macros) {
      const nextCost = cost + macro.source.length;
      if (nextCost > maxChars) continue;
      let x = state.x, y = state.y, facing = state.facing, mask = state.mask, valid = true;
      for (const token of macro.moves) {
        if (token === 'T') { facing = (facing + 1) % 4; continue; }
        const [dx, dy] = directions[facing];
        const next: Coord = [x + dx, y + dy];
        const index = edges.get(edgeKey([x, y], next));
        if (index === undefined) { valid = false; break; }
        mask |= 1 << index;
        x = next[0]; y = next[1];
      }
      if (!valid) continue;
      const successor: State = { x, y, facing, mask, source: state.source + macro.source, cost: nextCost };
      const key = signature(successor);
      if ((best.get(key) ?? Infinity) <= nextCost) continue;
      best.set(key, nextCost); buckets[nextCost].push(successor);
    }
  }
  return undefined;
}

function* boxRobots(spec: BoxStackRobotGrading): Generator<Assignment> {
  const boxes = spec.initial[0]?.length ?? 0;
  if (spec.initial.length === 3 && boxes > 0 && spec.initial.slice(1).every(stack => stack.length === 0)) {
    if (boxes <= spec.maxRepeat && 2 <= spec.maxRepeat)
      yield one(spec.answerBlank, `2(${boxes}(URDL)R)`);
    if (boxes % 2 === 0 && boxes / 2 <= spec.maxRepeat)
      yield one(spec.answerBlank, `${boxes / 2}(URDLURRDLL)`);
  }
  type State = { stacks: number[][]; room: number; held: number | null; path: string };
  const start: State = { stacks: spec.initial.map(stack => [...stack]), room: 0, held: null, path: '' };
  const queue = [start];
  const signature = (state: State) => `${state.room}|${state.held ?? '_'}|${state.stacks.map(stack => stack.join(',')).join(';')}`;
  const seen = new Set([signature(start)]);
  for (let at = 0; at < queue.length; at++) {
    const state = queue[at];
    if (state.held === null && state.stacks.every((stack, index) => stack.join(',') === spec.target[index].join(','))) {
      yield one(spec.answerBlank, compressCommands(state.path, spec.maxRepeat)); return;
    }
    if (state.path.length >= Math.min(spec.maxCommands, 100)) continue;
    for (const command of ['L', 'R', 'U', 'D'] as const) {
      const next: State = { stacks: state.stacks.map(stack => [...stack]), room: state.room, held: state.held, path: state.path + command };
      if (command === 'L') { if (state.room === 0) continue; next.room--; }
      else if (command === 'R') { if (state.room === state.stacks.length - 1) continue; next.room++; }
      else if (command === 'U') { if (state.held !== null || !next.stacks[state.room].length) continue; next.held = next.stacks[state.room].shift()!; }
      else { if (state.held === null) continue; next.stacks[state.room].unshift(state.held); next.held = null; }
      const key = signature(next);
      if (!seen.has(key)) { seen.add(key); queue.push(next); }
    }
  }
}

function* robotGrids(spec: RobotGridGrading): Generator<Assignment> {
  const world = spec.worlds[0];
  if (!world || spec.worlds.some(item => item.width !== world.width || item.height !== world.height)) return;
  const tokenFor = (dx: number, dy: number) => Object.entries(spec.dialect.commands)
    .filter(([, vector]) => vector[0] === dx && vector[1] === dy)
    .map(([token]) => token).sort((a, b) => a.length - b.length)[0];
  const up = tokenFor(0, -1), down = tokenFor(0, 1), left = tokenFor(-1, 0), right = tokenFor(1, 0);
  if (!up || !down || !left || !right || spec.dialect.repeatSyntax === 'none') return;
  const parens = spec.dialect.repeatSyntax === 'paren-number' || spec.dialect.repeatSyntax === 'both' ? ['(', ')'] : ['[', ']'];
  const rep = (body: string, count: number) => `${parens[0]}${body}${parens[1]}${count}`;
  const home = world.starts === 'all-free' ? rep(up, world.height) + rep(left, world.width) : '';
  const diagonalHome = world.starts === 'all-free' ? rep(left + up, Math.max(world.width, world.height)) : '';
  const horizontal = home + rep(rep(right, world.width) + down + rep(left, world.width), world.height);
  yield one(spec.answerBlank, horizontal);
  const vertical = home + rep(rep(down, world.height) + right + rep(up, world.height), world.width);
  yield one(spec.answerBlank, vertical);
  if (diagonalHome) yield one(spec.answerBlank, diagonalHome + horizontal.slice(home.length));
  // A reset between sweeps lets the robot go around a blocked central cell.
  const resetSweep = rep(rep(right, world.width) + down + rep(left, world.width)
    + up + rep(left, world.width) + down, world.height);
  yield one(spec.answerBlank, resetSweep);
  if (diagonalHome) yield one(spec.answerBlank, diagonalHome + resetSweep);
}

function* dieFaces(blankId: string): Generator<Assignment> {
  const render = (bits: number) => Array.from({ length: 3 }, (_, y) =>
    Array.from({ length: 3 }, (_, x) => bits & (1 << (3 * y + x)) ? 'o' : '.').join('')).join('/');
  const rotate = (bits: number) => {
    let result = 0;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++)
      if (bits & (1 << (3 * y + x))) result |= 1 << (3 * x + (2 - y));
    return result;
  };
  const seen = new Set<number>();
  const emit = function* (bits: number): Generator<Assignment> {
    if (seen.has(bits)) return;
    seen.add(bits); yield one(blankId, render(bits));
  };
  // Familiar die geometries first, in every orientation. The later loop still
  // covers every 3×3 pip arrangement without consulting an answer pattern.
  for (const positions of [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8],
    [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]]) {
    let bits = positions.reduce((mask, position) => mask | 1 << position, 0);
    for (let rotation = 0; rotation < 4; rotation++) { yield* emit(bits); bits = rotate(bits); }
  }
  for (let count = 0; count <= 9; count++) for (let bits = 0; bits < 1 << 9; bits++) {
    let pips = 0;
    for (let bit = bits; bit; bit &= bit - 1) pips++;
    if (pips === count) yield* emit(bits);
  }
}

function* cppLineRepairs(spec: CppLineRepairGrading): Generator<Assignment> {
  const lines = spec.source.split('\n');
  const proposals: { index: number; replacement: string; priority: number }[] = [];
  const seen = new Set<string>();
  const compact = (text: string) => text.trim().replace(/\s*([()\[\]+\-*/%<>=,;{}])\s*/g, '$1').replace(/\s+/g, ' ');
  const suggest = (index: number, replacement: string, priority: number) => {
    if (replacement && compact(replacement) !== compact(lines[index]))
      proposals.push({ index, replacement: compact(replacement), priority });
  };
  const emit = function* (index: number, replacement: string): Generator<Assignment> {
    const key = `${index}|${replacement}`;
    if (seen.has(key)) return;
    seen.add(key);
    yield { [spec.lineBlank]: String(spec.firstLine + index), [spec.replacementBlank]: replacement };
  };
  const arrayCapacities = [...spec.source.matchAll(/\b[A-Za-z_]\w*\s*\[\s*(\d+)\s*\]/g)]
    .map(match => Number(match[1])).filter(size => Number.isSafeInteger(size) && size > 0);
  const loopIndices = [...spec.source.matchAll(/\b(?:while|for)\s*\([^\n]*?\b([A-Za-z_]\w*)\s*(?:<|<=)/g)]
    .map(match => match[1]);
  for (const [index, original] of lines.entries()) {
    const line = original.trim();
    if (!line) continue;
    // Local AST-shaped edits: change a control statement, index offset,
    // relational boundary, or loop bound while preserving a complete line.
    if (/^if\s*\(/.test(line)) suggest(index, line.replace(/^if\b/, 'while'), 10);
    if (/^while\s*\(/.test(line)) suggest(index, line.replace(/^while\b/, 'if'), 35);
    const shiftedArray = /\b([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]\s*=\s*([A-Za-z_]\w*)\s*;/.exec(line);
    if (shiftedArray) for (const offset of ['+1', '-1'])
      suggest(index, line.replace(shiftedArray[0], `${shiftedArray[1]}[${shiftedArray[2]}${offset}]=${shiftedArray[3]};`), 5);
    for (const [from, to] of [['<=', '<'], ['>=', '>'], ['<', '<='], ['>', '>='], ['==', '!='], ['!=', '==']]) {
      if (!line.includes(from)) continue;
      const token = from === '<' ? /<(?![<=])/ : from === '>' ? />(?![>=])/ : new RegExp(from.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'));
      suggest(index, line.replace(token, to), 40);
    }
    const sizeBound = /\b([A-Za-z_]\w*)\s*<\s*([A-Za-z_]\w*)\.size\(\)\s*-\s*1/.exec(line);
    if (sizeBound) suggest(index, `${sizeBound[1]}+1<${sizeBound[2]}.size();`, 12);
    const forLoop = /\bfor\s*\(\s*([A-Za-z_]\w*)\s*=\s*(\d+)\s*;\s*\1\s*(<=|<)\s*\d+\s*;\s*\1\+\+\s*\)/.exec(line);
    if (forLoop) for (const capacity of arrayCapacities) {
      suggest(index, `for(${forLoop[1]}=${forLoop[2]};${forLoop[1]}<=${capacity - 1};${forLoop[1]}++)`, 18);
    }
    const halving = /^([A-Za-z_]\w*)\s*(?:=\s*\1\s*\/\s*2|\/=\s*2)\s*;?$/.exec(line);
    if (halving) {
      const params = /\b[A-Za-z_]\w*\s+\w+\s*\(([^)]*)\)/.exec(spec.source)?.[1] ?? '';
      for (const other of [...params.matchAll(/\b([A-Za-z_]\w*)\s*(?:,|$)/g)].map(match => match[1])) {
        if (other !== halving[1]) {
          suggest(index, `${other}+=${other};${halving[1]}/=2;`, 16);
          suggest(index, `${other}*=2;${halving[1]}/=2;`, 17);
        }
      }
    }
    const decrement = /^([A-Za-z_]\w*)\s*--\s*;?$/.exec(line);
    if (decrement) for (const variable of loopIndices) if (variable !== decrement[1])
      suggest(index, `${decrement[1]}--;${variable}--;`, 20);
    const increment = /^([A-Za-z_]\w*)\s*=\s*\1\s*\+\s*1\s*;?$/.exec(line);
    if (increment) {
      for (const condition of spec.source.matchAll(/\b(?:if|while)\s*\(\s*([A-Za-z_]\w*)\s*%\s*([A-Za-z_]\w*)\s*==\s*0\s*\)/g)) {
        if (condition[2] === increment[1]) suggest(index, `if(${condition[1]}%${increment[1]})${increment[1]}++;`, 23);
      }
    }
    const equality = /^if\s*\(\s*([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]\s*==\s*([A-Za-z_]\w*)\s*\)$/.exec(line);
    if (equality) {
      const bounds = /\bwhile\s*\(\s*([A-Za-z_]\w*)\s*<=\s*([A-Za-z_]\w*)\s*\)/.exec(spec.source);
      const upper = bounds && new RegExp(`\\b${bounds[2]}\\s*=\\s*([A-Za-z_]\\w*)\\s*-\\s*1`).exec(spec.source)?.[1];
      if (bounds && upper) suggest(index, `if(${bounds[1]}<${upper}&&${equality[1]}[${bounds[1]}]==${equality[3]})`, 14);
    }
    if (spec.mode === 'append' && /;\s*$/.test(line))
      for (const suffix of ['else;', ';', '}']) suggest(index, suffix, /\b(?:cout|printf)\b/.test(line) ? 15 : 45);
    if (line === '}' && /\bcontinue\b|\bwhile\b/.test(spec.source)) {
      const next = lines[index + 1] ?? '';
      for (const variable of loopIndices) if (new RegExp(`\\b${variable}\\b`).test(next))
        suggest(index, `${variable}++;continue;}`, 25);
    }
  }
  proposals.sort((a, b) => a.priority - b.priority || a.index - b.index);
  for (const proposal of proposals) yield* emit(proposal.index, proposal.replacement);
}

/** Candidates derived from the task constraints, never from accepted-answer lists. */
export function* semanticCandidates(question: Question): Generator<Assignment> {
  const spec = question.grading;
  switch (spec.kind) {
    case 'integer-list': yield* integerLists(spec); return;
    case 'matrix-sums': yield* matrices(spec); return;
    case 'grid-checkpoints': yield* gridCheckpoints(spec); return;
    case 'text-editor': {
      let command = '';
      for (let i = 0; i < spec.target.length; i++) {
        if (spec.initial[i] !== spec.target[i]) command += `m${spec.target[i]}`;
        if (i + 1 < spec.target.length) command += 'r';
      }
      yield one(spec.answerBlank, command); return;
    }
    case 'sparse-ruler': {
      const interior = Array.from({ length: spec.length - 1 }, (_, index) => index + 1);
      for (let count = 0; count <= spec.maxMarks - 2; count++) for (const positions of combinations(interior, count)) {
        const value = [0, ...positions, spec.length].join(' ');
        if (!checkSparseRuler(spec, value)) { yield one(spec.answerBlank, value); return; }
      }
      return;
    }
    case 'regular-polygon-graph': {
      const polygon = spec;
      function* visit(source: string, edges: number): Generator<Assignment> {
        if (source.length >= 2 && edges === polygon.totalEdges && !checkRegularPolygonGraph(polygon, source)) {
          yield one(polygon.answerBlank, source); return;
        }
        if (source.length >= 12 || edges >= polygon.totalEdges) return;
        for (let side = 3; side <= 6; side++) {
          if (source.length > 1 && Number(source.at(-1)) % 2 !== 0) continue;
          const next = edges + side - Number(Boolean(source));
          if (next <= polygon.totalEdges) yield* visit(source + side, next);
        }
      }
      yield* visit('', 0); return;
    }
    case 'drawing-robot': yield* drawingRobot(spec, question.blanks.find(blank => blank.id === spec.answerBlank)?.maxChars ?? 16); return;
    case 'robot-grid': yield* robotGrids(spec); return;
    case 'die-face': yield* dieFaces(spec.answerBlank); return;
    case 'cpp-line-repair': yield* cppLineRepairs(spec); return;
    case 'box-stack-robot': yield* boxRobots(spec); return;
    case 'river-route': yield* riverRoutes(spec); return;
    case 'signed-wrap-sum': {
      const first = Math.min(spec.maximum, spec.requiredSum - spec.minimum);
      const second = spec.requiredSum - first;
      if (first >= spec.minimum && second >= spec.minimum && second <= spec.maximum) {
        yield { [spec.answerBlanks[0]]: String(first), [spec.answerBlanks[1]]: String(second) };
      }
      return;
    }
    case 'coin-counterexample': {
      for (let largest = 3; largest <= spec.largestLimit; largest++) for (let middle = 2; middle < largest; middle++) {
        const coins = [1, middle, largest];
        let left = spec.amount, greedy = 0;
        for (const coin of [...coins].reverse()) { greedy += Math.floor(left / coin); left %= coin; }
        const dp = Array<number>(spec.amount + 1).fill(Infinity); dp[0] = 0;
        for (let amount = 1; amount <= spec.amount; amount++) for (const coin of coins)
          if (amount >= coin) dp[amount] = Math.min(dp[amount], 1 + dp[amount - coin]);
        if (greedy > dp[spec.amount]) yield { [spec.middleBlank]: String(middle), [spec.largestBlank]: String(largest) };
      }
      return;
    }
    case 'counterexample-max': {
      const candidates = spec.residues.map(residue => spec.maximum - ((spec.maximum - residue) % spec.modulus + spec.modulus) % spec.modulus);
      yield one(spec.answerBlank, String(Math.max(...candidates))); return;
    }
    case 'string-replacement-counterexample': yield one(spec.answerBlank, spec.needle.repeat(2)); return;
    case 'top-two-counterexample': {
      const values = [spec.maximum, spec.maximum, ...Array.from({ length: Math.max(0, spec.count - 2) }, (_, i) => Math.max(spec.minimum, spec.maximum - i - 1))];
      const candidate = values.slice(0, spec.count).join(' ');
      if (!checkTopTwoCounterexample(spec, candidate)) yield one(spec.answerBlank, candidate);
      return;
    }
    case 'prime-factor-count-counterexample': {
      for (let n = spec.minimum; n <= spec.maximum && n < spec.minimum + 100_000; n++)
        if (!checkPrimeFactorCountCounterexample(spec, String(n))) { yield one(spec.answerBlank, String(n)); return; }
      return;
    }
    case 'prime-power-pair': {
      const primePower = (number: number) => {
        let n = number, distinct = 0;
        for (let d = 2; d * d <= n; d++) if (n % d === 0) { distinct++; while (n % d === 0) n /= d; }
        if (n > 1) distinct++;
        return distinct === 1;
      };
      let yes: number | undefined, no: number | undefined;
      for (let n = spec.minimum; n <= spec.maximum && (yes === undefined || no === undefined); n++) {
        if (primePower(n)) yes ??= n; else no ??= n;
      }
      if (yes !== undefined && no !== undefined) yield { [spec.correctBlank]: String(yes), [spec.incorrectBlank]: String(no) };
      return;
    }
    case 'difference-pyramid': {
      for (const values of permutations(spec.values)) {
        const candidate = values.join(' ');
        if (!checkDifferencePyramid(spec, candidate)) { yield one(spec.answerBlank, candidate); return; }
      }
      return;
    }
    case 'graph-labeling': {
      const labels = Array.from({ length: spec.nodes.length }, (_, i) => i + 1);
      for (const values of permutations(labels)) {
        const candidate = values.join(' ');
        if (!checkGraphLabeling(spec, candidate)) { yield one(spec.answerBlank, candidate); return; }
      }
      return;
    }
    case 'triple-sort-network': {
      const orders = [...permutations(spec.variables.map((_, index) => index))];
      for (const names of permutations(spec.variables)) {
        const selected = names.slice(0, spec.answerCount);
        const calls = spec.calls.map(call => call.flatMap(name => name === spec.answerToken ? selected : [name]));
        if (calls.some(call => call.length !== 3 || new Set(call).size !== 3)) continue;
        const works = orders.every(order => {
          const values = new Map(spec.variables.map((name, index) => [name, order[index]]));
          for (const call of calls) {
            const sorted = call.map(name => values.get(name)!).sort((a, b) => a - b);
            call.forEach((name, index) => values.set(name, sorted[index]));
          }
          return spec.variables.every((name, index) => values.get(name) === index);
        });
        if (works) { yield one(spec.answerBlank, selected.map(name => `&${name}`).join(',')); return; }
      }
      return;
    }
    case 'graph-reversal': {
      const labels = spec.edges.map(edge => edge.label);
      for (let count = 1; count <= labels.length; count++) for (const chosen of combinations(labels, count)) {
        const candidate = chosen.join(',');
        if (!checkGraphReversal(spec, candidate)) { yield one(spec.answerBlank, candidate); return; }
      }
      return;
    }
    case 'graph': {
      const base = new Set(spec.baseEdges.map(edge => edge.join('|')));
      const edges = spec.allowedAddedEdges ?? spec.nodes.flatMap(from => spec.nodes.flatMap(to =>
        from !== to && !base.has(`${from}|${to}`) ? [[from, to] as [string, string]] : []));
      const count = spec.assertions.addedEdgeCount ?? 1;
      for (const chosen of combinations(edges, count)) {
        const candidate = JSON.stringify(chosen);
        if (!checkGraph(spec, candidate)) { yield one(spec.answerBlank, candidate); return; }
      }
      return;
    }
    case 'boolean-circuit': {
      const atoms = ['A', 'B', 'NOT A', 'NOT B'];
      for (const value of atoms) if (!checkBooleanCircuit(spec, value)) { yield one(spec.answerBlank, value); return; }
      const operators = ['AND', 'OR', 'XOR', 'XNOR'];
      const costs: Record<string, number> = { AND: 3, OR: 1, XOR: 2, XNOR: 2 };
      const inner: { text: string; cost: number }[] = [];
      for (const op of operators) for (const left of atoms) for (const right of atoms) {
        const value = `${left} ${op} ${right}`;
        if (!checkBooleanCircuit(spec, value)) { yield one(spec.answerBlank, value); return; }
        const cost = costs[op] + (left.startsWith('NOT') ? 5 : 0) + (right.startsWith('NOT') ? 5 : 0);
        if (cost < spec.maxCost) inner.push({ text: `(${value})`, cost });
      }
      for (const inside of inner) for (const atom of ['A', 'B']) for (const op of operators) {
        if (inside.cost + costs[op] > spec.maxCost) continue;
        for (const value of [`${atom} ${op} ${inside.text}`, `${inside.text} ${op} ${atom}`]) {
          if (!checkBooleanCircuit(spec, value)) { yield one(spec.answerBlank, value); return; }
        }
      }
      return;
    }
  }
}
