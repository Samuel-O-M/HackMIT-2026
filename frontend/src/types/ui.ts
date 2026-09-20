/**
 * UI-only shapes. Nothing here crosses the API boundary, so this file is safe
 * to change without coordinating with the backend.
 */

/**
 * One prohibited-medication rule, read out of the protocol. This is what the
 * voice agent's `check_prohibited` tool matches a resolved drug against, so
 * the coordinator needs to be able to see exactly what is being enforced.
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
   * When the rule bites.
   *
   * A conmed section and an exclusion criterion read almost identically on the
   * page — both are lists of drugs with the word "not" near them — and they
   * mean opposite things for someone already enrolled. "No systemic
   * corticosteroids within 28 days prior to first dose" is a screening gate
   * that stopped applying the day they were dosed; flagging it mid-treatment
   * invents a protocol deviation out of a rule the participant has already
   * satisfied.
   *
   * 'during_treatment' is the default for a conmed section, because that is
   * what a conmed section is for.
   */
  appliesWhen: 'before_first_dose' | 'during_treatment' | 'both';
  /**
   * The washout window, when the rule has one, kept apart from `threshold`.
   * A dose ceiling and a look-back period are different qualifiers and were
   * sharing one string.
   */
  washoutWindow?: string | null;
  /**
   * RxClass ids (ATC / FDA EPC) this rule covers, looked up in medical_data rather
   * than written by the model. A drug in any of them trips the rule.
   */
  classIds?: string[];
  /** RxNorm concepts, for rules that name a specific drug. */
  rxcuis?: string[];
}

/**
 * The Clinical Study Protocol. This is the document that defines which
 * medications are prohibited — the list lives in its concomitant medications
 * section. Until one is loaded for a study, the agent has nothing to check
 * against and prohibited screening is off for that trial.
 */
export interface ProtocolDocument {
  documentId: string;
  studyId: string;
  filename: string;
  /** Protocol number from the title page, e.g. "R2810-ONC-1540". */
  protocolNumber: string;
  amendment: string;
  effectiveDate: string;
  sizeBytes: number;
  pageCount: number | null;
  uploadedBy: string;
  uploadedAt: string;
  status: 'parsing' | 'active' | 'superseded' | 'failed';
  /** Section the prohibited list was read from, e.g. "5.7.2". */
  conmedSection: string | null;
  rules: ProhibitedRule[];
  /** Where the file can be opened from. */
  sourceUrl: string | null;
}

/**
 * The other two documents a site needs before it can reconcile anything.
 *
 * The baseline medication log matters as much as the protocol: it is the
 * "in the medication log" side of the diff. Without it there is nothing to
 * reconcile against, only a list of what the participant said.
 */
export type SupportingDocumentKind = 'medication_log' | 'visit_schedule';

export interface SupportingDocument {
  documentId: string;
  studyId: string;
  kind: SupportingDocumentKind;
  filename: string;
  sizeBytes: number;
  /** Rows read out of the file — participants, or log entries. */
  recordCount: number | null;
  uploadedBy: string;
  uploadedAt: string;
  sourceUrl: string | null;
}

/**
 * One field the agent read out of the protocol. Same contract as a proposed
 * medication change: a value, how sure the agent is, and where it came from —
 * so the coordinator can check it rather than take it on trust.
 */
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
  phase: ExtractedField<Study['phase']>;
  principalInvestigator: ExtractedField<string>;
  conmedSection: ExtractedField<string>;
  rules: ProhibitedRule[];
  /**
   * 'agent' when a real extractor produced this, 'stub' when it came from the
   * placeholder. The UI says which, so a stub is never mistaken for a read.
   */
  source: 'agent' | 'stub';
  notes: string | null;
}

/**
 * Why a participant left the study. These are the CDISC SDTM DS domain's
 * standardised terms (DSDECOD), not free text — the sponsor's statistician
 * counts them, so the wording is fixed. Note it is "withdrawal by subject",
 * not "withdrawal of consent": those are different events.
 */
export type DispositionReason =
  | 'COMPLETED'
  | 'ADVERSE EVENT'
  | 'WITHDRAWAL BY SUBJECT'
  | 'LOST TO FOLLOW-UP'
  | 'PHYSICIAN DECISION'
  | 'PROTOCOL DEVIATION'
  | 'DEATH'
  | 'SCREEN FAILURE'
  | 'OTHER';

export interface Disposition {
  reason: DispositionReason;
  /** The verbatim term (DSTERM) when the standard one needs qualifying. */
  detail: string | null;
  date: string;
  recordedBy: string;
  recordedAt: string;
  /** Whether data already collected may be kept. Withdrawing consent to
   *  future collection does not retract what was lawfully collected before. */
  retainCollectedData: boolean;
}

