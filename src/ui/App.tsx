import { Fragment, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { gradePaper, gradeQuestion } from '../core/grader';
import type {
  Blank,
  PaperFigure,
  GraphGrading,
  Language,
  PaperAnswers,
  PaperConfig,
  PaperContext,
  PaperGrade,
  ProgramTarget,
  Question,
  QuestionGrade,
  RobotGridGrading,
  SourceRef,
  Track,
} from '../core/types';
import { validatePaper } from '../core/validate';
import { bundledPapers } from '../data';
import { deleteBeforeCursor, insertRobotToken } from './robot-edit';

type PaperItem = { key: string; config: PaperConfig; private: boolean; fileName?: string };
type GradeMap = Record<string, QuestionGrade>;

const bundledItems: PaperItem[] = bundledPapers.map((config, index) => ({
  key: `bundled:${config.paper.id}:${index}`,
  config,
  private: false,
}));

function initialTracks(paper: PaperConfig): string[] {
  const chosen = new Set<string>();
  const groups = new Set<string>();
  for (const track of paper.tracks) {
    if (track.selection === 'required') chosen.add(track.id);
    else if (track.choiceGroup && !groups.has(track.choiceGroup)) {
      chosen.add(track.id);
      groups.add(track.choiceGroup);
    }
  }
  return [...chosen];
}

function displayedQuestions(paper: PaperConfig, tracks: string[]): Question[] {
  const selected = new Set(tracks);
  return paper.questions.filter((question) => selected.has(question.track));
}

function countChars(value: string): number {
  return Array.from(value).length;
}

function capAnswer(value: string, maxChars?: number): string {
  const normalized = value.replace(/\r\n?/g, '\n');
  return maxChars === undefined ? normalized : Array.from(normalized).slice(0, maxChars).join('');
}

function statusName(status: QuestionGrade['status']): string {
  switch (status) {
    case 'pass': return 'Passed tests';
    case 'fail': return 'Failed tests';
    case 'inconclusive': return 'Could not determine';
    case 'pending': return 'Grader pending';
    case 'cancelled': return 'Cancelled';
    case 'partial': return 'Partially correct';
  }
}

function trackLabel(paper: PaperConfig, id: string): string {
  return paper.tracks.find((track) => track.id === id)?.label ?? id;
}

function sectionName(question: Question): string {
  const match = /Section\s+([A-Z])/i.exec(question.printedRef);
  return match ? `Section ${match[1].toUpperCase()}` : 'Questions';
}

function jumpName(question: Question): string {
  const match = /Question\s+([^,]+)(?:,\s*(.+))?/i.exec(question.printedRef);
  return match ? `Q${match[1]}${match[2] ? ` · ${match[2].replace(/^Blanks?\s+/i, '')}` : ''}` : question.printedRef;
}

function officialPaperLink(source?: SourceRef): string | null {
  if (!source?.paperUrl) return null;
  try {
    const url = new URL(source.paperUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'hkoi.org' || url.hostname.endsWith('.hkoi.org'))) return null;
    if (source.page) url.hash = `page=${source.page}`;
    return url.href;
  } catch { return null; }
}

