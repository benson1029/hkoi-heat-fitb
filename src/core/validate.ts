import { z } from 'zod';
import type { PaperConfig, Question } from './types';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const text = z.string().max(100_000);
const coord = z.tuple([z.number().int(), z.number().int()]);
const edge = z.tuple([id, id]);
const sourceRef = z.object({
  paperUrl: z.string().url().max(2_000).optional(),
  answerSheetUrl: z.string().url().max(2_000).optional(),
  page: z.number().int().positive().optional(),
  note: text.optional()
}).strict();

const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(),
  z.array(jsonValue).max(10_000), z.record(jsonValue)
]));

const observation = z.object({
  returnValue: jsonValue.optional(),
  stdout: z.string().max(100_000).optional(),
  argsAfter: z.array(jsonValue).max(100).optional()
}).strict().refine(value => value.returnValue !== undefined || value.stdout !== undefined || value.argsAfter !== undefined, 'Expected observation is empty');

const blank = z.object({
  id,
  label: z.string().max(200).optional(),
  maxChars: z.number().int().positive().max(5_000).optional(),
  maxCharsExcludeWhitespace: z.boolean().optional(),
  forbiddenChars: z.string().min(1).max(100).optional(),
  forbiddenIdentifiers: z.array(z.string().min(1).max(80).regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).min(1).max(30).optional(),
  allowedChars: z.string().min(1).max(200).optional(),
  multiline: z.boolean().optional(),
  placeholder: z.string().max(200).optional()
}).strict();

const programTarget = z.object({
  language: z.enum(['python', 'cpp', 'c']),
  dialect: z.string().max(40).optional(),
  helperSource: z.string().min(1).max(200_000).optional(),
  source: z.string().max(200_000),
  harness: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('call'), function: id }).strict(),
    z.object({ kind: z.literal('program') }).strict()
  ])
}).strict();

const programCase = z.object({
    id,
    args: z.array(jsonValue).max(100).optional(),
    stdin: z.string().max(100_000).optional(),
    expected: observation,
    expectedByLanguage: z.object({
      python: observation.optional(),
      cpp: observation.optional(),
      c: observation.optional()
    }).strict().optional(),
    maxSteps: z.number().int().positive().max(250_000)
}).strict();

const programGrading = z.object({
  kind: z.literal('program'),
  targets: z.array(programTarget).min(1).max(3),
  targetPolicy: z.enum(['any', 'all']),
  cases: z.array(programCase).min(1).max(50)
}).strict();

const programInputGrading = z.object({
  kind: z.literal('program-input'),
  answerBlank: id,
  target: programTarget,
  expected: observation,
  maxSteps: z.number().int().positive().max(250_000)
}).strict();

const cppLineRepairGrading = z.object({
  kind: z.literal('cpp-line-repair'),
  language: z.enum(['cpp', 'c']).optional(),
  lineBlank: id,
  replacementBlank: id,
  correctLines: z.array(z.number().int().positive()).min(1).max(20).optional(),
  linePoints: z.number().positive().finite().optional(),
  firstLine: z.number().int().positive().max(10_000),
  source: z.string().min(1).max(128 * 1024),
  prefixSource: z.string().max(128 * 1024).optional(),
  suffixSource: z.string().max(128 * 1024).optional(),
  mode: z.enum(['replace', 'append']).optional(),
  harness: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('call'), function: id }).strict(),
    z.object({ kind: z.literal('program') }).strict()
  ]).optional(),
  cases: z.array(programCase).min(1).max(50)
}).strict();

const coinCounterexampleGrading = z.object({
  kind: z.literal('coin-counterexample'),
  middleBlank: id,
  largestBlank: id,
  amount: z.number().int().positive().max(100_000),
  largestLimit: z.number().int().min(3).max(100_000)
}).strict();

const checksumCollisionGrading = z.object({
  kind: z.literal('checksum-collision'),
  answerBlank: id,
  reference: z.string().min(1).max(12),
  powers: z.array(z.number().int().min(1).max(8)).min(1).max(12),
  alphabet: z.string().min(2).max(100)
}).strict();

const zigzagPathGrading = z.object({
  kind: z.literal('zigzag-path'),
  answerBlank: id,
  steps: z.array(z.number().int().min(0).max(9)).min(1).max(20),
  start: z.number().int().min(0).max(1000),
  end: z.number().int().min(0).max(1000),
  key: z.number().int().min(0).max(1000),
  blocked: z.array(z.number().int().min(0).max(1000)).max(1000)
}).strict();

const literalGrading = z.object({
  kind: z.literal('literal'),
  accepted: z.record(z.array(z.string().max(10_000)).min(1).max(100)),
  normalize: z.enum(['none', 'trim'])
}).strict();

