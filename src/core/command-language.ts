/** Expand a tiny, bounded prefix-repeat language such as 2(FT). */
export function parsePrefixRepeatCommands(source: string, alphabet: string, maxRepeat: number, maxCommands: number): { commands?: string[]; error?: string } {
  if (source.length > 2_000) return { error: 'The command is too long.' };
  let at = 0;
  const letters = new Set(alphabet);
  function sequence(depth: number): string[] {
    if (depth > 20) throw new Error('Too many nested repeats.');
    const output: string[] = [];
    while (at < source.length && source[at] !== ')') {
      const token = source[at];
      if (/\s/.test(token)) { at++; continue; }
      if (letters.has(token)) { output.push(token); at++; }
      else if (/\d/.test(token)) {
        const digits = /^\d+/.exec(source.slice(at))![0];
        const times = Number(digits);
        at += digits.length;
        if (!Number.isSafeInteger(times) || times < 0 || times > maxRepeat || source[at++] !== '(') throw new Error('Invalid repeat count or group.');
        const inner = sequence(depth + 1);
        if (source[at++] !== ')' || inner.length === 0) throw new Error('Incomplete repeat group.');
        if (output.length + inner.length * times > maxCommands) throw new Error('Command step limit exceeded.');
        for (let i = 0; i < times; i++) output.push(...inner);
      } else throw new Error('Unknown command character.');
      if (output.length > maxCommands) throw new Error('Command step limit exceeded.');
    }
    return output;
  }
  try {
    const commands = sequence(0);
    if (at !== source.length) throw new Error('Unexpected closing parenthesis.');
    return { commands };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
