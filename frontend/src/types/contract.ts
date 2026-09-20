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
  /**
   * Follow-up answers from the call, in the participant's terms. All optional:
   * absent or null means the agent never asked, which is not the same as "no".
   */
  effectiveness?: Effectiveness | null;
  sideEffects?: SideEffects | null;
  /** What they said, when they reported something. Verbatim. */
  sideEffectsNote?: string | null;
  /** Why they stopped or changed it. Verbatim. */
  stopReason?: string | null;
}

export type Effectiveness = 'working' | 'partly' | 'not_working' | 'unsure';
/**
 * `serious` is only ever set for the fixed red-flag list in the agent's policy
 * (chest pain, trouble breathing, swelling, ...). It is not a severity
 * judgement; it exists so a person sees it quickly.
 */
export type SideEffects = 'none' | 'reported' | 'serious' | 'unsure';

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
  /**
   * Symptoms the participant described that are not tied to one medication
   * ("I get chest tightness sometimes"). A person needs to see these, but there
   * is no medication row to hang them on. Words are the participant's own.
   */
  safetyFlags?: SafetyFlag[];
}

export interface SafetyFlag {
  detail: string;
}