const robotGrading = z.object({
  kind: z.literal('robot-grid'),
  answerBlank: id,
  dialect: z.object({
    commands: z.record(coord),
    repeatSyntax: z.enum(['bracket-number', 'paren-number', 'both', 'none']),
    maxRepeat: z.number().int().positive().max(999).optional(),
    invalidMove: z.enum(['ignore', 'error'])
  }).strict(),
  worlds: z.array(z.object({
    id,
    width: z.number().int().positive().max(30),
    height: z.number().int().positive().max(30),
    starts: z.union([z.literal('all-free'), z.array(coord).min(1).max(900)]),
    blocked: z.array(coord).max(900),
    requiredVisited: z.union([z.literal('all-free'), z.array(coord).max(900)]).optional(),
    finalPosition: coord.optional(),
    maxMoves: z.number().int().positive().max(5_000)
  }).strict()).min(1).max(100)
}).strict();

const graphGrading = z.object({
  kind: z.literal('graph'),
  answerBlank: id,
  nodes: z.array(id).min(1).max(100),
  baseEdges: z.array(edge).max(1_000),
  allowedAddedEdges: z.array(edge).max(1_000).optional(),
  directed: z.literal(true),
  assertions: z.object({
    addedEdgeCount: z.number().int().nonnegative().max(1_000).optional(),
    acyclic: z.boolean().optional(),
    pathCount: z.object({ from: id, to: id, count: z.number().int().nonnegative().max(1_000_000) }).strict().optional()
  }).strict()
}).strict();

const graphReversalGrading = z.object({
  kind: z.literal('graph-reversal'),
  answerBlank: id,
  nodes: z.array(id).min(2).max(20),
  edges: z.array(z.object({ label: id, from: id, to: id }).strict()).min(1).max(14),
  requireStronglyConnected: z.literal(true),
  requireMinimum: z.literal(true)
}).strict();

const triangleAffineGrading = z.object({ kind: z.literal('triangle-affine'), answerBlank: id }).strict();

const uniformCppExpressionGrading = z.object({
  kind: z.literal('uniform-cpp-expression'),
  answerBlank: id,
  randomFunction: id,
  randomMin: z.number().int().min(0).max(1000),
  randomMax: z.number().int().min(0).max(1000),
  outputMin: z.number().int().min(0).max(1000),
  outputMax: z.number().int().min(0).max(1000),
  maxCalls: z.number().int().min(1).max(4)
}).strict();

const graphFigure = z.object({
  kind: z.enum(['directed-graph', 'undirected-graph']),
  nodes: z.array(z.object({ id, x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(2).max(30),
  edges: z.array(z.object({ from: id, to: id, label: id.optional() }).strict()).max(100)
}).strict();

const paperImageFigure = z.object({
  kind: z.literal('paper-image'),
  path: z.string().regex(/^papers\/[a-z0-9/_-]+\.png$/i),
  alt: z.string().min(1).max(500)
}).strict();

const pendingGrading = z.object({
  kind: z.literal('pending'),
  reason: z.string().min(1).max(2_000),
  intendedEngine: z.string().max(80).optional()
}).strict();

const cancelledGrading = z.object({
  kind: z.literal('cancelled'),
  reason: z.string().min(1).max(2_000)
}).strict();

const gridCheckpointsGrading = z.object({
  kind: z.literal('grid-checkpoints'), answerBlank: id,
  width: z.number().int().min(2).max(12), height: z.number().int().min(2).max(12),
  expectedPaths: z.number().int().nonnegative().max(1_000_000)
}).strict();

const integerListGrading = z.object({
  kind: z.literal('integer-list'), answerBlanks: z.array(id).min(1).max(30),
  count: z.number().int().min(1).max(30),
  minimum: z.number().int().min(-100_000).max(100_000), maximum: z.number().int().min(-100_000).max(100_000),
  distinct: z.boolean().optional(), squareOnly: z.boolean().optional(),
  forbidden: z.array(z.number().int()).max(100).optional(), allowed: z.array(z.number().int()).max(100).optional(),
  inversionCount: z.number().int().nonnegative().max(435).optional(),
  minimumSpacing: z.object({ anchors: z.array(z.number().int()).max(100), required: z.number().int().nonnegative() }).strict().optional()
}).strict();

const matrixSumsGrading = z.object({
  kind: z.literal('matrix-sums'), answerBlank: id,
  values: z.array(z.number().int()).min(1).max(12), each: z.number().int().positive().max(12),
  rowSums: z.array(z.number().int()).min(1).max(12), colSums: z.array(z.number().int()).min(1).max(12)
}).strict();

const rpnExpressionGrading = z.object({
  kind: z.literal('rpn-expression'), answerBlank: id,
  forms: z.array(z.string().regex(/^[0-9+*\/-]+$/).min(1).max(60)).min(1).max(20)
}).strict();

const counterexampleMaxGrading = z.object({
  kind: z.literal('counterexample-max'), answerBlank: id,
  minimum: z.number().int(), maximum: z.number().int(), modulus: z.number().int().positive().max(1000),
  residues: z.array(z.number().int().nonnegative()).min(1).max(100), partialPoints: z.number().nonnegative().finite()
}).strict();

const signedWrapSumGrading = z.object({
  kind: z.literal('signed-wrap-sum'), answerBlanks: z.tuple([id,id]),
  minimum: z.number().int(), maximum: z.number().int(), requiredSum: z.number().int()
}).strict();

const nandExpressionGrading = z.object({
  kind: z.literal('nand-expression'), answerBlank: id,
  expected: z.tuple([z.boolean(), z.boolean(), z.boolean(), z.boolean()])
}).strict();

const dieFaceGrading = z.object({
  kind: z.literal('die-face'), answerBlank: id,
  expected: z.string().regex(/^[.o]{3}\/[.o]{3}\/[.o]{3}$/)
}).strict();

const primePowerPairGrading = z.object({
  kind: z.literal('prime-power-pair'), correctBlank: id, incorrectBlank: id,
  minimum: z.number().int().min(2).max(2147483647), maximum: z.number().int().min(2).max(2147483647)
}).strict();

const floatInputErrorGrading = z.object({ kind: z.literal('float-input-error'), answerBlanks: z.tuple([id,id]) }).strict();

const logoDrawingGrading = z.object({
  kind: z.literal('logo-drawing'), answerBlank: id,
  segments: z.array(z.tuple([z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)]),
    z.tuple([z.number().min(0).max(1),z.number().min(0).max(1)])])).min(1).max(30),
  tolerance: z.number().positive().max(0.15)
}).strict();

