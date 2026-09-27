/** Small RFC 4180 parser/writer so the offline judge needs no service. */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  const finishField = () => { row.push(field); field = ''; closedQuote = false; };
  const finishRow = () => { finishField(); rows.push(row); row = []; };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += ch;
    } else if (ch === '"') {
      if (field || closedQuote) throw new Error('Malformed CSV quote');
      quoted = true;
    } else if (ch === ',') finishField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      finishRow();
    } else {
      if (closedQuote) throw new Error('Characters after CSV closing quote');
      field += ch;
    }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length || closedQuote) finishRow();
  return rows;
}

export function writeCsv(rows: string[][]): string {
  return rows.map(row => row.map(value => {
    const string = String(value ?? '');
    return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
  }).join(',')).join('\r\n') + '\r\n';
}
