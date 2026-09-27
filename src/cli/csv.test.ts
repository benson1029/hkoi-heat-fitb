import { expect, it } from 'vitest';
import { parseCsv, writeCsv } from './csv';

it('round trips quoted newlines, commas, and quotes', () => {
  const rows = [['id', 'answer'], ['one', 'a,b\n"c"'], ['two', '']];
  expect(parseCsv(writeCsv(rows))).toEqual(rows);
});
