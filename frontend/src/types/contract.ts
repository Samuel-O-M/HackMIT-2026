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

/**
 * Whether the medication is actually being taken.
 *
 * Separate from the log, which records what was prescribed. A trial can only
 * interpret an efficacy signal against what was actually swallowed.
 */
export type AdherenceExtent =
  | 'as_prescribed'
  | 'missed_some'
  | 'stopped'
  | 'never_started'
  | 'unknown';

export type AdherenceReason =
  | 'forgot'
  | 'side_effects'
  | 'felt_better'
  | 'cost'
  | 'too_many'
  | 'ran_out'
  | 'instructions_unclear'
  | 'other';

export interface AdherenceReport {
  canonicalName: string | null;
  isStudyDrug: boolean;
  extent: AdherenceExtent;
  /** Count within `recallDays`. Null means not established, which is not zero. */
  daysMissed: number | null;
  recallDays: number;
  reasons: AdherenceReason[];
  reportedText: string | null;
}

/**
 * 'declined_to_answer' is a distinct finding, not a 'denied'. A coordinator
 * follows up a refusal; they do not follow up a no.
 */
export type BehaviourStatus = 'reported' | 'denied' | 'declined_to_answer' | 'unknown';

/** 'required' rules are breached by absence — contraception, chiefly. */
export type BehaviourRuleType = 'prohibited' | 'restricted' | 'monitored' | 'required';

export interface BehaviourRule {
  ruleType: BehaviourRuleType;
  threshold: string | null;
  protocolSection: string | null;
  rationale: string | null;
}

export interface BehaviourReport {
  /** alcohol | nicotine | contraception | blood_donation | sun_exposure | … */
  behaviourCode: string;
  status: BehaviourStatus;
  reportedText: string | null;
  frequency: string | null;
  quantity: string | null;
  period: string | null;
  /** A validated screen, where one applies. AUDIT-C is the only one so far. */
  instrument: string | null;
  instrumentScore: number | null;
  rule: BehaviourRule | null;
  breachesRule: boolean;
}

/**
 * A symptom the participant reported, and whether the drug's own label lists
 * it.
 *
 * Not an adverse event. Causality, grading and expectedness belong to the
 * investigator; this is what the participant said, carried intact so that
 * judgement can be made by someone qualified to make it.
 */
export interface SymptomReport {
  canonicalName: string | null;
  isStudyDrug: boolean;
  symptom: string;
  /** Only if the participant used the word. Never inferred. */
  severity: 'mild' | 'moderate' | 'severe' | null;
  since: string | null;
  sincePrecision: DatePrecision;
  /** null = not checked. false = not on the label, which is the notable case. */
  onLabel: boolean | null;
  labelSource: string | null;
  reportedText: string | null;
}

export type CaregiverAuthStatus = 'none' | 'authorised' | 'not_authorised' | 'unverified';

/**
 * Whose account this is. Never a name — the caregiver is no more nameable in
 * the clinical store than the participant.
 */
export interface CallParticipants {
  caregiverPresent: boolean;
  caregiverRelationship: string | null;
  caregiverAuthStatus: CaregiverAuthStatus;
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
  /** Optional so a session recorded before these existed still typechecks. */
  adherence?: AdherenceReport[];
  behaviours?: BehaviourReport[];
  symptoms?: SymptomReport[];
  callParticipants?: CallParticipants;
}
