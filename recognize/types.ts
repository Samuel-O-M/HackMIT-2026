/**
 * Cloned from frontend/src/types/ui.ts (ProhibitedRule, ExtractedField,
 * ProtocolExtraction). Kept identical so whatever works here can be dropped
 * into `registerProtocolExtractor` unchanged. `Study['phase']` is inlined as
 * `Phase` to avoid dragging the rest of the UI types along.
 */

export type Phase = 'Phase 1' | 'Phase 2' | 'Phase 3';

/**
 * One prohibited-medication rule, read out of the protocol. This is what the
 * voice agent's `check_prohibited` tool matches a resolved drug against.
 */
export interface ProhibitedRule {
  ruleId: string;
  matchedOn: 'drug' | 'class';
  /** How the rule reads to a human, e.g. "Systemic corticosteroids > 10 mg/day". */
  label: string;
  className: string | null;
  protocolSection: string;
  rationale: string;
  /** Dose or timing qualifier, when the ban is conditional rather than absolute. */
  threshold: string | null;
  /**
   * RxClass ids (ATC / FDA EPC) this rule covers, looked up in medical_data rather
   * than written by the model. A drug in any of them trips the rule.
   */
  classIds?: string[];
  /** RxNorm concepts, for rules that name a specific drug. */
  rxcuis?: string[];
}

/** One field the agent read out of the protocol. */
export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
  /** Where in the document it was found, e.g. "Title page" or "p. 14". */
  sourceHint: string | null;
}

/** Everything the agent can read off a Clinical Study Protocol. */
export interface ProtocolExtraction {
  studyId: ExtractedField<string>;
  nctId: ExtractedField<string>;
  shortTitle: ExtractedField<string>;
  investigationalProduct: ExtractedField<string>;
  indication: ExtractedField<string>;
  phase: ExtractedField<Phase>;
  principalInvestigator: ExtractedField<string>;
  conmedSection: ExtractedField<string>;
  rules: ProhibitedRule[];
  source: 'agent' | 'stub';
  notes: string | null;
}