/**
 * A participant at this site.
 *
 * The order matters and is not ours to change: consent is signed before any
 * study procedure, a screening number is assigned, eligibility is checked, and
 * only then does randomization assign the subject id. A screen failure never
 * gets one.
 */
export interface Participant {
  subjectId: string;
  studyId: string;
  status: 'screening' | 'enrolled' | 'discontinued' | 'screen_failed' | 'completed';
  screeningNumber: string | null;
  consentVersion: string | null;
  consentDate: string | null;
  enrolledDate: string | null;
  /** The signed ICF on file. Its presence is what makes enrollment defensible. */
  icfFilename: string | null;
  discontinuation: Disposition | null;
}

/** What a coordinator fills in to enroll someone. */
export interface EnrollInput {
  subjectId: string;
  screeningNumber: string;
  consentVersion: string;
  consentDate: string;
  icfFilename: string | null;
}

/** What a coordinator fills in to open a trial at this site. */
export interface NewStudyInput {
  studyId: string;
  nctId: string;
  shortTitle: string;
  investigationalProduct: string;
  indication: string;
  phase: Study['phase'];
  principalInvestigator: string;
}

/**
 * A trial this site is running. A coordinator is usually on several at once and
 * works one at a time, so the study is chosen before anything else is shown —
 * a prohibited-medication rule only means anything relative to one protocol.
 */
export interface Study {
  studyId: string;
  nctId: string;
  /** Short name a coordinator would actually say out loud. */
  shortTitle: string;
  investigationalProduct: string;
  indication: string;
  phase: 'Phase 1' | 'Phase 2' | 'Phase 3';
  /** Enrolled at this site, not across the trial. */
  enrolledAtSite: number;
  principalInvestigator: string;
  /** Headline prohibited classes, for the picker. Full rules live in the protocol. */
  prohibitedHighlights: string[];
}

/** Study plus the counts that decide which one a coordinator opens first. */
export interface StudySummary extends Study {
  /** False when no protocol is loaded — prohibited screening is off for this trial. */
  hasProtocol: boolean;
  protocolRuleCount: number;
  visitsToday: number;
  awaitingReview: number;
  prohibitedFindings: number;
  unresolvedItems: number;
  callsInProgress: number;
}

export interface ScheduledVisit {
  sessionId: string | null;
  subjectId: string;
  studyId: string;
  nctId: string;
  visitName: string;
  visitAt: string;
  /** 'not_started' covers subjects whose call has not been placed yet. */
  reconStatus: 'not_started' | 'in_progress' | 'awaiting_review' | 'completed' | 'no_contact';
  changeCount: number;
  prohibitedCount: number;
  unresolvedCount: number;
}

export interface TranscriptTurn {
  /** Milliseconds from call start. Drives replay pacing. */
  atMs: number;
  speaker: 'agent' | 'participant';
  text: string;
  /** Change ids this turn produced, revealed as the replay passes this point. */
  yields?: string[];
}

export interface AuditEvent {
  eventId: string;
  at: string;
  actor: string;
  action:
    | 'call_started'
    | 'call_ended'
    | 'change_accepted'
    | 'change_rejected'
    | 'change_cleared'
    | 'change_edited'
    | 'query_raised'
    | 'deviation_logged'
    | 'promoted';
  changeId: string | null;
  detail: string;
  /**
   * 21 CFR 11.10(e) wants who, when, and why. Any event that alters a value
   * carries the coordinator's stated reason; events that only record a
   * decision leave it null.
   */
  reason: string | null;
}

/**
 * A question the coordinator could not answer from the call alone. Raising one
 * does not disposition the change — the row stays pending, which is the point:
 * a queried value is blocked, not accepted and not thrown away.
 */
export interface DataQuery {
  queryId: string;
  changeId: string;
  text: string;
  raisedBy: string;
  raisedAt: string;
  status: 'open' | 'closed';
}

/**
 * A prohibited medication is a protocol deviation, reportable to the IRB, and
 * the coordinator files it with the principal investigator. Flagging it on
 * screen is not the end of the workflow — this record is.
 */
export interface ProtocolDeviation {
  deviationId: string;
  sessionId: string;
  changeId: string;
  subjectId: string;
  category: string;
  protocolSection: string;
  ruleId: string;
  description: string;
  reportableToIrb: boolean;
  notifyPi: boolean;
  loggedBy: string;
  loggedAt: string;
}

/**
 * 21 CFR 11.50: a signature manifestation carries the signer's printed name,
 * the date and time, and the meaning of the signature.
 */
export interface ElectronicSignature {
  username: string;
  displayName: string;
  meaning: string;
  signedAt: string;
}
