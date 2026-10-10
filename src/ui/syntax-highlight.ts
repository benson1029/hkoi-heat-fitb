export type SyntaxTokenType = 'comment' | 'string' | 'number' | 'keyword' | 'operator';
export type SyntaxToken = { text: string; type?: SyntaxTokenType };

function normalizedLanguage(language: string): 'python' | 'cpp' | 'other' {
  const normalized = language.toLowerCase().replace(/^language-/, '').split(/[-_]/)[0];
  if (['py', 'python'].includes(normalized)) return 'python';
  if (['c', 'cc', 'cpp', 'cxx', 'c++'].includes(normalized)) return 'cpp';
  return 'other';
}

export function tokenizeCode(text: string, language = 'cpp'): SyntaxToken[] {
  const kind = normalizedLanguage(language);
  const pattern = kind === 'python'
    ? /(#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|self|True|try|while|with|yield|None|print|str)\b|\b\d+(?:\.\d+)?\b|\/\/|(?:\*\*|==|!=|<=|>=|[+*/%<>=-]))/g
    : kind === 'cpp'
      ? /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:alignas|and|auto|bool|break|case|class|const|continue|double|else|enum|false|float|for|if|include|int|long|namespace|nullptr|return|static|std|struct|template|true|using|void|while|print|self|str)\b|\b\d+(?:\.\d+)?\b)/g
      : /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b)/g;

  const tokens: SyntaxToken[] = [];
  let previous = 0;
  for (const match of text.matchAll(pattern)) {
    const position = match.index ?? 0;
    if (position > previous) tokens.push({ text: text.slice(previous, position) });
    const token = match[0];
    const type: SyntaxTokenType = token.startsWith(kind === 'python' ? '#' : '//') ? 'comment'
      : token.startsWith('"') || token.startsWith("'") ? 'string'
      : /^\d/.test(token) ? 'number'
      : kind === 'python' && (token === '//' || /^[+*/%<>=!-]/.test(token)) ? 'operator'
      : kind === 'python' ? 'keyword' : 'keyword';
    tokens.push({ text: token, type });
    previous = position + token.length;
  }
  if (previous < text.length) tokens.push({ text: text.slice(previous) });
  return tokens;
}
