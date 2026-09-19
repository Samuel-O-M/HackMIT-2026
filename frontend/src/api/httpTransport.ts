import type { ConmedEntry, ReviewStatus } from '../types/contract';
import type { ElectronicSignature } from '../types/ui';
import type { CallEvent, DeviationInput, Transport, Unsubscribe } from './transport';

/**
 * Real-backend transport. Unused until VITE_API_BASE is set — see src/api/index.ts.
 *
 * This doubles as the written ask to the backend branch. Endpoints:
 *
 *   GET    /visits                                  → ScheduledVisit[]
 *   GET    /sessions/:id                            → ReconciliationSession
 *   PATCH  /sessions/:id/changes/:changeId/status   { status } → ProposedChange
 *   PATCH  /sessions/:id/changes/:changeId          { patch, reason } → ProposedChange
 *   POST   /sessions/:id/changes/:changeId/queries  { text } → DataQuery
 *   GET    /sessions/:id/queries                    → DataQuery[]
 *   POST   /sessions/:id/changes/:changeId/deviations  DeviationInput → ProtocolDeviation
 *   GET    /sessions/:id/deviations                 → ProtocolDeviation[]
 *   POST   /sessions/:id/promote                    { changeIds, signature } → { promoted, at }
 *   GET    /sessions/:id/audit                      → AuditEvent[]
 *   GET    /sessions/:id/stream                     → SSE of CallEvent
 *
 * `reason` on an edit and `signature` on a promote are required, not optional:
 * 21 CFR Part 11 audit trails record who, when and why, and a promotion is a
 * signed act. The backend should reject either call without them.
 *
 * CallEvent frames are defined in ./transport.ts. If the backend prefers a
 * websocket, only `subscribeCall` changes.
 */

function makeHttpTransport(base: string): Transport {
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
    if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    listVisits: () => json('/visits'),
    getSession: (id) => json(`/sessions/${id}`),

    setReviewStatus: (sessionId, changeId, status: ReviewStatus) =>
      json(`/sessions/${sessionId}/changes/${changeId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),

    editProposed: (sessionId, changeId, patch: Partial<ConmedEntry>, reason: string) =>
      json(`/sessions/${sessionId}/changes/${changeId}`, {
        method: 'PATCH',
        body: JSON.stringify({ patch, reason }),
      }),

    raiseQuery: (sessionId, changeId, text: string) =>
      json(`/sessions/${sessionId}/changes/${changeId}/queries`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),

    listQueries: (sessionId) => json(`/sessions/${sessionId}/queries`),

    logDeviation: (sessionId, changeId, input: DeviationInput) =>
      json(`/sessions/${sessionId}/changes/${changeId}/deviations`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    listDeviations: (sessionId) => json(`/sessions/${sessionId}/deviations`),

    promote: (sessionId, changeIds, signature: ElectronicSignature) =>
      json(`/sessions/${sessionId}/promote`, {
        method: 'POST',
        body: JSON.stringify({ changeIds, signature }),
      }),

    getAudit: (sessionId) => json(`/sessions/${sessionId}/audit`),

    subscribeCall(sessionId, onEvent): Unsubscribe {
      const source = new EventSource(`${base}/sessions/${sessionId}/stream`);
      source.onmessage = (message) => {
        try {
          onEvent(JSON.parse(message.data) as CallEvent);
        } catch {
          // A malformed frame should not take the view down mid-call.
        }
      };
      return () => source.close();
    },
  };
}

export { makeHttpTransport };
