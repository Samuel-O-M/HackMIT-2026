/**
 * Mirror of `shared/types.ts`.
 *
 * `shared/types.ts` does not exist on this branch yet. This file is a verbatim
 * transcription of the contract documented in CLAUDE.md so the UI can be built
 * and typechecked now. When `shared/types.ts` lands on `main`, this file should
 * shrink to a single re-export:
 *
 *     export * from '../../../shared/types';
 *
 * Do not add UI-only fields here. Those belong in `src/types/ui.ts`.
 */

export type ChangeType = 'add' | 'stop' | 'modify' | 'confirm_unchanged';
export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'edited';
export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

export interface ConmedEntry {
  logId: string;
  reportedText: string;
  rxcui: string | null;
  canonicalName: string | null;
  indication: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  startDate: string | null;
  startDatePrecision: DatePrecision;
  stopDate: string | null;
  stopDatePrecision: DatePrecision;
  ongoing: boolean;
}

export interface ProhibitedHit {
  ruleId: string;
  matchedOn: 'drug' | 'class';
  className: string | null;
  protocolSection: string;
  rationale: string;
}

export interface ToolStep {
  tool: string;
  input: string;
  output: string;
}

export interface ProposedChange {
  changeId: string;
  changeType: ChangeType;
  targetLogId: string | null;
  current: ConmedEntry | null;
  proposed: ConmedEntry;
  agentConfidence: number;
  agentReasoning: string;
  toolTrace: ToolStep[];
  prohibitedHit: ProhibitedHit | null;
  reviewStatus: ReviewStatus;
}

export type SessionStatus = 'in_progress' | 'awaiting_review' | 'completed';

export interface ReconciliationSession {
  sessionId: string;
  subjectId: string;
  studyId: string;
  nctId: string;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  changes: ProposedChange[];
}
