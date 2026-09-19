import type { ConmedEntry, ProposedChange, ReconciliationSession, ReviewStatus } from '../types/contract';
import type {
  AuditEvent,
  DataQuery,
  ElectronicSignature,
  ProtocolDeviation,
  NewStudyInput,
  ProtocolDocument,
  ScheduledVisit,
  Study,
  StudySummary,
  SupportingDocument,
  SupportingDocumentKind,
} from '../types/ui';
import { SESSIONS, VISITS } from '../mocks/sessions';
import { STUDIES } from '../mocks/studies';
import { PARSE_STUB, SEED_PROTOCOLS } from '../mocks/protocols';
import { TRANSCRIPTS } from '../mocks/transcripts';
import { SEED_AUDIT } from '../mocks/audit';
import { displayName } from '../lib/entry';
import { currentCoordinator } from '../auth';
import type { DeviationInput, Transport, Unsubscribe } from './transport';

/**
 * In-memory backend. Holds mutable copies of the fixtures so review decisions
 * survive navigation within a browser session, and replays call transcripts on
 * a timer so the live view and demo mode have something real to render.
 */

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Small, fixed. Enough to exercise loading states without making the demo wait. */
const LATENCY_MS = 90;
const settle = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));

/** Who the audit trail attributes a review decision to. */
const actor = () => currentCoordinator()?.username ?? 'unknown';

const sessions = new Map<string, ReconciliationSession>(
  clone(SESSIONS).map((s) => [s.sessionId, s]),
);
const visits: ScheduledVisit[] = clone(VISITS);
const audit = new Map<string, AuditEvent[]>(Object.entries(clone(SEED_AUDIT)));
const queries = new Map<string, DataQuery[]>();
const deviations = new Map<string, ProtocolDeviation[]>();
const protocols = new Map<string, ProtocolDocument>(Object.entries(clone(SEED_PROTOCOLS)));
const supporting = new Map<string, SupportingDocument[]>();
/** Mutable: a coordinator can open a new trial at the site. */
const studies: Study[] = clone(STUDIES);

let eventSeq = 9000;
function record(sessionId: string, event: Omit<AuditEvent, 'eventId' | 'at' | 'reason'> & { reason?: string | null }): void {
  const log = audit.get(sessionId) ?? [];
  log.push({
    eventId: `EV-${++eventSeq}`,
    at: new Date().toISOString(),
    reason: null,
    ...event,
  });
  audit.set(sessionId, log);
}

let querySeq = 500;
let deviationSeq = 700;

