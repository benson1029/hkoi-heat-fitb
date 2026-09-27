import type { Coord, RobotGridGrading, RobotWorld } from '../../core/types';

const coordKey = ([x, y]: Coord): string => `${x},${y}`;

function parseCommands(answer: string, spec: RobotGridGrading, maxMoves: number): string[] {
  const tokens = Object.keys(spec.dialect.commands).sort((a, b) => b.length - a.length);
  if (!tokens.length || tokens.some(token => !token.length)) throw new Error('Robot dialect has no valid commands.');
  let index = 0;
  const sequence = (close: string | null): string[] => {
    const moves: string[] = [];
    while (index < answer.length) {
      const char = answer[index];
      if (/\s/.test(char)) { index++; continue; }
      if (char === ']' || char === ')') {
        if (close !== char) throw new Error('Unexpected closing bracket.');
        index++;
        return moves;
      }
      const bracketAllowed = char === '[' && ['bracket-number', 'both'].includes(spec.dialect.repeatSyntax);
      const parenAllowed = char === '(' && ['paren-number', 'both'].includes(spec.dialect.repeatSyntax);
      if (bracketAllowed || parenAllowed) {
        index++;
        const inner = sequence(char === '[' ? ']' : ')');
        const match = /^[1-9]\d*/.exec(answer.slice(index));
        if (!match) throw new Error('A repeat bracket needs a number.');
        index += match[0].length;
        const repetitions = Number(match[0]);
        if (!Number.isSafeInteger(repetitions) || repetitions > (spec.dialect.maxRepeat ?? maxMoves)) {
          throw new Error('Repeat count exceeds dialect limit.');
        }
        if (moves.length + inner.length * repetitions > maxMoves) throw new Error('Move limit exceeded.');
        for (let i = 0; i < repetitions; i++) moves.push(...inner);
        continue;
      }
      const token = tokens.find(candidate => answer.startsWith(candidate, index));
      if (!token) throw new Error(`Unknown command at character ${index + 1}.`);
      index += token.length;
      moves.push(token);
      if (moves.length > maxMoves) throw new Error('Move limit exceeded.');
    }
    if (close) throw new Error('Unclosed repeat bracket.');
    return moves;
  };
  return sequence(null);
}

function checkWorld(moves: string[], spec: RobotGridGrading, world: RobotWorld): string | null {
  const inBounds = ([x, y]: Coord) => x >= 0 && y >= 0 && x < world.width && y < world.height;
  const blocked = new Set(world.blocked.map(coordKey));
  const free = new Set<string>();
  for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
    const key = coordKey([x, y]);
    if (!blocked.has(key)) free.add(key);
  }
  const starts: Coord[] = world.starts === 'all-free'
    ? [...free].map(key => key.split(',').map(Number) as Coord)
    : world.starts;
  const required = new Set((world.requiredVisited === 'all-free'
    ? [...free].map(key => key.split(',').map(Number) as Coord)
    : world.requiredVisited ?? []).map(coordKey));
  for (const start of starts) {
    if (!inBounds(start) || blocked.has(coordKey(start))) return `World ${world.id} has an invalid start.`;
    let position: Coord = [...start];
    const visited = new Set([coordKey(position)]);
    for (const move of moves) {
      const [dx, dy] = spec.dialect.commands[move];
      const next: Coord = [position[0] + dx, position[1] + dy];
      if (!inBounds(next) || blocked.has(coordKey(next))) {
        if (spec.dialect.invalidMove === 'error') return `Invalid move in world ${world.id} from ${coordKey(position)}.`;
      } else {
        position = next;
        visited.add(coordKey(position));
      }
    }
    if (world.finalPosition && coordKey(position) !== coordKey(world.finalPosition)) {
      return `Wrong final position in world ${world.id}, starting at ${coordKey(start)}.`;
    }
    for (const cell of required) if (!visited.has(cell)) {
      return `Cell ${cell} was not visited in world ${world.id}, starting at ${coordKey(start)}.`;
    }
  }
  return null;
}

export function checkRobot(spec: RobotGridGrading, answer: string): string | null {
  for (const world of spec.worlds) {
    let moves: string[];
    try { moves = parseCommands(answer, spec, world.maxMoves); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
    const result = checkWorld(moves, spec, world);
    if (result) return result;
  }
  return null;
}