const stringReplacementCounterexampleGrading = z.object({
  kind: z.literal('string-replacement-counterexample'), answerBlank: id,
  needle: z.string().min(1).max(100), replacement: z.string().min(1).max(100),
  maxInputLength: z.number().int().positive().max(5_000)
}).strict();

const differencePyramidGrading = z.object({
  kind: z.literal('difference-pyramid'), answerBlank: id,
  values: z.array(z.number().int()).length(6)
}).strict();

const sparseRulerGrading = z.object({
  kind: z.literal('sparse-ruler'), answerBlank: id,
  length: z.number().int().min(2).max(100), maxMarks: z.number().int().min(2).max(30)
}).strict();

const textEditorGrading = z.object({
  kind: z.literal('text-editor'), answerBlank: id,
  initial: z.string().regex(/^[A-Z]+$/).max(500), target: z.string().regex(/^[A-Z]+$/).max(500),
  maxCommands: z.number().int().positive().max(10_000)
}).strict();

const booleanCircuitGrading = z.object({
  kind: z.literal('boolean-circuit'), answerBlank: id,
  expected: z.tuple([z.boolean(), z.boolean(), z.boolean(), z.boolean()]),
  maxCost: z.number().int().positive().max(100)
}).strict();

const primeFactorCounterexampleGrading = z.object({
  kind: z.literal('prime-factor-counterexample'), inputBlank: id, outputBlank: id,
  minimum: z.number().int().min(2).max(100_000), maximum: z.number().int().min(2).max(100_000)
}).strict();

const primeFactorCountCounterexampleGrading = z.object({
  kind: z.literal('prime-factor-count-counterexample'), answerBlank: id,
  minimum: z.number().int().min(2).max(100_000), maximum: z.number().int().min(2).max(100_000)
}).strict();

const weightedRouteGrading = z.object({
  kind: z.literal('weighted-route'), answerBlank: id,
  nodes: z.array(id).min(2).max(25),
  edges: z.array(z.object({ from: id, to: id, weight: z.number().int().positive().max(1_000_000) }).strict()).min(1).max(80),
  directed: z.boolean(), start: id, end: id,
  objective: z.enum(['shortest', 'shortest-alternate', 'longest-simple']),
  reference: z.object({ questionId: id, blankId: id }).strict().optional()
}).strict();

const recordSortComparatorGrading = z.object({
  kind: z.literal('record-sort-comparator'), answerBlank: id,
  arrayName: id, indexName: id, fields: z.tuple([id, id]),
  order: z.enum(['descending', 'ascending'])
}).strict();

const drawingRobotGrading = z.object({
  kind: z.literal('drawing-robot'), answerBlank: id, start: coord,
  facing: z.enum(['up', 'right', 'down', 'left']),
  targetEdges: z.array(z.tuple([coord, coord])).min(1).max(100),
  maxCommands: z.number().int().positive().max(10_000),
  maxRepeat: z.number().int().positive().max(99)
}).strict();

const topTwoCounterexampleGrading = z.object({
  kind: z.literal('top-two-counterexample'), answerBlank: id,
  count: z.number().int().min(2).max(30),
  minimum: z.number().int().min(-2147483648), maximum: z.number().int().max(2147483647)
}).strict();

const graphLabelingGrading = z.object({
  kind: z.literal('graph-labeling'), answerBlank: id,
  nodes: z.array(id).min(2).max(12), edges: z.array(z.tuple([id, id])).min(1).max(30)
}).strict();

