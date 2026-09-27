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
  forbiddenChars?: string;
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
  figure?: PaperFigure;
  points: number;
  blanks: Blank[];
  source?: SourceRef;
  grading: GradingSpec;
}

export type GradingSpec = ProgramGrading | ProgramInputGrading | CppLineRepairGrading | CoinCounterexampleGrading | ChecksumCollisionGrading | ZigzagPathGrading | LiteralGrading | RobotGridGrading | GraphGrading | GraphReversalGrading | TriangleAffineGrading | UniformCppExpressionGrading | PendingGrading;

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
  lineBlank: string;
  replacementBlank: string;
  firstLine: number;
  source: string;
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
export type GradeStatus = 'pass' | 'fail' | 'inconclusive' | 'pending';

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
