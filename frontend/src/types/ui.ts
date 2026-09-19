/**
 * UI-only shapes. Nothing here crosses the API boundary, so this file is safe
 * to change without coordinating with the backend.
 */

export interface ScheduledVisit {
  sessionId: string | null;
  subjectId: string;
  studyId: string;
  nctId: string;
  visitName: string;
  visitAt: string;
  /** 'not_started' covers subjects whose call has not been placed yet. */
  reconStatus: 'not_started' | 'in_progress' | 'awaiting_review' | 'completed';
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
