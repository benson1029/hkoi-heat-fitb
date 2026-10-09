import type { Question } from '../core/types';

function* permutations(symbols: string[], prefix = ''): Generator<string> {
  if (!symbols.length) { yield prefix; return; }
  for (let i = 0; i < symbols.length; i++)
    yield* permutations([...symbols.slice(0, i), ...symbols.slice(i + 1)], prefix + symbols[i]);
}

/** Bounded, printed-text-guided candidates for literal answers. Never consults grading.accepted. */
export function* generateLiteralCandidates(question: Question, blankId: string, contextText = ''): Generator<string> {
  if (question.grading.kind !== 'literal') return;
  const locatedBlank = question.blanks.find(item => item.id === blankId);
  if (!locatedBlank) return;
  const blank = locatedBlank;
  const printed = [question.prompt.en, question.prompt.zh ?? '', question.displayCode?.cpp ?? '',
    question.displayCode?.c ?? '', question.displayCode?.python ?? '', contextText].join('\n');
  const maxChars = Math.min(blank.maxChars ?? 80, 120);
  const seen = new Set<string>();
  function* emit(value: string): Generator<string> {
    const count = [...value].filter(char => !blank.maxCharsExcludeWhitespace || !/\s/.test(char)).length;
    if (!value || count > maxChars || seen.has(value)) return;
    if (blank.allowedChars && [...value].some(char => !blank.allowedChars!.includes(char))) return;
    if (blank.forbiddenChars && [...value].some(char => blank.forbiddenChars!.includes(char))) return;
    seen.add(value); yield value;
  }

  const truthQuestion = /\b(?:truth values?|boolean values?|true\s*\/\s*false|T\s*\/\s*F)\b/i.test(printed);
  const mentionedSymbols = [...new Set([...printed.matchAll(/(?:^|[\s,'"(])([A-Z])(?=$|[\s,'")])/g)].map(match => match[1]))];
  const labelledBlanks = [...printed.matchAll(/\b([a-zA-Z])\s*=\s*(?:__+|\.{2,})/g)].length;
  const truthCount = Math.min(5, Math.max(mentionedSymbols.length, labelledBlanks));
  if (truthQuestion && truthCount >= 2) {
    for (let mask = 0; mask < 1 << truthCount; mask++) {
      const bits = Array.from({ length: truthCount }, (_, i) => Boolean(mask & (1 << i)));
      for (const [yes, no] of [['T', 'F'], ['true', 'false'], ['1', '0']]) {
        const items = bits.map(bit => bit ? yes : no);
        for (const separator of ['', ',', ' ', ', ']) yield* emit(items.join(separator));
      }
    }
  }

  const asksString = /\b(?:what is the \d+(?:st|nd|rd|th) string|which string|write (?:down )?the string)\b/i.test(printed);
  const alphabet = mentionedSymbols.filter(symbol => /^[A-Z]$/.test(symbol)).sort();
  if (asksString && alphabet.length >= 3 && alphabet.length <= 6)
    for (const candidate of permutations(alphabet)) yield* emit(candidate);

  for (const match of printed.matchAll(/["'“”‘’]([^"'“”‘’\n]{1,48})["'“”‘’]/g)) {
    yield* emit(match[1]);
  }
  const printedNumbers = [...new Set([...printed.matchAll(/(?<![\w.])-?\d+(?![\w.])/g)].map(match => Number(match[0])))]
    .filter(number => Number.isSafeInteger(number) && Math.abs(number) <= 100000);
  for (const number of printedNumbers) {
    for (const offset of [0, -1, 1]) yield* emit(String(number + offset));
  }
  // Short binary words must precede the broad decimal sweep. Otherwise the
  // useful words fall beyond a practical browser-worker candidate budget.
  if (/\b(?:binary|bits?|0\s*(?:and|or|,)\s*1)\b/i.test(printed)) {
    for (let length = 1; length <= 8; length++) for (let value = 0; value < 1 << length; value++)
      yield* emit(value.toString(2).padStart(length, '0'));
  }
  const asksNumber = /\b(?:how many|number of|what is the rank|how long|how much|output|digits?)\b/i.test(printed);
  if (asksNumber || !asksString) {
    for (let value = 0; value <= 127; value++) yield* emit(String(value));
    for (const value of [128, 144, 200, 255, 256, 365, 512, 999, 1000, 1024]) yield* emit(String(value));
    for (let value = 128; value <= 999; value++) yield* emit(String(value));
  }

  // Binary strings and short output sequences use only symbols that the
  // question itself names. They are bounded independently of maxChars.
  if (/\b(?:respectively|outputs?\s+(?:for|if)|following outputs?)\b/i.test(printed)) {
    const values = [...new Set([...printedNumbers.filter(value => value >= -9 && value <= 20), ...Array.from({ length: 10 }, (_, i) => i)])].slice(0, 12);
    for (const a of values) for (const b of values) {
      for (const separator of [',', ' ', ', ', '\n', ';']) yield* emit(`${a}${separator}${b}`);
    }
  }
  if (!asksString && alphabet.length >= 3 && alphabet.length <= 6)
    for (const candidate of permutations(alphabet)) yield* emit(candidate);
}
