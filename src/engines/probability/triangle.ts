type Rational = { n: bigint; d: bigint };
type Affine = { x: Rational; y: Rational; c: Rational };
export type TriangleCheck = { status: 'pass' | 'fail' | 'inconclusive'; message?: string };

const gcd = (a: bigint, b: bigint): bigint => b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
function fraction(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new Error('Division by zero');
  if (d < 0n) { n = -n; d = -d; }
  const factor = gcd(n, d);
  return { n: n / factor, d: d / factor };
}
const zero = fraction(0n), one = fraction(1n);
const add = (a: Rational, b: Rational) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const neg = (a: Rational) => fraction(-a.n, a.d);
const mul = (a: Rational, b: Rational) => fraction(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => fraction(a.n * b.d, a.d * b.n);
const same = (a: Rational, b: Rational) => a.n === b.n && a.d === b.d;
const constant = (c: Rational): Affine => ({ x: zero, y: zero, c });
const plus = (a: Affine, b: Affine): Affine => ({ x: add(a.x, b.x), y: add(a.y, b.y), c: add(a.c, b.c) });
const negative = (a: Affine): Affine => ({ x: neg(a.x), y: neg(a.y), c: neg(a.c) });
const isConstant = (a: Affine) => same(a.x, zero) && same(a.y, zero);
const scaled = (a: Affine, k: Rational): Affine => ({ x: mul(a.x, k), y: mul(a.y, k), c: mul(a.c, k) });

class Unsupported extends Error {}
class Parser {
  private tokens: string[] = [];
  private at = 0;
  constructor(source: string) {
    let rest = source;
    while (rest.trim()) {
      const match = /^\s*(\d+(?:\.\d+)?|\.\d+|[xy()+\-*/,])/.exec(rest);
      if (!match) throw new Unsupported('Expression is outside the affine arithmetic subset.');
      this.tokens.push(match[1]);
      rest = rest.slice(match[0].length);
    }
  }
  private peek() { return this.tokens[this.at]; }
  private take() { return this.tokens[this.at++]; }
  private need(token: string) { if (this.take() !== token) throw new Error(`Expected ${token}.`); }
  pair(): [Affine, Affine] {
    const first = this.expr();
    this.need(',');
    const second = this.expr();
    if (this.peek() !== undefined) throw new Error('Unexpected text after coordinate pair.');
    return [first, second];
  }
  private expr(): Affine {
    let value = this.term();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.take();
      const right = this.term();
      value = plus(value, op === '+' ? right : negative(right));
    }
    return value;
  }
  private term(): Affine {
    let value = this.unary();
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.take();
      const right = this.unary();
      if (op === '*') {
        if (isConstant(value)) value = scaled(right, value.c);
        else if (isConstant(right)) value = scaled(value, right.c);
        else throw new Unsupported('Nonlinear coordinate expression needs a separate proof.');
      } else {
        if (!isConstant(right)) throw new Unsupported('Division by a variable needs a separate proof.');
        value = scaled(value, div(one, right.c));
      }
    }
    return value;
  }
  private unary(): Affine {
    if (this.peek() === '+') { this.take(); return this.unary(); }
    if (this.peek() === '-') { this.take(); return negative(this.unary()); }
    const token = this.take();
    if (token === 'x') return { x: one, y: zero, c: zero };
    if (token === 'y') return { x: zero, y: one, c: zero };
    if (token === '(') { const value = this.expr(); this.need(')'); return value; }
    if (token && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) {
      const [whole, decimal = ''] = token.split('.');
      return constant(fraction(BigInt((whole || '0') + decimal), 10n ** BigInt(decimal.length)));
    }
    throw new Error('Expected a coordinate expression.');
  }
}

function at(map: Affine, x: bigint, y: bigint): Rational {
  return add(add(mul(map.x, fraction(x)), mul(map.y, fraction(y))), map.c);
}

/** Exact affine proof: the upper triangle's vertices must permute the lower triangle's vertices. */
export function checkTriangleAffine(answer: string): TriangleCheck {
  let maps: [Affine, Affine];
  try { maps = new Parser(answer).pair(); }
  catch (error) {
    if (error instanceof Unsupported) return { status: 'inconclusive', message: error.message };
    return { status: 'fail', message: error instanceof Error ? error.message : String(error) };
  }
  const upper: [bigint, bigint][] = [[1n, 0n], [0n, 1n], [1n, 1n]];
  const lower = new Set(['0,0', '1,0', '0,1']);
  const images = upper.map(([x, y]) => {
    const a = at(maps[0], x, y), b = at(maps[1], x, y);
    return `${a.n}/${a.d},${b.n}/${b.d}`;
  });
  const expected = new Set([...lower].map(value => value.split(',').map(part => `${part}/1`).join(',')));
  if (new Set(images).size !== 3 || images.some(value => !expected.has(value))) {
    return { status: 'fail', message: 'The affine map does not send the upper triangle bijectively onto the lower triangle.' };
  }
  return { status: 'pass' };
}
