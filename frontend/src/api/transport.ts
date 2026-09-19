import type {
  ConmedEntry,
  ProposedChange,
  ReconciliationSession,
  ReviewStatus,
  SessionStatus,
} from '../types/contract';
import type {
  AuditEvent,
  DataQuery,
  ElectronicSignature,
  ProtocolDeviation,
  ScheduledVisit,
  TranscriptTurn,
} from '../types/ui';

/**
 * Everything the UI needs from the outside world, in one interface.
 *
 * Components never call fetch. They call `api` (src/api/index.ts), which
 * delegates to whichever Transport is installed. Swapping the mock for the
 * real backend is one line in src/api/index.ts and one new implementation
 * of this interface — no component changes.
 */

/** Events a live call emits. Shaped to map onto a websocket frame 1:1. */
export type CallEvent =
  | { type: 'turn'; turn: TranscriptTurn }
  | { type: 'change'; change: ProposedChange }
  | { type: 'status'; status: SessionStatus }
  | { type: 'ended'; endedAt: string }
  /** No stream for this session — the call never happened or is long finished. */
  | { type: 'unavailable' };

export type Unsubscribe = () => void;

/** What the coordinator is asserting when they sign off on a promotion. */
export const SIGNATURE_MEANING =
  'I have reviewed these changes against the source and approve their entry into the medication log.';

export interface DeviationInput {
  category: string;
  protocolSection: string;
  ruleId: string;
  description: string;
  reportableToIrb: boolean;
  notifyPi: boolean;
}

export interface Transport {
  listVisits(): Promise<ScheduledVisit[]>;
  getSession(sessionId: string): Promise<ReconciliationSession | null>;

  setReviewStatus(sessionId: string, changeId: string, status: ReviewStatus): Promise<ProposedChange>;

  /**
   * `reason` is not optional. Part 11 audit trails record who, when, and why;
   * a value change with no stated reason is not a record a sponsor can defend.
   */
  editProposed(
    sessionId: string,
    changeId: string,
    patch: Partial<ConmedEntry>,
    reason: string,
  ): Promise<ProposedChange>;

  raiseQuery(sessionId: string, changeId: string, text: string): Promise<DataQuery>;
  listQueries(sessionId: string): Promise<DataQuery[]>;

  logDeviation(sessionId: string, changeId: string, input: DeviationInput): Promise<ProtocolDeviation>;
  listDeviations(sessionId: string): Promise<ProtocolDeviation[]>;

  /** Writes accepted changes into the medication log. The only committing call. */
  promote(
    sessionId: string,
    changeIds: string[],
    signature: ElectronicSignature,
  ): Promise<{ promoted: number; at: string }>;

  getAudit(sessionId: string): Promise<AuditEvent[]>;

  /**
   * Stream a call. For an in-flight call this is the live feed; for a finished
   * one the mock transport replays it, which is what demo mode rides on.
   */
  subscribeCall(sessionId: string, onEvent: (event: CallEvent) => void, speed?: number): Unsubscribe;
}
