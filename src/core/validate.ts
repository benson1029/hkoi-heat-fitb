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
  forbiddenChars: z.string().min(1).max(100).optional(),
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
    maxSteps: z.number().int().positive().max(50_000)
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
  maxSteps: z.number().int().positive().max(50_000)
}).strict();

const cppLineRepairGrading = z.object({
  kind: z.literal('cpp-line-repair'),
  lineBlank: id,
  replacementBlank: id,
  firstLine: z.number().int().positive().max(10_000),
  source: z.string().min(1).max(128 * 1024),
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
  figure: z.union([graphFigure, paperImageFigure]).optional(),
  points: z.number().nonnegative().finite().max(100),
  blanks: z.array(blank).min(1).max(30),
  source: sourceRef.optional(),
  grading: z.discriminatedUnion('kind', [programGrading, programInputGrading, cppLineRepairGrading, coinCounterexampleGrading, checksumCollisionGrading, zigzagPathGrading, literalGrading, robotGrading, graphGrading, graphReversalGrading, triangleAffineGrading, uniformCppExpressionGrading, pendingGrading])
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
    id, track: id, title: z.string().max(200).optional(), markdown: text
  }).strict()).max(100).optional(),
  questions: z.array(question).min(1).max(200)
}).strict();

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function checkQuestion(q: Question): void {
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
    if (!blankIds.includes(q.grading.lineBlank) || !blankIds.includes(q.grading.replacementBlank)) throw new Error(`Question ${q.id}: line repair blank is unknown`);
    unique(q.grading.cases.map(testCase => testCase.id), `case in ${q.id}`);
    if (q.grading.firstLine + q.grading.source.split('\n').length > 10_100) throw new Error(`Question ${q.id}: repair line range is invalid`);
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
  return paper;
}
