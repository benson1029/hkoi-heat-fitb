import type { Language, PaperAnswers, Question } from '../core/types';

/** Only the public question, current answers and tests are sent to the worker. */
export interface SolveRequest {
  question: Question;
  /** Single blank search; retained for existing callers. */
  blankId?: string;
  /** Joint search when two or more IDs are supplied. */
  blankIds?: string[];
  language?: Language;
  /** Python execution mode for validating candidates. */
  pythonRuntime?: 'custom' | 'pyodide';
  knownAnswers?: Record<string, string>;
  /** Answers elsewhere in the paper, for graders with cross-question references. */
  allAnswers?: PaperAnswers;
  strategy?: 'templates' | 'grammar' | 'hybrid' | 'deep' | 'exhaustive';
  maxCandidates?: number;
  maxResults?: number;
  maxMs?: number;
}

export interface SolveProgress {
  tested: number;
  generated: number;
  found: string[];
  /** Fully verified answer maps returned by joint search. */
  assignments?: Record<string, string>[];
  elapsedMs: number;
}

export interface SolveResult extends SolveProgress {
  status: 'complete' | 'limit' | 'cancelled' | 'unsupported' | 'error';
  message?: string;
}

export type WorkerRequest =
  | { type: 'start'; id: number; request: SolveRequest }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: SolveProgress }
  | { type: 'result'; id: number; result: SolveResult };
