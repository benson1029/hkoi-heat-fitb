/** Version 1 public paper and grader contract. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type Language = 'python' | 'cpp' | 'c';
export type Coord = [number, number];
export type Edge = [string, string];

export interface SourceRef {
  paperUrl?: string;
  answerSheetUrl?: string;
  page?: number;
  note?: string;
}

export interface PaperConfig {
  schemaVersion: 1;
  paper: {
    id: string;
    season: string;
    division: 'junior' | 'senior';
    title?: string;
    source?: SourceRef;
  };
  tracks: Track[];
  contexts?: PaperContext[];
  questions: Question[];
}

export interface PaperContext {
  id: string;
  track: string;
  title?: string;
  /** Safe Markdown shown once before its grouped questions. */
  markdown: string;
  /** Printed code shared by separately scored questions. Markers, when present, name blank IDs or answer-set slots. */
  displayCode?: Partial<Record<Language, string>>;
  /** For alternative subparts that fill the same printed code slots differently. */
  answerSets?: { questionId: string; label: string; bindings: Record<string, string> }[];
}

export interface DirectedGraphFigure {
  kind: 'directed-graph';
  nodes: { id: string; x: number; y: number }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface UndirectedGraphFigure {
  kind: 'undirected-graph';
  nodes: { id: string; x: number; y: number }[];
  edges: { from: string; to: string; label?: string }[];
}

export interface PaperImageFigure {
  kind: 'paper-image';
  /** Path under the bundled public directory, without the deployment base URL. */
  path: string;
  alt: string;
}

export type PaperFigure = DirectedGraphFigure | UndirectedGraphFigure | PaperImageFigure;

export interface Track {
  id: string;
  label: string;
  selection: 'required' | 'choice';
  choiceGroup?: string;
}

export interface Blank {
  id: string;
  label?: string;
  maxChars?: number;
  /** Printed limit ignores spaces and other whitespace. */
  maxCharsExcludeWhitespace?: boolean;
  forbiddenChars?: string;
  forbiddenIdentifiers?: string[];
  allowedChars?: string;
  multiline?: boolean;
  placeholder?: string;
}

export interface Question {
  id: string;
  track: string;
  contextId?: string;
  /** Printed section, question number, and blank labels, transcribed from the paper. */
  printedRef: string;
  title: string;
  prompt: { en: string; zh?: string };
  /** Optional language-specific printed code for display; not executable grading source. */
  displayCode?: Partial<Record<Language, string>>;
  /** Show only an answer field when the paper prints no code for this program blank. */
  answerOnly?: boolean;
  figure?: PaperFigure;
  points: number;
  blanks: Blank[];
  source?: SourceRef;
  grading: GradingSpec;
}

export type GradingSpec = ProgramGrading | ProgramInputGrading | CppLineRepairGrading | CoinCounterexampleGrading | ChecksumCollisionGrading | ZigzagPathGrading | LiteralGrading | RobotGridGrading | GraphGrading | GraphReversalGrading | TriangleAffineGrading | UniformCppExpressionGrading | GridCheckpointsGrading | IntegerListGrading | MatrixSumsGrading | RpnExpressionGrading | CounterexampleMaxGrading | SignedWrapSumGrading | NandExpressionGrading | DieFaceGrading | PrimePowerPairGrading | FloatInputErrorGrading | LogoDrawingGrading | StringReplacementCounterexampleGrading | DifferencePyramidGrading | SparseRulerGrading | TextEditorGrading | BooleanCircuitGrading | PrimeFactorCounterexampleGrading | PrimeFactorCountCounterexampleGrading | WeightedRouteGrading | RecordSortComparatorGrading | DrawingRobotGrading | TopTwoCounterexampleGrading | GraphLabelingGrading | BoxStackRobotGrading | RiverRouteGrading | TripleSortNetworkGrading | RegularPolygonGraphGrading | PendingGrading | CancelledGrading;

export type RegularPolygonGraphGrading = import('./regular-polygon-graph').RegularPolygonSpec;

export interface GraphLabelingGrading {
  kind: 'graph-labeling'; answerBlank: string;
  nodes: string[]; edges: [string, string][];
}

export interface BoxStackRobotGrading {
  kind: 'box-stack-robot'; answerBlank: string;
  /** Stacks are listed top to bottom. */
  initial: number[][]; target: number[][];
  maxCommands: number; maxRepeat: number;
}

export interface RiverRouteGrading {
  kind: 'river-route'; answerBlank: string;
  start: string; goal: string; passengers: number;
  edges: { from: string; to: string; limit: number }[];
  maxCommands: number;
}

export interface TripleSortNetworkGrading {
  kind: 'triple-sort-network'; answerBlank: string;
  variables: string[];
  /** Each call lists three variable names, with answerToken expanding to the entered pointers. */
  calls: string[][]; answerToken: string; answerCount: number;
}

export interface TopTwoCounterexampleGrading {
  kind: 'top-two-counterexample';
  answerBlank: string;
  count: number;
  minimum: number;
  maximum: number;
}

export interface DrawingRobotGrading {
  kind: 'drawing-robot';
  answerBlank: string;
  start: Coord;
  facing: 'up' | 'right' | 'down' | 'left';
  targetEdges: [Coord, Coord][];
  maxCommands: number;
  maxRepeat: number;
}

export interface RecordSortComparatorGrading {
  kind: 'record-sort-comparator';
  answerBlank: string;
  arrayName: string;
  indexName: string;
  fields: [string, string];
  order: 'descending' | 'ascending';
}

export interface WeightedRouteGrading {
  kind: 'weighted-route';
  answerBlank: string;
  nodes: string[];
  edges: { from: string; to: string; weight: number }[];
  directed: boolean;
  start: string;
  end: string;
  objective: 'shortest' | 'shortest-alternate' | 'longest-simple';
  reference?: { questionId: string; blankId: string };
}

export interface PrimeFactorCounterexampleGrading {
  kind: 'prime-factor-counterexample';
  inputBlank: string;
  outputBlank: string;
  minimum: number;
  maximum: number;
}

export interface PrimeFactorCountCounterexampleGrading {
  kind: 'prime-factor-count-counterexample';
  answerBlank: string;
  minimum: number;
  maximum: number;
}

export interface StringReplacementCounterexampleGrading {
  kind: 'string-replacement-counterexample';
  answerBlank: string;
  needle: string;
  replacement: string;
  maxInputLength: number;
}

export interface DifferencePyramidGrading {
  kind: 'difference-pyramid';
  answerBlank: string;
  values: number[];
}

export interface SparseRulerGrading {
  kind: 'sparse-ruler';
  answerBlank: string;
  length: number;
  maxMarks: number;
}

export interface TextEditorGrading {
  kind: 'text-editor';
  answerBlank: string;
  initial: string;
  target: string;
  maxCommands: number;
}

export interface BooleanCircuitGrading {
  kind: 'boolean-circuit';
  answerBlank: string;
  /** Output for a,b = FF, FT, TF, TT. */
  expected: [boolean, boolean, boolean, boolean];
  maxCost: number;
}

export interface LogoDrawingGrading {
  kind: 'logo-drawing';
  answerBlank: string;
  /** Target line segments in normalized drawing coordinates. */
  segments: [[number, number], [number, number]][];
  tolerance: number;
}

export interface FloatInputErrorGrading {
  kind: 'float-input-error';
  answerBlanks: [string, string];
}

export interface DieFaceGrading {
  kind: 'die-face';
  answerBlank: string;
  /** Three rows of three pip/empty cells separated by '/'. */
  expected: string;
}

export interface PrimePowerPairGrading {
  kind: 'prime-power-pair';
  correctBlank: string;
  incorrectBlank: string;
  minimum: number;
  maximum: number;
}

export interface NandExpressionGrading {
  kind: 'nand-expression';
  answerBlank: string;
  /** Output for A,B = TT, TF, FT, FF. */
  expected: [boolean, boolean, boolean, boolean];
}

export interface CounterexampleMaxGrading {
  kind: 'counterexample-max';
  answerBlank: string;
  minimum: number;
  maximum: number;
  modulus: number;
  residues: number[];
  partialPoints: number;
}

export interface SignedWrapSumGrading {
  kind: 'signed-wrap-sum';
  answerBlanks: [string, string];
  minimum: number;
  maximum: number;
  requiredSum: number;
}

export interface RpnExpressionGrading {
  kind: 'rpn-expression';
  answerBlank: string;
  /** Officially accepted token sequences; all operands are single digit. */
  forms: string[];
}

export interface MatrixSumsGrading {
  kind: 'matrix-sums';
  answerBlank: string;
  values: number[];
  each: number;
  rowSums: number[];
  colSums: number[];
}

export interface GridCheckpointsGrading {
  kind: 'grid-checkpoints';
  answerBlank: string;
  width: number;
  height: number;
  expectedPaths: number;
}

export interface IntegerListGrading {
  kind: 'integer-list';
  answerBlanks: string[];
  count: number;
  minimum: number;
  maximum: number;
  distinct?: boolean;
  squareOnly?: boolean;
  forbidden?: number[];
  allowed?: number[];
  inversionCount?: number;
  minimumSpacing?: { anchors: number[]; required: number };
}

export interface CancelledGrading {
  kind: 'cancelled';
  reason: string;
}

export interface ProgramInputGrading {
  kind: 'program-input';
  answerBlank: string;
  target: ProgramTarget;
  expected: Observation;
  maxSteps: number;
}

export interface CoinCounterexampleGrading {
  kind: 'coin-counterexample';
  middleBlank: string;
  largestBlank: string;
  amount: number;
  largestLimit: number;
}

export interface ChecksumCollisionGrading {
  kind: 'checksum-collision';
  answerBlank: string;
  reference: string;
  powers: number[];
  alphabet: string;
}

export interface ZigzagPathGrading {
  kind: 'zigzag-path';
  answerBlank: string;
  steps: number[];
  start: number;
  end: number;
  key: number;
  blocked: number[];
}

export interface CppLineRepairGrading {
  kind: 'cpp-line-repair';
  language?: 'cpp' | 'c';
  lineBlank: string;
  replacementBlank: string;
  correctLines?: number[];
  linePoints?: number;
  firstLine: number;
  source: string;
  /** Fixed code outside the numbered lines shown to the student. */
  prefixSource?: string;
  suffixSource?: string;
  mode?: 'replace' | 'append';
  harness?: ProgramTarget['harness'];
  cases: ProgramCase[];
}

export interface UniformCppExpressionGrading {
  kind: 'uniform-cpp-expression';
  answerBlank: string;
  randomFunction: string;
  randomMin: number;
  randomMax: number;
  outputMin: number;
  outputMax: number;
  maxCalls: number;
}

export interface ProgramGrading {
  kind: 'program';
  targets: ProgramTarget[];
  targetPolicy: 'any' | 'all';
  cases: ProgramCase[];
}

export interface ProgramTarget {
  language: Language;
  dialect?: string;
  /** Fixed functions prepended to this target only. Answer markers are forbidden here. */
  helperSource?: string;
  /** Source template with {{blankId}} markers. */
  source: string;
  harness: { kind: 'call'; function: string } | { kind: 'program' };
}

export interface ProgramCase {
  id: string;
  args?: JsonValue[];
  stdin?: string;
  expected: Observation;
  /** Overrides the expected observation for a specific language target. */
  expectedByLanguage?: Partial<Record<Language, Observation>>;
  maxSteps: number;
}

export interface LiteralGrading {
  kind: 'literal';
  accepted: Record<string, string[]>;
  normalize: 'none' | 'trim';
}

export interface RobotGridGrading {
  kind: 'robot-grid';
  answerBlank: string;
  dialect: {
    commands: Record<string, Coord>;
    repeatSyntax: 'bracket-number' | 'paren-number' | 'both' | 'none';
    maxRepeat?: number;
    invalidMove: 'ignore' | 'error';
  };
  worlds: RobotWorld[];
}

export interface RobotWorld {
  id: string;
  width: number;
  height: number;
  starts: Coord[] | 'all-free';
  blocked: Coord[];
  requiredVisited?: Coord[] | 'all-free';
  finalPosition?: Coord;
  maxMoves: number;
}

export interface GraphGrading {
  kind: 'graph';
  answerBlank: string;
  nodes: string[];
  baseEdges: Edge[];
  allowedAddedEdges?: Edge[];
  directed: true;
  assertions: {
    addedEdgeCount?: number;
    acyclic?: boolean;
    pathCount?: { from: string; to: string; count: number };
  };
}

export interface GraphReversalGrading {
  kind: 'graph-reversal';
  answerBlank: string;
  nodes: string[];
  edges: { label: string; from: string; to: string }[];
  requireStronglyConnected: true;
  requireMinimum: true;
}

export interface TriangleAffineGrading {
  kind: 'triangle-affine';
  answerBlank: string;
}

export interface PendingGrading {
  kind: 'pending';
  reason: string;
  intendedEngine?: string;
}

export interface Observation {
  returnValue?: JsonValue;
  stdout?: string;
  /** Call-harness arguments after execution, for in-place algorithms. */
  argsAfter?: JsonValue[];
}

export type EngineResult =
  | { kind: 'ok'; observation: Observation; steps: number }
  | { kind: 'compile-error' | 'runtime-error' | 'step-limit' | 'unsupported' | 'wall-timeout' | 'internal-error'; message: string; steps?: number };

export interface ProgramEngine {
  run(source: string, target: ProgramTarget, testCase: ProgramCase): Promise<EngineResult> | EngineResult;
}

export type PaperAnswers = Record<string, Record<string, string>>;
export type GradeStatus = 'pass' | 'partial' | 'fail' | 'inconclusive' | 'pending' | 'cancelled';

export interface CaseGrade {
  id: string;
  status: GradeStatus;
  message?: string;
  observed?: Observation;
  steps?: number;
}

export interface QuestionGrade {
  questionId: string;
  status: GradeStatus;
  score: number | null;
  maxScore: number;
  cases: CaseGrade[];
  message?: string;
}

export interface PaperGrade {
  paperId: string;
  selectedTracks: string[];
  questions: QuestionGrade[];
  scoredPoints: number;
  scoredMaximum: number;
  possibleMaximum: number;
  complete: boolean;
}
