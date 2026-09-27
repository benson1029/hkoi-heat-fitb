import type { UniformCppExpressionGrading } from '../../core/types';
import { CppFault, lex, Parser, type Expr } from '../cpp/syntax';

type Verdict = { status: 'pass' | 'fail' | 'inconclusive'; message?: string };
type Distribution = { weights: Map<bigint, bigint>; draws: number };

const INT_MIN = -(1n << 31n);
const INT_MAX = (1n << 31n) - 1n;
const MAX_PAIRS = 500_000;
const MAX_VALUES = 100_000;

function checked(value: bigint): bigint {
  if (value < INT_MIN || value > INT_MAX) throw new CppFault('runtime-error', 'Signed 32-bit overflow');
  return value;
}

function singleton(value: bigint): Distribution {
  return { weights: new Map([[checked(value), 1n]]), draws: 0 };
}

function operate(op: string, a: bigint, b: bigint): bigint {
  switch (op) {
    case '+': return checked(a + b);
    case '-': return checked(a - b);
    case '*': return checked(a * b);
    case '/':
      if (b === 0n) throw new CppFault('runtime-error', 'Division by zero for a possible random draw');
      return checked(a / b);
    case '%':
      if (b === 0n) throw new CppFault('runtime-error', 'Remainder by zero for a possible random draw');
      return checked(a % b);
    default: throw new CppFault('unsupported', `Operator ${op} is outside the uniform-expression grammar`);
  }
}

function distribution(expr: Expr, grading: UniformCppExpressionGrading, budget: { pairs: number }): Distribution {
  switch (expr.kind) {
    case 'number':
      if (expr.long || expr.value > INT_MAX) throw new CppFault('unsupported', 'Long integer arithmetic is not modeled by this grader');
      return singleton(expr.value);
    case 'char': return singleton(expr.value);
    case 'call': {
      if (expr.name !== grading.randomFunction || expr.args.length) throw new CppFault('unsupported', `Only ${grading.randomFunction}() is modeled`);
      const weights = new Map<bigint, bigint>();
      for (let value = grading.randomMin; value <= grading.randomMax; value++) weights.set(BigInt(value), 1n);
      return { weights, draws: 1 };
    }
    case 'unary': {
      if (expr.postfix || !['+', '-'].includes(expr.op)) throw new CppFault('unsupported', `Unary ${expr.op} is outside the uniform-expression grammar`);
      const inner = distribution(expr.arg, grading, budget);
      const weights = new Map<bigint, bigint>();
      for (const [value, weight] of inner.weights) {
        const result = expr.op === '-' ? checked(-value) : value;
        weights.set(result, (weights.get(result) ?? 0n) + weight);
      }
      return { weights, draws: inner.draws };
    }
    case 'binary': {
      const left = distribution(expr.left, grading, budget);
      const right = distribution(expr.right, grading, budget);
      const draws = left.draws + right.draws;
      if (draws > grading.maxCalls) throw new CppFault('unsupported', 'Too many independent random calls for exact enumeration');
      budget.pairs += left.weights.size * right.weights.size;
      if (budget.pairs > MAX_PAIRS) throw new CppFault('unsupported', 'Exact distribution work limit exceeded');
      const weights = new Map<bigint, bigint>();
      for (const [a, aWeight] of left.weights) for (const [b, bWeight] of right.weights) {
        const result = operate(expr.op, a, b);
        weights.set(result, (weights.get(result) ?? 0n) + aWeight * bWeight);
      }
      if (weights.size > MAX_VALUES) throw new CppFault('unsupported', 'Exact distribution value limit exceeded');
      return { weights, draws };
    }
    default: throw new CppFault('unsupported', `Expression form ${expr.kind} is outside the uniform-expression grammar`);
  }
}

/** Exact finite distribution for arithmetic expressions of independent, uniform f() calls. */
export function checkUniformCppExpression(grading: UniformCppExpressionGrading, answer: string): Verdict {
  try {
    const unit = new Parser(lex(`int g() { return ${answer}; }`), 'cpp').parse();
    const statements = unit.functions.get('g')?.body;
    if (unit.globals.length || unit.functions.size !== 1 || statements?.kind !== 'block' || statements.statements.length !== 1 || statements.statements[0].kind !== 'return' || !statements.statements[0].value) {
      return { status: 'fail', message: 'Enter one C++ expression.' };
    }
    const result = distribution(statements.statements[0].value, grading, { pairs: 0 });
    const width = BigInt(grading.outputMax - grading.outputMin + 1);
    const draws = BigInt(grading.randomMax - grading.randomMin + 1) ** BigInt(result.draws);
    if (draws % width !== 0n) return { status: 'fail', message: 'The output cannot be uniform over the required range.' };
    const perValue = draws / width;
    for (let value = grading.outputMin; value <= grading.outputMax; value++) {
      if (result.weights.get(BigInt(value)) !== perValue) return { status: 'fail', message: 'The output distribution is not uniform over the required range.' };
    }
    if (result.weights.size !== Number(width)) return { status: 'fail', message: 'The expression can return values outside the required range.' };
    return { status: 'pass' };
  } catch (error) {
    if (error instanceof CppFault) return {
      status: error.kind === 'unsupported' ? 'inconclusive' : 'fail',
      message: error.message
    };
    return { status: 'inconclusive', message: error instanceof Error ? error.message : String(error) };
  }
}
