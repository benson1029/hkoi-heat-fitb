import { describe, expect, it } from 'vitest';
import { tokenizeCode } from './syntax-highlight';

describe('language aware syntax highlighting', () => {
  it('treats Python floor division as an operator and hash comments as comments', () => {
    const tokens = tokenizeCode('return value // 2 # keep this', 'python');

    expect(tokens.filter((token) => token.type).map(({ text, type }) => [text, type])).toEqual([
      ['return', 'keyword'], ['//', 'operator'],
      ['2', 'number'], ['# keep this', 'comment'],
    ]);
  });

  it('recognizes Python keywords and strings without treating // as a comment', () => {
    const tokens = tokenizeCode('def solve():\n    return "ok" // 2', 'language-python');

    expect(tokens.some((token) => token.text === 'def' && token.type === 'keyword')).toBe(true);
    expect(tokens.some((token) => token.text === '"ok"' && token.type === 'string')).toBe(true);
    expect(tokens.some((token) => token.text === '//' && token.type === 'operator')).toBe(true);
    expect(tokens.some((token) => token.type === 'comment')).toBe(false);
  });

  it('keeps C++ line comments as comments', () => {
    const tokens = tokenizeCode('int main() { // comment\n}', 'cpp');

    expect(tokens.some((token) => token.text === '// comment' && token.type === 'comment')).toBe(true);
  });
});