const boxStackRobotGrading = z.object({
  kind: z.literal('box-stack-robot'), answerBlank: id,
  initial: z.array(z.array(z.number().int())).length(3),
  target: z.array(z.array(z.number().int())).length(3),
  maxCommands: z.number().int().positive().max(10_000), maxRepeat: z.number().int().positive().max(999)
}).strict();

const riverRouteGrading = z.object({
  kind: z.literal('river-route'), answerBlank: id,
  start: id, goal: id, passengers: z.number().int().nonnegative(),
  edges: z.array(z.object({ from: id, to: id, limit: z.number().int().nonnegative() }).strict()).min(1).max(100),
  maxCommands: z.number().int().positive().max(10_000)
}).strict();

const tripleSortNetworkGrading = z.object({
  kind: z.literal('triple-sort-network'), answerBlank: id,
  variables: z.array(id).length(6), calls: z.array(z.array(id).min(1).max(3)).min(1).max(20),
  answerToken: id, answerCount: z.number().int().min(1).max(3)
}).strict();

const regularPolygonGraphGrading = z.object({
  kind: z.literal('regular-polygon-graph'), answerBlank: id,
  totalEdges: z.number().int().min(3).max(30),
  objective: z.enum(['max-vertices', 'min-horizontal', 'min-diagonal'])
}).strict();

const question = z.object({
  id,
  track: id,
  contextId: id.optional(),
  printedRef: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  prompt: z.object({ en: text, zh: text.optional() }).strict(),
  displayCode: z.object({
    python: z.string().max(200_000).optional(),
    cpp: z.string().max(200_000).optional(),
    c: z.string().max(200_000).optional()
  }).strict().optional(),
  answerOnly: z.boolean().optional(),
  figure: z.union([graphFigure, paperImageFigure]).optional(),
  points: z.number().nonnegative().finite().max(100),
  blanks: z.array(blank).min(1).max(30),
  source: sourceRef.optional(),
  grading: z.discriminatedUnion('kind', [programGrading, programInputGrading, cppLineRepairGrading, coinCounterexampleGrading, checksumCollisionGrading, zigzagPathGrading, literalGrading, robotGrading, graphGrading, graphReversalGrading, triangleAffineGrading, uniformCppExpressionGrading, gridCheckpointsGrading, integerListGrading, matrixSumsGrading, rpnExpressionGrading, counterexampleMaxGrading, signedWrapSumGrading, nandExpressionGrading, dieFaceGrading, primePowerPairGrading, floatInputErrorGrading, logoDrawingGrading, stringReplacementCounterexampleGrading, differencePyramidGrading, sparseRulerGrading, textEditorGrading, booleanCircuitGrading, primeFactorCounterexampleGrading, primeFactorCountCounterexampleGrading, weightedRouteGrading, recordSortComparatorGrading, drawingRobotGrading, topTwoCounterexampleGrading, graphLabelingGrading, boxStackRobotGrading, riverRouteGrading, tripleSortNetworkGrading, regularPolygonGraphGrading, pendingGrading, cancelledGrading])
}).strict();