function find(sessionId: string, changeId: string): { session: ReconciliationSession; change: ProposedChange } {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session ${sessionId}`);
  const change = session.changes.find((c) => c.changeId === changeId);
  if (!change) throw new Error(`Unknown change ${changeId}`);
  return { session, change };
}

function describe(change: ProposedChange): string {
  const name = displayName(change.proposed);
  switch (change.changeType) {
    case 'add':
      return `${name} · added${change.proposed.dose ? ` · ${change.proposed.dose}` : ''}`;
    case 'stop':
      return `${name} · stopped`;
    case 'modify':
      return `${name} · ${change.current?.dose ?? '—'} → ${change.proposed.dose ?? '—'}`;
    default:
      return `${name} · confirmed unchanged`;
  }
}

function syncVisit(session: ReconciliationSession): void {
  const visit = visits.find((v) => v.sessionId === session.sessionId);
  if (!visit) return;
  visit.reconStatus = session.status;
  visit.changeCount = session.changes.length;
  visit.prohibitedCount = session.changes.filter((c) => c.prohibitedHit !== null).length;
  visit.unresolvedCount = session.changes.filter((c) => c.proposed.rxcui === null).length;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export const mockTransport: Transport = {
  listStudies() {
    const summaries: StudySummary[] = studies.map((study) => {
      const mine = visits.filter((v) => v.studyId === study.studyId);
      const protocol = protocols.get(study.studyId) ?? null;
      return {
        ...study,
        hasProtocol: protocol !== null && protocol.status === 'active',
        protocolRuleCount: protocol?.rules.length ?? 0,
        visitsToday: mine.filter((v) => isToday(v.visitAt)).length,
        awaitingReview: mine.filter((v) => v.reconStatus === 'awaiting_review').length,
        prohibitedFindings: mine.reduce((n, v) => n + v.prohibitedCount, 0),
        unresolvedItems: mine.reduce((n, v) => n + v.unresolvedCount, 0),
        callsInProgress: mine.filter((v) => v.reconStatus === 'in_progress').length,
      };
    });
    return settle(summaries);
  },

  listVisits(studyId) {
    return settle(clone(visits.filter((v) => v.studyId === studyId)));
  },

  listSupportingDocuments(studyId) {
    return settle(clone(supporting.get(studyId) ?? []));
  },

  uploadSupportingDocument(studyId, kind: SupportingDocumentKind, file: File) {
    const document: SupportingDocument = {
      documentId: `DOC-${kind.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      studyId,
      kind,
      filename: file.name,
      sizeBytes: file.size,
      // The real row count comes from parsing the file on the backend.
      recordCount: null,
      uploadedBy: actor(),
      uploadedAt: new Date().toISOString(),
      sourceUrl: null,
    };
    const list = (supporting.get(studyId) ?? []).filter((d) => d.kind !== kind);
    list.push(document);
    supporting.set(studyId, list);
    return new Promise((resolve) => setTimeout(() => resolve(clone(document)), 900));
  },

  createStudy(input: NewStudyInput) {
    if (studies.some((s) => s.studyId === input.studyId)) {
      return Promise.reject(new Error(`${input.studyId} is already open at this site.`));
    }
    const study: Study = {
      ...input,
      enrolledAtSite: 0,
      // Populated once the protocol is loaded and its rules are read.
      prohibitedHighlights: [],
    };
    studies.push(study);
    return settle(clone(study));
  },

  getProtocol(studyId) {
    return settle(clone(protocols.get(studyId) ?? null));
  },

  uploadProtocol(studyId, file: File) {
    // The real parse — finding the concomitant medications section and reading
    // the prohibited list out of it — happens on the agent branch. This stands
    // in so the flow is demonstrable, and does not pretend to have read the file.
    const existing = protocols.get(studyId);
    if (existing) existing.status = 'superseded';

    const document: ProtocolDocument = {
      documentId: `DOC-${studyId}-${Date.now().toString(36).toUpperCase()}`,
      studyId,
      filename: file.name,
      protocolNumber: studyId,
      amendment: existing ? 'Amendment (new)' : 'Amendment 1',
      effectiveDate: new Date().toISOString().slice(0, 10),
      sizeBytes: file.size,
      pageCount: null,
      uploadedBy: actor(),
      uploadedAt: new Date().toISOString(),
      status: 'active',
      conmedSection: '6.5',
      rules: clone(PARSE_STUB),
      sourceUrl: null,
    };
    protocols.set(studyId, document);
    return new Promise((resolve) => setTimeout(() => resolve(clone(document)), 1400));
  },

  getSession(sessionId) {
    const session = sessions.get(sessionId);
    return settle(session ? clone(session) : null);
  },

  setReviewStatus(sessionId, changeId, status: ReviewStatus) {
    const { change } = find(sessionId, changeId);
    change.reviewStatus = status;
    // 'edited' is recorded by editProposed, which knows what actually changed.
    if (status !== 'edited') {
      const action =
        status === 'accepted'
          ? 'change_accepted'
          : status === 'rejected'
            ? 'change_rejected'
            : 'change_cleared';
      record(sessionId, {
        actor: actor(),
        action,
        changeId,
        detail:
          action === 'change_cleared'
            ? `${describe(change)} · returned to pending`
            : describe(change),
      });
    }
    return settle(clone(change));
  },

  editProposed(sessionId, changeId, patch: Partial<ConmedEntry>, reason: string) {
    const { change } = find(sessionId, changeId);
    const before = { ...change.proposed };
    change.proposed = { ...change.proposed, ...patch };
    // An edit is an implicit acceptance — the coordinator corrected it to keep it.
    change.reviewStatus = 'edited';
    const fields = (Object.keys(patch) as (keyof ConmedEntry)[])
      .filter((k) => before[k] !== change.proposed[k])
      .map((k) => `${k} ${before[k] ?? '—'} → ${change.proposed[k] ?? '—'}`)
      .join(', ');
    record(sessionId, {
      actor: actor(),
      action: 'change_edited',
      changeId,
      detail: fields || 'no effective change',
      reason,
    });
    return settle(clone(change));
  },

  promote(sessionId, changeIds, signature: ElectronicSignature) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    const at = new Date().toISOString();
    session.status = 'completed';
    syncVisit(session);
    record(sessionId, {
      actor: signature.username,
      action: 'promoted',
      changeId: null,
      detail:
        `${changeIds.length} change${changeIds.length === 1 ? '' : 's'} promoted to the medication log · ` +
        `signed by ${signature.displayName} at ${signature.signedAt}`,
      reason: signature.meaning,
    });
    return settle({ promoted: changeIds.length, at });
  },

  raiseQuery(sessionId, changeId, text) {
    const { change } = find(sessionId, changeId);
    const query: DataQuery = {
      queryId: `Q-${++querySeq}`,
      changeId,
      text,
      raisedBy: actor(),
      raisedAt: new Date().toISOString(),
      status: 'open',
    };
    const list = queries.get(sessionId) ?? [];
    list.push(query);
    queries.set(sessionId, list);
    record(sessionId, {
      actor: actor(),
      action: 'query_raised',
      changeId,
      detail: `${describe(change)} · "${text}"`,
    });
    return settle(clone(query));
  },

  listQueries(sessionId) {
    return settle(clone(queries.get(sessionId) ?? []));
  },

  logDeviation(sessionId, changeId, input: DeviationInput) {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    const deviation: ProtocolDeviation = {
      deviationId: `PD-${++deviationSeq}`,
      sessionId,
      changeId,
      subjectId: session.subjectId,
      loggedBy: actor(),
      loggedAt: new Date().toISOString(),
      ...input,
    };
    const list = deviations.get(sessionId) ?? [];
    list.push(deviation);
    deviations.set(sessionId, list);
    record(sessionId, {
      actor: actor(),
      action: 'deviation_logged',
      changeId,
      detail:
        `${deviation.deviationId} · ${input.category} · §${input.protocolSection}` +
        `${input.reportableToIrb ? ' · reportable to IRB' : ''}${input.notifyPi ? ' · PI notified' : ''}`,
    });
    return settle(clone(deviation));
  },

  listDeviations(sessionId) {
    return settle(clone(deviations.get(sessionId) ?? []));
  },

  getAudit(sessionId) {
    return settle(clone(audit.get(sessionId) ?? []));
  },

  getTranscript(sessionId) {
    return settle(clone(TRANSCRIPTS[sessionId] ?? []));
  },

  subscribeCall(sessionId, onEvent, speed = 1): Unsubscribe {
    const session = sessions.get(sessionId);
    const turns = TRANSCRIPTS[sessionId] ?? [];
    if (!session || turns.length === 0) {
      const t = window.setTimeout(() => onEvent({ type: 'unavailable' }), LATENCY_MS);
      return () => window.clearTimeout(t);
    }

    const byId = new Map(session.changes.map((c) => [c.changeId, c]));
    const timers: number[] = [];

    onEvent({ type: 'status', status: 'in_progress' });

    for (const turn of turns) {
      timers.push(
        window.setTimeout(() => {
          onEvent({ type: 'turn', turn });
          for (const id of turn.yields ?? []) {
            const change = byId.get(id);
            if (change) onEvent({ type: 'change', change: clone(change) });
          }
        }, turn.atMs / speed),
      );
    }

    const endAt = (turns[turns.length - 1].atMs + 3500) / speed;
    timers.push(
      window.setTimeout(() => {
        onEvent({ type: 'status', status: 'awaiting_review' });
        onEvent({ type: 'ended', endedAt: new Date().toISOString() });
      }, endAt),
    );

    return () => timers.forEach(window.clearTimeout);
  },
};
