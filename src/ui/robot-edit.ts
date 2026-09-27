export interface RobotEdit {
  value: string;
  cursor: number;
}

function selection(value: string, start: number, end: number): [number, number] {
  const first = Math.min(Math.max(0, start), value.length);
  const last = Math.min(Math.max(first, end), value.length);
  return [first, last];
}

export function insertRobotToken(value: string, start: number, end: number, token: string, maxChars?: number): RobotEdit | null {
  const [first, last] = selection(value, start, end);
  const next = value.slice(0, first) + token + value.slice(last);
  if (maxChars !== undefined && Array.from(next).length > maxChars) return null;
  return { value: next, cursor: first + token.length };
}

export function deleteBeforeCursor(value: string, start: number, end: number): RobotEdit | null {
  const [first, last] = selection(value, start, end);
  if (first === 0 && last === 0) return null;
  const previous = first === last ? Array.from(value.slice(0, first)).at(-1)?.length ?? 1 : 0;
  const cursor = first - previous;
  return { value: value.slice(0, cursor) + value.slice(last), cursor };
}