const paperSchema = z.object({
  schemaVersion: z.literal(1),
  paper: z.object({
    id,
    season: z.string().min(1).max(50),
    division: z.enum(['junior', 'senior']),
    title: z.string().max(300).optional(),
    source: sourceRef.optional()
  }).strict(),
  tracks: z.array(z.object({
    id,
    label: z.string().min(1).max(200),
    selection: z.enum(['required', 'choice']),
    choiceGroup: id.optional()
  }).strict()).min(1).max(10),
  contexts: z.array(z.object({
    id, track: id, title: z.string().max(200).optional(), markdown: text,
    displayCode: z.object({
      python: z.string().max(200_000).optional(),
      cpp: z.string().max(200_000).optional(),
      c: z.string().max(200_000).optional()
    }).strict().optional(),
    answerSets: z.array(z.object({
      questionId: id,
      label: z.string().min(1).max(80),
      bindings: z.record(id, id)
    }).strict()).min(2).max(20).optional()
  }).strict()).max(100).optional(),
  questions: z.array(question).min(1).max(200)
}).strict();

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function checkQuestion(q: Question): void {
  if (q.answerOnly && q.grading.kind !== 'program') throw new Error(`Question ${q.id}: answerOnly requires program grading`);
  if (q.answerOnly && q.displayCode) throw new Error(`Question ${q.id}: answerOnly cannot have displayCode`);
  const blankIds = q.blanks.map(blank => blank.id);
  unique(blankIds, `blank in ${q.id}`);
  for (const code of Object.values(q.displayCode ?? {})) {
    if (code === undefined) continue;
    for (const match of code.matchAll(/{{([A-Za-z0-9][A-Za-z0-9._-]*)}}/g)) {
      if (!blankIds.includes(match[1])) throw new Error(`Question ${q.id}: unknown displayCode marker ${match[1]}`);
    }
  }
  if (q.figure && q.figure.kind !== 'paper-image') {
    unique(q.figure.nodes.map(node => node.id), `figure node in ${q.id}`);
    const nodes = new Set(q.figure.nodes.map(node => node.id));
    for (const edge of q.figure.edges) if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      throw new Error(`Question ${q.id}: figure edge references an unknown node`);
    }
  }
  if (q.grading.kind === 'cancelled' && q.points !== 0) throw new Error(`Question ${q.id}: cancelled question must award zero points`);
  if (q.grading.kind === 'grid-checkpoints' && !blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: checkpoint blank is unknown`);
  if (q.grading.kind === 'rpn-expression' && !blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: RPN blank is unknown`);
  if (q.grading.kind === 'nand-expression' && !blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: NAND blank is unknown`);
  if (q.grading.kind === 'logo-drawing' && !blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: drawing blank is unknown`);
  if (q.grading.kind === 'die-face' && !blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: die-face blank is unknown`);
  if (['string-replacement-counterexample', 'difference-pyramid', 'sparse-ruler', 'text-editor', 'boolean-circuit', 'prime-factor-count-counterexample'].includes(q.grading.kind)) {
    const spec = q.grading as { answerBlank: string };
    if (!blankIds.includes(spec.answerBlank)) throw new Error(`Question ${q.id}: semantic answer blank is unknown`);
  }
  if (q.grading.kind === 'difference-pyramid' && new Set(q.grading.values).size !== 6) throw new Error(`Question ${q.id}: pyramid values must be distinct`);
  if (q.grading.kind === 'text-editor' && q.grading.initial.length !== q.grading.target.length) throw new Error(`Question ${q.id}: text editor strings must have equal length`);
  if (q.grading.kind === 'sparse-ruler' && q.grading.maxMarks > q.grading.length + 1) throw new Error(`Question ${q.id}: ruler mark limit exceeds its length`);
  if (q.grading.kind === 'prime-factor-counterexample' && (q.grading.minimum > q.grading.maximum || q.grading.inputBlank === q.grading.outputBlank || !blankIds.includes(q.grading.inputBlank) || !blankIds.includes(q.grading.outputBlank))) throw new Error(`Question ${q.id}: factor counterexample contract is invalid`);
  if (q.grading.kind === 'prime-factor-count-counterexample' && q.grading.minimum > q.grading.maximum) throw new Error(`Question ${q.id}: factor-count range is invalid`);
  if (q.grading.kind === 'weighted-route') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank) || new Set(spec.nodes).size !== spec.nodes.length || !spec.nodes.includes(spec.start) || !spec.nodes.includes(spec.end) || spec.start === spec.end ||
        spec.edges.some(edge => !spec.nodes.includes(edge.from) || !spec.nodes.includes(edge.to) || edge.from === edge.to) ||
        (spec.objective === 'shortest-alternate') !== !!spec.reference) throw new Error(`Question ${q.id}: weighted route contract is invalid`);
  }
  if (q.grading.kind === 'record-sort-comparator' && (!blankIds.includes(q.grading.answerBlank) || q.grading.fields[0] === q.grading.fields[1])) throw new Error(`Question ${q.id}: record comparator contract is invalid`);
  if (q.grading.kind === 'drawing-robot') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank) || spec.targetEdges.some(([a, b]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1)) {
      throw new Error(`Question ${q.id}: drawing robot edges must be unit segments`);
    }
  }
  if (q.grading.kind === 'top-two-counterexample' && (!blankIds.includes(q.grading.answerBlank) || q.grading.minimum > q.grading.maximum)) throw new Error(`Question ${q.id}: top-two counterexample contract is invalid`);
  if (q.grading.kind === 'graph-labeling') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank) || new Set(spec.nodes).size !== spec.nodes.length ||
        spec.edges.some(([a, b]) => !spec.nodes.includes(a) || !spec.nodes.includes(b) || a === b)) throw new Error(`Question ${q.id}: graph labeling contract is invalid`);
  }
  if (q.grading.kind === 'box-stack-robot') {
    const spec = q.grading;
    const initial = spec.initial.flat().sort((a, b) => a - b);
    const target = spec.target.flat().sort((a, b) => a - b);
    if (!blankIds.includes(spec.answerBlank) || initial.length !== target.length || initial.some((value, index) => value !== target[index]) || new Set(initial).size !== initial.length)
      throw new Error(`Question ${q.id}: box stack contract is invalid`);
  }
  if (q.grading.kind === 'river-route') {
    const spec = q.grading;
    const parents = new Set(spec.edges.map(edge => edge.to));
    if (!blankIds.includes(spec.answerBlank) || spec.start === spec.goal || parents.has(spec.start) || !parents.has(spec.goal) ||
        parents.size !== spec.edges.length || spec.edges.some(edge => edge.from === edge.to)) throw new Error(`Question ${q.id}: river route contract is invalid`);
  }
  if (q.grading.kind === 'triple-sort-network') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank) || new Set(spec.variables).size !== 6 ||
        spec.calls.some(call => call.filter(name => name === spec.answerToken).length > 1 || call.some(name => name !== spec.answerToken && !spec.variables.includes(name))))
      throw new Error(`Question ${q.id}: triple-sort network contract is invalid`);
  }
  if (q.grading.kind === 'regular-polygon-graph' && !blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: regular polygon graph blank is invalid`);
  if (q.grading.kind === 'prime-power-pair') {
    const spec = q.grading;
    if (!blankIds.includes(spec.correctBlank) || !blankIds.includes(spec.incorrectBlank) || spec.correctBlank === spec.incorrectBlank || spec.minimum >= spec.maximum) {
      throw new Error(`Question ${q.id}: prime-power-pair contract is invalid`);
    }
  }
  if (q.grading.kind === 'float-input-error' && (q.grading.answerBlanks[0] === q.grading.answerBlanks[1] || q.grading.answerBlanks.some(blankId => !blankIds.includes(blankId)))) {
    throw new Error(`Question ${q.id}: float-input-error blank is invalid`);
  }
  if (q.grading.kind === 'counterexample-max') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank) || spec.minimum > spec.maximum || spec.partialPoints >= q.points ||
        spec.residues.some(value => value >= spec.modulus) || new Set(spec.residues).size !== spec.residues.length) {
      throw new Error(`Question ${q.id}: counterexample-max contract is invalid`);
    }
  }
  if (q.grading.kind === 'signed-wrap-sum') {
    const spec = q.grading;
    if (spec.answerBlanks[0] === spec.answerBlanks[1] || spec.answerBlanks.some(blankId => !blankIds.includes(blankId)) ||
        spec.minimum > spec.maximum || spec.requiredSum < spec.minimum * 2 || spec.requiredSum > spec.maximum * 2) {
      throw new Error(`Question ${q.id}: signed-wrap-sum contract is invalid`);
    }
  }
  if (q.grading.kind === 'matrix-sums') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank) || new Set(spec.values).size !== spec.values.length ||
        spec.values.length * spec.each !== spec.rowSums.length * spec.colSums.length ||
        spec.rowSums.reduce((a, b) => a + b, 0) !== spec.colSums.reduce((a, b) => a + b, 0) ||
        spec.values.reduce((a, b) => a + b, 0) * spec.each !== spec.rowSums.reduce((a, b) => a + b, 0)) {
      throw new Error(`Question ${q.id}: matrix-sums contract is invalid`);
    }
  }
  if (q.grading.kind === 'integer-list') {
    const spec = q.grading;
    unique(spec.answerBlanks, `integer answer in ${q.id}`);
    if (spec.answerBlanks.some(blankId => !blankIds.includes(blankId)) ||
        (spec.answerBlanks.length !== 1 && spec.answerBlanks.length !== spec.count) ||
        spec.minimum > spec.maximum ||
        spec.inversionCount !== undefined && spec.inversionCount > spec.count * (spec.count - 1) / 2 ||
        spec.minimumSpacing && (spec.minimumSpacing.anchors.some(value => value < spec.minimum || value > spec.maximum) || spec.minimumSpacing.required > spec.maximum - spec.minimum)) {
      throw new Error(`Question ${q.id}: integer-list contract is invalid`);
    }
  }
  if (q.grading.kind === 'program') {
    unique(q.grading.cases.map(testCase => testCase.id), `case in ${q.id}`);
    for (const target of q.grading.targets) {
      if (target.helperSource && /{{[A-Za-z0-9][A-Za-z0-9._-]*}}/.test(target.helperSource)) {
        throw new Error(`Question ${q.id}: helperSource cannot contain answer markers`);
      }
      const baseSource = target.helperSource ? `${target.helperSource}\n${target.source}` : target.source;
      const sourceLimit = target.language === 'python' ? 200_000 : 128 * 1024;
      if (new TextEncoder().encode(baseSource).length > sourceLimit) {
        throw new Error(`Question ${q.id}: target ${target.language} exceeds its composed source byte limit`);
      }
      for (const blankId of blankIds) {
        if (!target.source.includes(`{{${blankId}}}`)) {
          throw new Error(`Question ${q.id}: target ${target.language} does not use blank ${blankId}`);
        }
      }
      const markers = [...target.source.matchAll(/{{([^{}]+)}}/g)].map(match => match[1]);
      for (const marker of markers) {
        if (!blankIds.includes(marker)) throw new Error(`Question ${q.id}: unknown source marker ${marker}`);
      }
    }
  } else if (q.grading.kind === 'program-input') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank) || spec.target.harness.kind !== 'program' || /{{[^{}]+}}/.test(spec.target.source) || spec.target.helperSource) {
      throw new Error(`Question ${q.id}: program-input target or blank is invalid`);
    }
  } else if (q.grading.kind === 'cpp-line-repair') {
    const spec = q.grading;
    if (!blankIds.includes(spec.lineBlank) || !blankIds.includes(spec.replacementBlank)) throw new Error(`Question ${q.id}: line repair blank is unknown`);
    unique(spec.cases.map(testCase => testCase.id), `case in ${q.id}`);
    if (spec.firstLine + spec.source.split('\n').length > 10_100) throw new Error(`Question ${q.id}: repair line range is invalid`);
    if (spec.linePoints !== undefined && (!spec.correctLines || spec.linePoints >= q.points || spec.correctLines.some(line => line < spec.firstLine || line >= spec.firstLine + spec.source.split('\n').length))) {
      throw new Error(`Question ${q.id}: line repair partial-credit contract is invalid`);
    }
    if (spec.prefixSource?.includes('{{') || spec.suffixSource?.includes('{{')) throw new Error(`Question ${q.id}: repair wrapper cannot contain answer markers`);
  } else if (q.grading.kind === 'coin-counterexample') {
    if (!blankIds.includes(q.grading.middleBlank) || !blankIds.includes(q.grading.largestBlank)) throw new Error(`Question ${q.id}: coin blank is unknown`);
    if (q.grading.amount > 10_000 || q.grading.largestLimit > 1_000) throw new Error(`Question ${q.id}: coin search budget is too large`);
  } else if (q.grading.kind === 'checksum-collision') {
    const spec = q.grading;
    if (!blankIds.includes(spec.answerBlank)) throw new Error(`Question ${q.id}: checksum blank is unknown`);
    if (spec.reference.length !== spec.powers.length || new Set(spec.alphabet).size !== spec.alphabet.length ||
        [...spec.reference].some(char => !spec.alphabet.includes(char)) ||
        spec.powers.reduce((sum, power) => sum + spec.alphabet.length ** power, 0) > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Question ${q.id}: checksum reference, powers, or alphabet is invalid`);
    }
  } else if (q.grading.kind === 'zigzag-path') {
    if (!blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: path blank is unknown`);
    if (q.grading.steps.length > 9 || q.grading.end <= q.grading.start || q.grading.key < q.grading.start || q.grading.key > q.grading.end ||
        q.grading.steps.reduce((sum, step) => sum + step, 0) !== q.grading.end - q.grading.start ||
        new Set(q.grading.blocked).size !== q.grading.blocked.length) {
      throw new Error(`Question ${q.id}: path geometry is invalid`);
    }
  } else if (q.grading.kind === 'literal') {
    unique(Object.keys(q.grading.accepted), `literal answer in ${q.id}`);
    for (const blankId of blankIds) {
      if (!q.grading.accepted[blankId]) throw new Error(`Question ${q.id}: no accepted values for ${blankId}`);
    }
  } else if (q.grading.kind === 'robot-grid' || q.grading.kind === 'graph' || q.grading.kind === 'graph-reversal' || q.grading.kind === 'triangle-affine' || q.grading.kind === 'uniform-cpp-expression') {
    if (!blankIds.includes(q.grading.answerBlank)) throw new Error(`Question ${q.id}: answerBlank is unknown`);
    if (q.grading.kind === 'uniform-cpp-expression') {
      if (q.grading.randomMax < q.grading.randomMin || q.grading.randomMax - q.grading.randomMin > 100 || q.grading.outputMax < q.grading.outputMin || q.grading.outputMax - q.grading.outputMin > 100) {
        throw new Error(`Question ${q.id}: random or output range is invalid`);
      }
    } else if (q.grading.kind === 'robot-grid') {
      let work = 0;
      for (const world of q.grading.worlds) {
        const contains = ([x, y]: [number, number]) => x >= 0 && y >= 0 && x < world.width && y < world.height;
        const blocked = new Set(world.blocked.map(([x, y]) => `${x},${y}`));
        if (blocked.size !== world.blocked.length) throw new Error(`Question ${q.id}: duplicate blocked cell`);
        for (const point of world.blocked) if (!contains(point)) throw new Error(`Question ${q.id}: blocked cell outside world`);
        const freeCount = world.width * world.height - blocked.size;
        const starts = world.starts === 'all-free' ? freeCount : world.starts.length;
        work += starts * world.maxMoves;
        if (world.starts !== 'all-free') for (const point of world.starts) {
          if (!contains(point) || blocked.has(point.join(','))) throw new Error(`Question ${q.id}: invalid robot start`);
        }
        if (world.requiredVisited !== undefined && world.requiredVisited !== 'all-free') for (const point of world.requiredVisited) {
          if (!contains(point) || blocked.has(point.join(','))) throw new Error(`Question ${q.id}: invalid required cell`);
        }
        if (world.finalPosition && (!contains(world.finalPosition) || blocked.has(world.finalPosition.join(',')))) {
          throw new Error(`Question ${q.id}: invalid final position`);
        }
      }
      if (work > 10_000_000) throw new Error(`Question ${q.id}: robot world budget exceeds 10,000,000 moves`);
    } else if (q.grading.kind === 'graph') {
      unique(q.grading.nodes, `graph node in ${q.id}`);
      const nodes = new Set(q.grading.nodes);
      const edges = new Set<string>();
      for (const [from, to] of q.grading.baseEdges) {
        if (!nodes.has(from) || !nodes.has(to)) throw new Error(`Question ${q.id}: unknown base graph node`);
        const key = JSON.stringify([from, to]);
        if (edges.has(key)) throw new Error(`Question ${q.id}: duplicate base edge`);
        edges.add(key);
      }
      if (q.grading.assertions.pathCount) {
        const { from, to } = q.grading.assertions.pathCount;
        if (!nodes.has(from) || !nodes.has(to)) throw new Error(`Question ${q.id}: unknown path assertion node`);
      }
    } else if (q.grading.kind === 'graph-reversal') {
      unique(q.grading.nodes, `graph node in ${q.id}`);
      unique(q.grading.edges.map(edge => edge.label), `edge label in ${q.id}`);
      const nodes = new Set(q.grading.nodes);
      for (const edge of q.grading.edges) if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
        throw new Error(`Question ${q.id}: unknown reversal graph node`);
      }
    }
  }
}