function Sidebar({
  papers,
  selectedKey,
  onSelect,
  onImport,
  onRemove,
  importError,
  importing,
}: {
  papers: PaperItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (key: string) => void;
  importError: string | null;
  importing: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [paperQuery, setPaperQuery] = useState('');
  const [divisionFilter, setDivisionFilter] = useState<'all' | 'junior' | 'senior'>('all');
  const publicPapers = papers.filter((paper) => !paper.private);
  const privatePapers = papers.filter((paper) => paper.private);
  const matchingPapers = publicPapers.filter(({ config }) => {
    const { paper } = config;
    const matchesDivision = divisionFilter === 'all' || paper.division === divisionFilter;
    const searchText = `${paper.season} ${paper.division} ${paper.title || ''} ${paper.id}`.toLowerCase();
    return matchesDivision && searchText.includes(paperQuery.trim().toLowerCase());
  });
  const byYear = new Map<string, PaperItem[]>();
  for (const item of matchingPapers) {
    const year = item.config.paper.season;
    byYear.set(year, [...(byYear.get(year) || []), item]);
  }
  for (const items of byYear.values()) items.sort((a, b) => {
    const rank = (item: PaperItem) => item.config.paper.id.includes('sample') ? 2 : item.config.paper.division === 'junior' ? 0 : 1;
    return rank(a) - rank(b);
  });

  function paperName(item: PaperItem): string {
    const { paper } = item.config;
    return paper.id.includes('sample') ? 'Sample' : paper.division === 'junior' ? 'Junior' : 'Senior';
  }

  function paperFullName(item: PaperItem): string {
    const { paper } = item.config;
    return `${paper.season} ${paper.id.includes('sample') ? 'Senior sample' : paper.division} paper`;
  }

  function paperButton(item: PaperItem) {
    const paper = item.config.paper;
    return (
      <div className="paper-entry" key={item.key}>
        <button
          className={`paper-option ${selectedKey === item.key ? 'selected' : ''}`}
          onClick={() => onSelect(item.key)}
          aria-current={selectedKey === item.key ? 'page' : undefined}
          aria-label={paperFullName(item)}
          title={paper.title || paperFullName(item)}
        >
          {paperName(item)}
        </button>
        {item.private && (
          <button className="remove-paper" onClick={() => onRemove(item.key)} aria-label={`Remove ${paper.title || paper.id}`} title="Remove private paper">×</button>
        )}
      </div>
    );
  }

  return (
    <aside className="sidebar" aria-label="Paper library">
      <div className="brand"><span className="brand-mark" aria-hidden="true">H</span><strong>HKOI Heat FITB</strong></div>
      <div className="paper-browser">
        <div className="paper-tools">
          <label className="visually-hidden" htmlFor="paper-search">Find a paper</label>
          <input id="paper-search" type="search" placeholder="Find a year or paper" value={paperQuery} onChange={(event) => setPaperQuery(event.target.value)} />
          <div className="division-filter" role="group" aria-label="Division">
            {(['all', 'junior', 'senior'] as const).map((division) => <button key={division} type="button"
              className={divisionFilter === division ? 'active' : ''} aria-pressed={divisionFilter === division}
              onClick={() => setDivisionFilter(division)}>{division === 'all' ? 'All' : division === 'junior' ? 'Junior' : 'Senior'}</button>)}
          </div>
        </div>
        <nav className="paper-year-list" aria-label="Past papers">
          {[...byYear.entries()].map(([year, items]) => <div className="paper-year" key={year}>
            <span className="paper-year-label">{year}</span>
            <div className="paper-year-options">{items.map(paperButton)}</div>
          </div>)}
          {!matchingPapers.length && <p className="sidebar-empty">No matching papers.</p>}
        </nav>
        {privatePapers.length > 0 && <div className="imported-papers"><div className="sidebar-heading">Imported</div>
          <nav className="paper-year-options" aria-label="Imported papers">{privatePapers.map(paperButton)}</nav></div>}
      </div>
      <div className="sidebar-footer">
        <label className="visually-hidden" htmlFor="mobile-paper-select">Choose a paper</label>
        <select id="mobile-paper-select" className="mobile-paper-select" value={selectedKey || ''} onChange={(event) => onSelect(event.target.value)}>
          <optgroup label="Past papers">{publicPapers.map((item) => <option key={item.key} value={item.key}>{paperFullName(item)}</option>)}</optgroup>
          {privatePapers.length > 0 && <optgroup label="Imported">{privatePapers.map((item) => <option key={item.key} value={item.key}>{item.fileName || paperFullName(item)}</option>)}</optgroup>}
        </select>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          onChange={onImport}
          aria-label="Import a paper JSON file"
        />
        <button className="import-button" onClick={() => inputRef.current?.click()} disabled={importing}>
          <span aria-hidden="true">＋</span> {importing ? 'Reading…' : 'Import paper'}
        </button>
        {importError && <p className="import-error" role="alert">{importError}</p>}
      </div>
    </aside>
  );
}

function TrackPicker({ paper, selected, onChange }: { paper: PaperConfig; selected: string[]; onChange: (tracks: string[]) => void }) {
  const required = paper.tracks.filter((track) => track.selection === 'required');
  const groups = new Map<string, Track[]>();
  for (const track of paper.tracks.filter((item) => item.selection === 'choice')) {
    const key = track.choiceGroup || track.id;
    groups.set(key, [...(groups.get(key) || []), track]);
  }
  if (!groups.size) return null;
  return (
    <div className="track-picker" aria-label="Paper sections">
      {required.map((track) => <span className="track-required" key={track.id}>{track.label}</span>)}
      {[...groups.entries()].map(([group, options]) => (
        <div className="track-choice" key={group} role="group" aria-label={`${group} choice`}>
          <span className="track-choice-label">{group === 'paper2' ? 'Paper 2' : group}</span>
          <div className="track-buttons">
            {options.map((option) => (
              <button
                key={option.id}
                className={`track-button ${selected.includes(option.id) ? 'active' : ''}`}
                type="button"
                aria-pressed={selected.includes(option.id)}
                onClick={() => onChange([...selected.filter((id) => !options.some((item) => item.id === id)), option.id])}
              >{group === 'paper2' ? option.label.replace(/^Paper 2 · /, '') : option.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const tokenPattern = /(\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:alignas|and|auto|bool|break|case|class|const|continue|def|double|elif|else|enum|false|False|float|for|if|import|in|include|int|long|namespace|not|nullptr|or|print|return|self|static|std|str|struct|template|true|True|using|void|while)\b|\b\d+(?:\.\d+)?\b)/g;

function highlighted(text: string): ReactNode[] {
  const fragments: ReactNode[] = [];
  let previous = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const position = match.index ?? 0;
    if (position > previous) fragments.push(text.slice(previous, position));
    const token = match[0];
    const type = token.startsWith('//') || token.startsWith('#') ? 'comment'
      : token.startsWith('"') || token.startsWith("'") ? 'string'
      : /^\d/.test(token) ? 'number' : 'keyword';
    fragments.push(<span className={`syntax-${type}`} key={`${position}-${type}`}>{token}</span>);
    previous = position + token.length;
  }
  if (previous < text.length) fragments.push(text.slice(previous));
  return fragments;
}

function MarkdownPrompt({ text }: { text: string }) {
  return <div className="question-prompt">
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        pre({ children }) { return <pre className="prompt-code">{children}</pre>; },
        code({ className, children }) { return <code className={className || 'inline-code'}>{highlighted(String(children).replace(/\n$/, ''))}</code>; },
        img({ alt }) { return <span className="omitted-image">[{alt || 'Diagram in source paper'}]</span>; },
        a({ href, children }) {
          const safeHref = officialPaperLink(href ? { paperUrl: href } : undefined);
          return safeHref ? <a href={safeHref} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
        },
      }}
    >{text}</ReactMarkdown>
  </div>;
}

function QuestionFigure({ figure, questionId }: { figure: PaperFigure; questionId: string }) {
  if (figure.kind === 'paper-image') return <figure className="paper-figure"><img src={`${import.meta.env.BASE_URL}${figure.path}`} alt={figure.alt} loading="lazy" /></figure>;
  const positions = new Map(figure.nodes.map((node) => [node.id, { x: 35 + node.x * 530, y: 30 + node.y * 180 }]));
  const markerId = `arrow-${questionId}`;
  const directed = figure.kind === 'directed-graph';
  const description = `${directed ? 'Directed' : 'Undirected'} graph with nodes ${figure.nodes.map((node) => node.id).join(', ')} and edges ${figure.edges.map((edge) => `${edge.label ? `${edge.label}: ` : ''}${edge.from} ${directed ? 'to' : 'and'} ${edge.to}`).join(', ')}.`;
  return <figure className="graph-figure"><svg viewBox="0 0 600 240" role="img" aria-label={description}>
    <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#46769b" /></marker></defs>
    {figure.edges.map((edge, index) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return null;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const x1 = from.x + ux * 19;
      const y1 = from.y + uy * 19;
      const x2 = to.x - ux * 22;
      const y2 = to.y - uy * 22;
      const labelX = (x1 + x2) / 2 - uy * 12;
      const labelY = (y1 + y2) / 2 + ux * 12;
      return <g key={`${edge.from}-${edge.to}-${index}`}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#46769b" strokeWidth="2" {...(directed ? { markerEnd: `url(#${markerId})` } : {})} />{edge.label && <text x={labelX} y={labelY} textAnchor="middle" className="edge-label">{edge.label}</text>}</g>;
    })}
    {figure.nodes.map((node) => {
      const point = positions.get(node.id)!;
      return <g key={node.id}><circle cx={point.x} cy={point.y} r="17" fill="#fff" stroke="#537d9f" strokeWidth="2" /><text x={point.x} y={point.y + 4} textAnchor="middle" className="node-label">{node.id}</text></g>;
    })}
  </svg></figure>;
}

function contextCode(context: PaperContext, selectedLanguage?: Language): { language: Language; source: string } | null {
  const language = (selectedLanguage && context.displayCode?.[selectedLanguage]
    ? selectedLanguage : Object.keys(context.displayCode ?? {})[0]) as Language | undefined;
  const source = language ? context.displayCode?.[language] : undefined;
  return language && source ? { language, source } : null;
}

function ContextBlock({ context, questions, answers, selectedLanguage, activeQuestionId, onSelectAnswerSet, onAnswer }: {
  context: PaperContext;
  questions: Question[];
  answers: PaperAnswers;
  selectedLanguage?: Language;
  activeQuestionId?: string;
  onSelectAnswerSet: (questionId: string) => void;
  onAnswer: (questionId: string, blankId: string, value: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const code = contextCode(context, selectedLanguage);
  const activeSet = Math.max(0, context.answerSets?.findIndex((item) => item.questionId === activeQuestionId) ?? 0);
  const set = context.answerSets?.[activeSet];
  const owners = set
    ? new Map(Object.entries(set.bindings).flatMap(([slot, blankId]) => {
      const question = questions.find((item) => item.id === set.questionId);
      const blank = question?.blanks.find((item) => item.id === blankId);
      return question && blank ? [[slot, { question, blank }] as const] : [];
    }))
    : new Map(questions.flatMap((question) => question.blanks.map((blank) => [blank.id, { question, blank }] as const)));
  return <details id={`context-${context.id}`} className="context-block" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{context.title || 'Shared instructions'}</summary>
    {context.markdown && <MarkdownPrompt text={context.markdown} />}
    {context.answerSets && <div className="language-tabs" role="tablist" aria-label={`${context.title || 'Code'} answer set`}>
      {context.answerSets.map((item, index) => <button key={item.questionId} type="button" role="tab" aria-selected={index === activeSet}
        className={index === activeSet ? 'active' : ''} onClick={() => onSelectAnswerSet(item.questionId)}>{item.label}</button>)}
    </div>}
    {code && <SharedCodeTemplate language={code.language} source={code.source} owners={owners} answers={answers} onAnswer={onAnswer} />}
  </details>;
}

function AnswerInput({
  blank,
  value,
  onChange,
  inline = false,
  showLabel = true,
  questionTitle,
}: {
  blank: Blank;
  value: string;
  onChange: (value: string) => void;
  inline?: boolean;
  showLabel?: boolean;
  questionTitle: string;
}) {
  const remaining = blank.maxChars === undefined ? null : blank.maxChars - countChars(value);
  const label = `${questionTitle}: ${blank.label || blank.id}`;
  const width = `${Math.min(80, Math.max(inline ? 42 : 46, (blank.maxChars ?? 24) + 16, countChars(value) + 12))}ch`;
  return (
    <span className={inline ? 'answer-inline' : 'answer-field'}>
      {!inline && showLabel && <label className="answer-label" htmlFor={`${questionTitle}-${blank.id}`}>{blank.label || `Blank ${blank.id}`}</label>}
      {inline && <span className="inline-blank-label" aria-hidden="true">{blank.label || blank.id}</span>}
      {blank.multiline ? (
        <textarea
          id={inline ? undefined : `${questionTitle}-${blank.id}`}
          aria-label={inline || !showLabel ? label : undefined}
          className={inline ? 'inline-textarea' : 'answer-textarea'}
          style={inline ? { width } : undefined}
          value={value}
          onChange={(event) => onChange(capAnswer(event.target.value, blank.maxChars))}
          placeholder={blank.placeholder || 'Type your answer'}
          spellCheck={false}
          rows={inline ? 2 : 4}
        />
      ) : (
        <input
          id={inline ? undefined : `${questionTitle}-${blank.id}`}
          aria-label={inline || !showLabel ? label : undefined}
          className={inline ? 'inline-input' : 'answer-input'}
          style={{ width }}
          value={value}
          onChange={(event) => onChange(capAnswer(event.target.value, blank.maxChars))}
          placeholder={blank.placeholder || 'Type your answer'}
          spellCheck={false}
          autoComplete="off"
        />
      )}
      {remaining !== null && <span className={`char-count ${remaining === 0 ? 'at-limit' : ''}`} aria-label={`${remaining} characters remaining`} aria-live="polite">{remaining}</span>}
    </span>
  );
}

function CodeTemplate({
  target,
  question,
  values,
  onAnswer,
}: {
  target: ProgramTarget;
  question: Question;
  values: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
}) {
  const parts = target.source.split(/(\{\{[A-Za-z][A-Za-z0-9_-]*\}\})/g);
  const shown = new Set<string>();
  return (
    <div className="code-frame">
      <div className="code-toolbar"><span className="code-dots" aria-hidden="true"><i /><i /><i /></span><span>{target.language.toUpperCase()} · {target.harness.kind === 'call' ? 'function completion' : 'program completion'}</span></div>
      <pre className="code-source"><code>{parts.map((part, index) => {
        const match = /^\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}$/.exec(part);
        if (!match) return <span key={index}>{highlighted(part)}</span>;
        const blank = question.blanks.find((item) => item.id === match[1]);
        if (!blank) return <span key={index}>{part}</span>;
        shown.add(blank.id);
        return <AnswerInput key={index} blank={blank} value={values[blank.id] || ''} onChange={(value) => onAnswer(blank.id, value)} inline questionTitle={question.title} />;
      })}</code></pre>
      {question.blanks.some((blank) => !shown.has(blank.id)) && (
        <div className="extra-blanks">{question.blanks.filter((blank) => !shown.has(blank.id)).map((blank) => (
          <AnswerInput key={blank.id} blank={blank} value={values[blank.id] || ''} onChange={(value) => onAnswer(blank.id, value)} questionTitle={question.title} />
        ))}</div>
      )}
    </div>
  );
}

function SharedCodeTemplate({ language, source, owners, answers, onAnswer }: {
  language: Language;
  source: string;
  owners: Map<string, { question: Question; blank: Blank }>;
  answers: PaperAnswers;
  onAnswer: (questionId: string, blankId: string, value: string) => void;
}) {
  const parts = source.split(/(\{\{[A-Za-z][A-Za-z0-9_-]*\}\})/g);
  return <div className="code-frame">
    <div className="code-toolbar"><span className="code-dots" aria-hidden="true"><i /><i /><i /></span><span>{language.toUpperCase()} · code completion</span></div>
    <pre className="code-source"><code>{parts.map((part, index) => {
      const marker = /^\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}$/.exec(part);
      if (!marker) return <span key={index}>{highlighted(part)}</span>;
      const owner = owners.get(marker[1]);
      if (!owner) return <span key={index}>{part}</span>;
      if (owner.question.grading.kind === 'cancelled') return <span key={index}>________</span>;
      return <AnswerInput key={index} blank={owner.blank} value={answers[owner.question.id]?.[owner.blank.id] || ''}
        onChange={(value) => onAnswer(owner.question.id, owner.blank.id, value)} inline questionTitle={owner.question.printedRef} />;
    })}</code></pre>
  </div>;
}

function DisplayCode({ language, source }: { language: Language; source: string }) {
  return <div className="code-frame">
    <div className="code-toolbar"><span className="code-dots" aria-hidden="true"><i /><i /><i /></span><span>{language.toUpperCase()}</span></div>
    <pre className="code-source"><code>{highlighted(source)}</code></pre>
  </div>;
}

function parseEdges(value: string): [string, string][] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((edge) => Array.isArray(edge) && edge.length === 2 && edge.every((node) => typeof node === 'string'))) return null;
    return parsed as [string, string][];
  } catch { return null; }
}

function GraphAnswer({
  question,
  grading,
  values,
  onAnswer,
}: {
  question: Question;
  grading: GraphGrading;
  values: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
}) {
  const blank = question.blanks.find((item) => item.id === grading.answerBlank);
  const answer = values[grading.answerBlank] || '';
  const edges = parseEdges(answer || '[]');
  const [from, setFrom] = useState(grading.nodes[0] || '');
  const [to, setTo] = useState(grading.nodes[1] || grading.nodes[0] || '');
  if (!blank) return <p className="inline-error">This graph question has no answer blank.</p>;
  const cap = (value: string) => onAnswer(blank.id, capAnswer(value, blank.maxChars));
  return (
    <div className="graph-editor">
      {!question.figure && <div className="base-graph"><strong>Base graph</strong><p>Nodes: {grading.nodes.join(', ')}</p><div className="base-edges">{grading.baseEdges.length ? grading.baseEdges.map(([a, b], index) => <span key={`${a}-${b}-${index}`}>{a} → {b}</span>) : <span>No base edges</span>}</div></div>}
      <p className="answer-help">Add directed edges.</p>
      <div className="graph-builder">
        <label>From <select value={from} onChange={(event) => setFrom(event.target.value)}>{grading.nodes.map((node) => <option key={node}>{node}</option>)}</select></label>
        <span aria-hidden="true">→</span>
        <label>To <select value={to} onChange={(event) => setTo(event.target.value)}>{grading.nodes.map((node) => <option key={node}>{node}</option>)}</select></label>
        <button type="button" className="secondary-button" disabled={!edges || !from || !to} onClick={() => cap(JSON.stringify([...(edges || []), [from, to]]))}>Add edge</button>
      </div>
      {edges && edges.length > 0 && <div className="edge-chips">{edges.map((edge, index) => (
        <span className="edge-chip" key={`${index}-${edge.join('-')}`}>{edge[0]} → {edge[1]} <button type="button" aria-label={`Remove edge ${edge[0]} to ${edge[1]}`} onClick={() => cap(JSON.stringify(edges.filter((_, current) => current !== index)))}>×</button></span>
      ))}</div>}
      {edges === null && answer && <p className="field-note error" role="alert">The saved edge list could not be read.</p>}
    </div>
  );
}

function QuestionResult({ result }: { result: QuestionGrade }) {
  return (
    <div className={`question-result result-${result.status}`} role="status">
      <div className="result-topline"><strong>{statusName(result.status)}</strong><span>{result.status === 'cancelled' ? 'Excluded from score' : result.score === null ? 'No score' : `${result.score} / ${result.maxScore} points`}</span></div>
      {result.message && result.status !== 'cancelled' && <p>{result.message}</p>}
      {result.cases.length > 0 && <details className="case-details"><summary>{result.cases.filter((item) => item.status === 'pass').length} of {result.cases.length} checks passed · details</summary>
        <ul>{result.cases.map((testCase) => <li key={testCase.id} className={`case-${testCase.status}`}><span aria-hidden="true">{testCase.status === 'pass' ? '✓' : testCase.status === 'fail' ? '×' : '•'}</span> <strong>{testCase.id}</strong>{testCase.message ? ` — ${testCase.message}` : ''}</li>)}</ul>
      </details>}
    </div>
  );
}

function RobotAnswer({
  question,
  grading,
  values,
  onAnswer,
}: {
  question: Question;
  grading: RobotGridGrading;
  values: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const foundBlank = question.blanks.find((item) => item.id === grading.answerBlank);
  if (!foundBlank) return <p className="inline-error">This robot question has no answer blank.</p>;
  const blank: Blank = foundBlank;
  const value = values[blank.id] || '';
  const remaining = blank.maxChars === undefined ? null : blank.maxChars - countChars(value);
  const tokens = Object.entries(grading.dialect.commands);
  const bracket = grading.dialect.repeatSyntax === 'bracket-number' || grading.dialect.repeatSyntax === 'both';
  const paren = grading.dialect.repeatSyntax === 'paren-number' || grading.dialect.repeatSyntax === 'both';
  const repeatEnabled = bracket || paren;
  const maxRepeat = grading.dialect.maxRepeat ?? 9;
  const digits = repeatEnabled ? Array.from({ length: Math.min(maxRepeat, 9) }, (_, index) => String(index + 1)) : [];
  if (repeatEnabled && maxRepeat >= 10) digits.unshift('0');

  function insert(token: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const edit = insertRobotToken(value, start, end, token, blank.maxChars);
    if (!edit) return;
    onAnswer(blank.id, edit.value);
    window.requestAnimationFrame(() => {
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(edit.cursor, edit.cursor);
    });
  }

  function backspace() {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const edit = deleteBeforeCursor(value, start, end);
    if (!edit) return;
    onAnswer(blank.id, edit.value);
    window.requestAnimationFrame(() => {
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(edit.cursor, edit.cursor);
    });
  }

  const direction = ([dx, dy]: [number, number]) => dx === 0 && dy === -1 ? 'up' : dx === 0 && dy === 1 ? 'down' : dx === -1 && dy === 0 ? 'left' : dx === 1 && dy === 0 ? 'right' : `move ${dx}, ${dy}`;
  const tokenButton = (token: string, label: string) => <button key={`${label}-${token}`} type="button" className="robot-token" aria-label={`Insert ${label}`} title={`Insert ${label}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(token)}>{token}</button>;
  return <div className="robot-editor">
    <div className="robot-input-row"><input ref={inputRef} type="text" className="robot-input" value={value} onChange={(event) => onAnswer(blank.id, capAnswer(event.target.value, blank.maxChars))} aria-label={`${question.printedRef}: robot command`} placeholder="Robot command" spellCheck={false} autoComplete="off" />{remaining !== null && <span className="robot-count" aria-label={`${remaining} characters remaining`} aria-live="polite">{remaining}</span>}</div>
    <div className="robot-toolbar" aria-label="Robot command buttons">
      <div className="robot-token-group"><span>Moves</span>{tokens.map(([token, vector]) => tokenButton(token, `${direction(vector)} (${token})`))}</div>
      {repeatEnabled && <div className="robot-token-group"><span>Repeat</span>{bracket && <>{tokenButton('[', 'opening square bracket')}{tokenButton(']', 'closing square bracket')}</>}{paren && <>{tokenButton('(', 'opening parenthesis')}{tokenButton(')', 'closing parenthesis')}</>}{digits.map((digit) => tokenButton(digit, `digit ${digit}`))}</div>}
      <button type="button" className="robot-backspace" onMouseDown={(event) => event.preventDefault()} onClick={backspace} aria-label="Delete before cursor">⌫</button>
    </div>
    {question.blanks.filter((item) => item.id !== blank.id).map((item) => <AnswerInput key={item.id} blank={item} value={values[item.id] || ''} onChange={(answer) => onAnswer(item.id, answer)} questionTitle={question.printedRef} />)}
  </div>;
}

function DieFaceAnswer({ question, answerBlank, value, onAnswer }: {
  question: Question; answerBlank: string; value: string; onAnswer: (id: string, value: string) => void;
}) {
  const clean = /^[.o]{3}\/[.o]{3}\/[.o]{3}$/.test(value) ? value : '.../.../...';
  const cells = clean.replaceAll('/', '').split('');
  function toggle(index: number) {
    const next = [...cells];
    next[index] = next[index] === 'o' ? '.' : 'o';
    onAnswer(answerBlank, `${next.slice(0, 3).join('')}/${next.slice(3, 6).join('')}/${next.slice(6).join('')}`);
  }
  return <div className="die-editor">
    <div className="die-grid" role="group" aria-label={`${question.printedRef}: die face`}>
      {cells.map((cell, index) => <button key={index} type="button" className={`die-cell ${cell === 'o' ? 'has-pip' : ''}`}
        aria-label={`Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}`}
        aria-pressed={cell === 'o'} onClick={() => toggle(index)}><span aria-hidden="true">{cell === 'o' ? '●' : ''}</span></button>)}
    </div>
    <span className="die-hint">Click cells to place pips.</span>
  </div>;
}

function LogoDrawingAnswer({ question, answerBlank, value, onAnswer }: {
  question: Question; answerBlank: string; value: string; onAnswer: (id: string, value: string) => void;
}) {
  type Point = [number, number];
  type Segment = [Point, Point];
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  let segments: Segment[] = [];
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) segments = parsed; } catch { /* No saved drawing. */ }
  function point(event: ReactPointerEvent<SVGSVGElement>): Point {
    const box = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))];
  }
  function begin(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = point(event); setStart(next); setEnd(next);
  }
  function finish(event: ReactPointerEvent<SVGSVGElement>) {
    if (!start) return;
    const last = point(event);
    if (Math.hypot(start[0] - last[0], start[1] - last[1]) > 0.015 && segments.length < 40)
      onAnswer(answerBlank, JSON.stringify([...segments, [start, last]]));
    setStart(null); setEnd(null);
  }
  const line = ([a,b]: Segment, key: number) => <line key={key} x1={a[0]*400} y1={a[1]*320} x2={b[0]*400} y2={b[1]*320} />;
  return <div className="drawing-editor">
    <svg className="drawing-canvas" viewBox="0 0 400 320" aria-label={`${question.printedRef}: draw the program output with line drags`}
      onPointerDown={begin} onPointerMove={event => { if (start) setEnd(point(event)); }} onPointerUp={finish}
      onPointerCancel={() => { setStart(null); setEnd(null); }}>
      <rect width="400" height="320" className="drawing-background" />
      <g className="drawing-lines">{segments.map(line)}{start && end && line([start,end],-1)}</g>
    </svg>
    <div className="drawing-tools"><span>Draw six rough sides with separate drags; the joins need not be exact.</span><button type="button" onClick={() => onAnswer(answerBlank, JSON.stringify(segments.slice(0,-1)))} disabled={!segments.length}>Undo</button><button type="button" onClick={() => onAnswer(answerBlank, '[]')} disabled={!segments.length}>Clear</button></div>
  </div>;
}

function QuestionCard({
  question,
  selectedLanguage,
  sharedCode,
  onEditShared,
  paperSource,
  values,
  result,
  busy,
  onAnswer,
  onCheck,
}: {
  question: Question;
  selectedLanguage?: Language;
  sharedCode: boolean;
  onEditShared?: () => void;
  paperSource?: SourceRef;
  values: Record<string, string>;
  result?: QuestionGrade;
  busy: boolean;
  onAnswer: (blankId: string, value: string) => void;
  onCheck: () => void;
}) {
  const [targetIndex, setTargetIndex] = useState(0);
  const grading = question.grading;
  const selectedTarget = grading.kind === 'program' ? grading.targets.find((item) => item.language === selectedLanguage) : undefined;
  const target = grading.kind === 'program' ? selectedTarget ?? grading.targets[Math.min(targetIndex, grading.targets.length - 1)] : null;
  const displayLanguage = (selectedLanguage && question.displayCode?.[selectedLanguage] ? selectedLanguage : Object.keys(question.displayCode ?? {})[0]) as Language | undefined;
  const displaySource = !sharedCode && displayLanguage ? question.displayCode?.[displayLanguage] : undefined;
  const displayHasBlanks = !!displaySource && /\{\{[A-Za-z][A-Za-z0-9_-]*\}\}/.test(displaySource);
  const source = question.source?.paperUrl ? question.source : paperSource;
  const sourceUrl = officialPaperLink(source);
  return (
    <article className="question-card" id={`question-${question.id}`}>
      <div className="question-head"><h3>{question.printedRef}</h3><div className="question-tools"><span>{question.points} {question.points === 1 ? 'point' : 'points'}</span>{sourceUrl && <a className="source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">Paper PDF{source?.page ? ` · p. ${source.page}` : ''} <span aria-hidden="true">↗</span></a>}</div></div>
      {question.prompt.en && <MarkdownPrompt text={question.prompt.en} />}
      {sharedCode && onEditShared && <button type="button" className="shared-code-link" onClick={onEditShared}>Edit in shared code ↑</button>}
      {question.figure && <QuestionFigure figure={question.figure} questionId={question.id} />}
      {displaySource && displayLanguage && grading.kind === 'cancelled' && <DisplayCode language={displayLanguage} source={displaySource.replace(/\{\{[A-Za-z][A-Za-z0-9_-]*\}\}/g, '________')} />}
      {displaySource && displayLanguage && grading.kind !== 'cancelled' && (displayHasBlanks
        ? <CodeTemplate target={{ language: displayLanguage, source: displaySource, harness: { kind: 'call', function: 'display' } }} question={question} values={values} onAnswer={onAnswer} />
        : <DisplayCode language={displayLanguage} source={displaySource} />)}
      {grading.kind === 'program' && !displaySource && !sharedCode && (
        <>
          {grading.targets.length > 1 && !selectedTarget && <div className="language-tabs" role="tablist" aria-label={`${question.title} source language`}>{grading.targets.map((item, current) => <button type="button" key={`${item.language}-${current}`} role="tab" aria-selected={current === targetIndex} className={current === targetIndex ? 'active' : ''} onClick={() => setTargetIndex(current)}>{item.language.toUpperCase()}</button>)}</div>}
          {target && <CodeTemplate target={target} question={question} values={values} onAnswer={onAnswer} />}
        </>
      )}
      {grading.kind === 'graph' && <GraphAnswer question={question} grading={grading} values={values} onAnswer={onAnswer} />}
      {grading.kind === 'robot-grid' && <RobotAnswer question={question} grading={grading} values={values} onAnswer={onAnswer} />}
      {grading.kind === 'die-face' && <DieFaceAnswer question={question} answerBlank={grading.answerBlank} value={values[grading.answerBlank] || ''} onAnswer={onAnswer} />}
      {grading.kind === 'logo-drawing' && <LogoDrawingAnswer question={question} answerBlank={grading.answerBlank} value={values[grading.answerBlank] || ''} onAnswer={onAnswer} />}
      {!sharedCode && (grading.kind !== 'program' || (!!displaySource && !displayHasBlanks)) && grading.kind !== 'graph' && grading.kind !== 'robot-grid' && grading.kind !== 'die-face' && grading.kind !== 'logo-drawing' && grading.kind !== 'cancelled' && !displayHasBlanks && <div className="answer-fields">{question.blanks.map((blank) => <AnswerInput key={blank.id} blank={blank} value={values[blank.id] || ''} onChange={(value) => onAnswer(blank.id, value)} showLabel={question.blanks.length > 1} questionTitle={question.printedRef} />)}</div>}
      {grading.kind === 'pending' && <p className="pending-note">Grader pending: {grading.reason}</p>}
      {grading.kind === 'cancelled' && <p className="cancelled-note">{grading.reason}</p>}
      {grading.kind !== 'cancelled' && <div className="question-actions"><button type="button" className="check-button" onClick={onCheck} disabled={busy || grading.kind === 'pending'}>{busy ? 'Checking…' : 'Check'}</button></div>}
      {result && <QuestionResult result={result} />}
    </article>
  );
}

function Summary({ questions, results, fullResult, busyAll }: { questions: Question[]; results: GradeMap; fullResult: PaperGrade | null; busyAll: boolean }) {
  const visible = questions.map((question) => results[question.id]).filter((result): result is QuestionGrade => !!result);
  const scored = visible.reduce((sum, result) => sum + (result.score || 0), 0);
  const scoredMax = visible.reduce((sum, result) => sum + (result.score === null ? 0 : result.maxScore), 0);
  const possible = questions.reduce((sum, question) => sum + question.points, 0);
  const complete = !!fullResult?.complete;
  return <div className="summary-bar" aria-live="polite"><span><strong>{visible.length}/{questions.length}</strong> checked</span><span><strong>{scored}/{scoredMax}</strong> {complete ? 'score' : 'subtotal'}</span><span><strong>{scoredMax}/{possible}</strong> points covered</span>{busyAll && <span>Checking…</span>}</div>;
}

export default function App() {
  const [privatePapers, setPrivatePapers] = useState<PaperItem[]>([]);
  const papers = useMemo(() => [...bundledItems, ...privatePapers], [privatePapers]);
  const [selectedKey, setSelectedKey] = useState<string | null>(bundledItems[0]?.key || null);
  const selectedItem = papers.find((item) => item.key === selectedKey) || null;
  const paper = selectedItem?.config || null;
  const [selectedTracks, setSelectedTracks] = useState<string[]>(() => paper ? initialTracks(paper) : []);
  const [activeContextQuestions, setActiveContextQuestions] = useState<Record<string, string>>({});
  const [answersByPaper, setAnswersByPaper] = useState<Record<string, PaperAnswers>>({});
  const [resultsByPaper, setResultsByPaper] = useState<Record<string, GradeMap>>({});
  const [fullResults, setFullResults] = useState<Record<string, PaperGrade | null>>({});
  const [busyQuestion, setBusyQuestion] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const importSequence = useRef(0);
  const visibleQuestions = paper ? displayedQuestions(paper, selectedTracks) : [];
  const answers = selectedKey ? answersByPaper[selectedKey] || {} : {};
  const results = selectedKey ? resultsByPaper[selectedKey] || {} : {};
  const fullResult = selectedKey ? fullResults[selectedKey] || null : null;
  const selectedLanguage: Language | undefined = selectedTracks.includes('python') ? 'python' : selectedTracks.includes('cpp') ? 'cpp' : undefined;
  const sections: { key: string; label: string; questions: Question[] }[] = [];
  if (paper) for (const question of visibleQuestions) {
    const track = trackLabel(paper, question.track);
    const section = sectionName(question);
    const label = track.toLowerCase() === section.toLowerCase() ? track : `${track} · ${section}`;
    const key = `${question.track}:${sectionName(question)}`;
    const last = sections[sections.length - 1];
    if (last?.key === key) last.questions.push(question);
    else sections.push({ key, label, questions: [question] });
  }
  const contextStarts = new Map<string, PaperContext>();
  const seenContexts = new Set<string>();
  if (paper) for (const question of visibleQuestions) {
    if (!question.contextId || seenContexts.has(question.contextId)) continue;
    const context = paper.contexts?.find((item) => item.id === question.contextId);
    if (context) { contextStarts.set(question.id, context); seenContexts.add(context.id); }
  }

  function selectPaper(key: string) {
    const next = papers.find((item) => item.key === key);
    if (!next) return;
    setSelectedKey(key);
    setSelectedTracks(initialTracks(next.config));
    setGradeError(null);
  }

  function removePaper(key: string) {
    setPrivatePapers((items) => items.filter((item) => item.key !== key));
    setAnswersByPaper((all) => { const next = { ...all }; delete next[key]; return next; });
    setResultsByPaper((all) => { const next = { ...all }; delete next[key]; return next; });
    setFullResults((all) => { const next = { ...all }; delete next[key]; return next; });
    if (selectedKey === key) {
      setSelectedKey(bundledItems[0]?.key || null);
      setSelectedTracks(bundledItems[0] ? initialTracks(bundledItems[0].config) : []);
    }
  }

  async function importPaper(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError(null);
    setImporting(true);
    try {
      if (file.size > 2_000_000) throw new Error('The JSON file is too large (limit: 2 MB).');
      const config = validatePaper(JSON.parse(await file.text()));
      const key = `private:${++importSequence.current}`;
      setPrivatePapers((items) => [...items, { key, config, private: true, fileName: file.name }]);
      setSelectedKey(key);
      setSelectedTracks(initialTracks(config));
      setGradeError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read this paper.');
    } finally { setImporting(false); }
  }

  function changeAnswer(questionId: string, blankId: string, value: string) {
    if (!selectedKey) return;
    setAnswersByPaper((all) => ({ ...all, [selectedKey]: { ...(all[selectedKey] || {}), [questionId]: { ...(all[selectedKey]?.[questionId] || {}), [blankId]: value } } }));
    setResultsByPaper((all) => { const next = { ...(all[selectedKey] || {}) }; delete next[questionId]; return { ...all, [selectedKey]: next }; });
    setFullResults((all) => ({ ...all, [selectedKey]: null }));
    setGradeError(null);
  }

  async function checkOne(question: Question) {
    if (!selectedKey || busyQuestion || busyAll) return;
    const key = selectedKey;
    setBusyQuestion(question.id);
    setGradeError(null);
    try {
      const result = await gradeQuestion(question, answersByPaper[key]?.[question.id] || {}, selectedLanguage);
      setResultsByPaper((all) => ({ ...all, [key]: { ...(all[key] || {}), [question.id]: result } }));
      setFullResults((all) => ({ ...all, [key]: null }));
    } catch (error) {
      setGradeError(error instanceof Error ? error.message : 'Checking failed.');
    } finally { setBusyQuestion(null); }
  }

  async function checkAll() {
    if (!paper || !selectedKey || busyQuestion || busyAll) return;
    const key = selectedKey;
    setBusyAll(true);
    setGradeError(null);
    try {
      const result = await gradePaper(paper, answersByPaper[key] || {}, selectedTracks);
      setResultsByPaper((all) => ({ ...all, [key]: Object.fromEntries(result.questions.map((question) => [question.questionId, question])) }));
      setFullResults((all) => ({ ...all, [key]: result }));
    } catch (error) {
      setGradeError(error instanceof Error ? error.message : 'Checking failed.');
    } finally { setBusyAll(false); }
  }

  return <div className="app-shell">
    <Sidebar papers={papers} selectedKey={selectedKey} onSelect={selectPaper} onImport={importPaper} onRemove={removePaper} importError={importError} importing={importing} />
    <main className="main-content">
      {paper ? <>
        <header className="page-header"><h1>{paper.paper.title || `${paper.paper.season} Heat`}</h1>{selectedItem?.private && <span className="private-banner">Imported: {selectedItem.fileName}</span>}</header>
        <TrackPicker paper={paper} selected={selectedTracks} onChange={(tracks) => { setSelectedTracks(tracks); if (selectedKey) setFullResults((all) => ({ ...all, [selectedKey]: null })); }} />
        <Summary questions={visibleQuestions} results={results} fullResult={fullResult} busyAll={busyAll} />
        <div className="section-bar"><h2>Questions</h2><button type="button" className="check-all-button" disabled={busyAll || !!busyQuestion || visibleQuestions.length === 0} onClick={checkAll}>{busyAll ? 'Checking…' : 'Check all'}</button></div>
        <nav className="question-nav" aria-label="Jump to question">{sections.map((section) => <div className="question-nav-group" key={section.key}><strong>{section.label}</strong><div>{section.questions.map((question) => <a key={question.id} href={`#question-${question.id}`} className={results[question.id] ? `nav-${results[question.id].status}` : ''}>{jumpName(question)}</a>)}</div></div>)}</nav>
        {gradeError && <div className="global-error" role="alert">{gradeError}</div>}
        <div className="questions-list">{sections.map((section) => <section className="paper-section" key={section.key}>
          <h2>{section.label}</h2>
          {section.questions.map((question) => {
            const start = contextStarts.get(question.id);
            const context = paper.contexts?.find((item) => item.id === question.contextId);
            const shared = context ? contextCode(context, selectedLanguage) : null;
            const markers = new Set([...shared?.source.matchAll(/{{([A-Za-z0-9][A-Za-z0-9._-]*)}}/g) ?? []].map((match) => match[1]));
            const answerSet = context?.answerSets?.find((item) => item.questionId === question.id);
            const sharedCode = question.blanks.length > 0 && (answerSet
              ? question.blanks.every((blank) => Object.values(answerSet.bindings).includes(blank.id))
              : question.blanks.every((blank) => markers.has(blank.id)));
            return <Fragment key={`${paper.paper.id}:${question.id}`}>
              {start && <ContextBlock context={start} questions={paper.questions.filter((item) => item.contextId === start.id)} answers={answers}
                selectedLanguage={selectedLanguage} activeQuestionId={activeContextQuestions[`${paper.paper.id}:${start.id}`]}
                onSelectAnswerSet={(questionId) => setActiveContextQuestions((all) => ({ ...all, [`${paper.paper.id}:${start.id}`]: questionId }))}
                onAnswer={changeAnswer} />}
              <QuestionCard question={question} selectedLanguage={selectedLanguage} sharedCode={sharedCode} paperSource={paper.paper.source}
                values={answers[question.id] || {}} result={results[question.id]} busy={busyAll || !!busyQuestion}
                onEditShared={sharedCode && context ? () => {
                  if (answerSet) setActiveContextQuestions((all) => ({ ...all, [`${paper.paper.id}:${context.id}`]: question.id }));
                  const element = document.getElementById(`context-${context.id}`);
                  if (element instanceof HTMLDetailsElement) element.open = true;
                  element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } : undefined}
                onAnswer={(blankId, value) => changeAnswer(question.id, blankId, value)} onCheck={() => checkOne(question)} />
            </Fragment>;
          })}
        </section>)}</div>
        {visibleQuestions.length === 0 && <div className="empty-state">There are no questions in the selected sections.</div>}
      </> : <div className="welcome-state"><h1>No paper selected</h1><p>Import a paper JSON file to begin.</p></div>}
    </main>
  </div>;
}
