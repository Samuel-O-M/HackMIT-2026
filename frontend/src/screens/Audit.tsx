import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ReconciliationSession } from '../types/contract';
import type { AuditEvent } from '../types/ui';
import { formatDateTime } from '../lib/dates';
import { navigate } from '../router';

const ACTION_LABEL: Record<AuditEvent['action'], string> = {
  call_started: 'Call started',
  call_ended: 'Call ended',
  change_accepted: 'Confirmed',
  change_rejected: 'Rejected',
  change_cleared: 'Decision cleared',
  change_edited: 'Edited',
  query_raised: 'Query raised',
  deviation_logged: 'Deviation logged',
  promoted: 'Promoted',
};

interface Props {
  sessionId: string;
  session: ReconciliationSession | null;
  reloadKey: number;
}

export function Audit({ sessionId, session, reloadKey }: Props) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);

  useEffect(() => {
    let live = true;
    api.getAudit(sessionId).then((rows) => {
      if (live) setEvents(rows);
    });
    return () => {
      live = false;
    };
  }, [sessionId, reloadKey]);

  return (
    <div className="view view-wide">
      <header className="phead">
        <div>
          <h1>History</h1>
          <p className="phead-sub">
            {session?.subjectId ?? sessionId} · append-only · every entry is retained for the study record
          </p>
        </div>
        <div className="phead-right">
          <button className="btn" onClick={() => navigate({ name: 'review', sessionId })}>
            Back to review
          </button>
        </div>
      </header>

      <hr className="rule" />

      {events === null ? (
        <p className="skeleton">Loading history…</p>
      ) : events.length === 0 ? (
        <div className="empty">
          <h2>No history yet</h2>
          <p>Events are written here as the call runs and as you review its output.</p>
        </div>
      ) : (
        <div className="audit">
          {events.map((event) => (
            <div className="arow" key={event.eventId}>
              <span className="arow-at">{formatDateTime(event.at)}</span>
              <span className="arow-actor">{event.actor}</span>
              <span className="arow-act" data-a={event.action}>
                {ACTION_LABEL[event.action]}
              </span>
              <span className="arow-detail">
                {event.changeId && <span className="mono dim">{event.changeId} · </span>}
                {event.detail}
              </span>
              {event.reason && <span className="arow-reason">Reason: {event.reason}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