/** Parse and validate untrusted paper JSON. No code from the paper is executed here. */
export function validatePaper(input: unknown): PaperConfig {
  const parsed = paperSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid paper at ${issue.path.join('.') || '$'}: ${issue.message}`);
  }
  const paper = parsed.data as PaperConfig;
  unique(paper.tracks.map(track => track.id), 'track ID');
  unique(paper.questions.map(q => q.id), 'question ID');
  const tracks = new Set(paper.tracks.map(track => track.id));
  unique((paper.contexts ?? []).map(context => context.id), 'context ID');
  const contexts = new Map((paper.contexts ?? []).map(context => [context.id, context]));
  for (const context of paper.contexts ?? []) if (!tracks.has(context.track)) {
    throw new Error(`Context ${context.id}: unknown track ${context.track}`);
  }
  for (const context of paper.contexts ?? []) {
    if (context.answerSets && !context.displayCode) throw new Error(`Context ${context.id}: answerSets require displayCode`);
    if (!context.displayCode) continue;
    const owners = new Map<string, string>();
    const grouped = paper.questions.filter(item => item.contextId === context.id);
    for (const question of grouped) {
      for (const blank of question.blanks) {
        if (owners.has(blank.id)) throw new Error(`Context ${context.id}: blank ${blank.id} has multiple owners`);
        owners.set(blank.id, question.id);
      }
    }
    const markers = new Set<string>();
    for (const code of Object.values(context.displayCode)) {
      if (code === undefined) continue;
      for (const match of code.matchAll(/{{([A-Za-z0-9][A-Za-z0-9._-]*)}}/g)) {
        markers.add(match[1]);
      }
    }
    if (!markers.size && context.answerSets) throw new Error(`Context ${context.id}: answerSets need an editable blank`);
    if (context.answerSets) {
      unique(context.answerSets.map(set => set.questionId), `answer set question in ${context.id}`);
      for (const set of context.answerSets) {
        const question = grouped.find(item => item.id === set.questionId);
        if (!question) throw new Error(`Context ${context.id}: unknown answer set question ${set.questionId}`);
        const slots = Object.keys(set.bindings);
        if (slots.length !== markers.size || slots.some(slot => !markers.has(slot))) {
          throw new Error(`Context ${context.id}: answer set ${set.questionId} must bind every code slot`);
        }
        const bound = Object.values(set.bindings);
        unique(bound, `answer set blank in ${set.questionId}`);
        if (bound.length !== question.blanks.length || bound.some(blank => !question.blanks.some(item => item.id === blank))) {
          throw new Error(`Context ${context.id}: answer set ${set.questionId} must bind its question blanks`);
        }
      }
    } else for (const marker of markers) if (!owners.has(marker)) {
      throw new Error(`Context ${context.id}: unknown displayCode marker ${marker}`);
    }
  }
  for (const track of paper.tracks) {
    if (track.selection === 'choice' && !track.choiceGroup) throw new Error(`Choice track ${track.id} needs choiceGroup`);
  }
  for (const q of paper.questions) {
    if (!tracks.has(q.track)) throw new Error(`Question ${q.id}: unknown track ${q.track}`);
    if (q.contextId && contexts.get(q.contextId)?.track !== q.track) {
      throw new Error(`Question ${q.id}: context ${q.contextId} is absent or on another track`);
    }
    checkQuestion(q);
  }
  for (const q of paper.questions) if (q.grading.kind === 'weighted-route' && q.grading.reference) {
    const reference = q.grading.reference;
    const referenced = paper.questions.find(item => item.id === reference.questionId);
    if (!referenced?.blanks.some(blank => blank.id === reference.blankId)) {
      throw new Error(`Question ${q.id}: weighted route reference is unknown`);
    }
  }
  return paper;
}
