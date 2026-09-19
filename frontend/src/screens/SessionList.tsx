import { useEffect, useState } from 'react';
import { api, usingFixtures } from '../api';
import type { ScheduledVisit, StudySummary } from '../types/ui';
import { clock, dayKey, dayLabel } from '../lib/dates';
import { navigate } from '../router';
import { StatusPill } from '../components/StatusPill';

interface Props {
  studyId: string;
  study: StudySummary | null;
  onStartCall: (visit: ScheduledVisit) => void;
  reloadKey: number;
}

const ACTION: Record<ScheduledVisit['reconStatus'], string> = {
  not_started: 'Start call',
  in_progress: 'Open call',
  awaiting_review: 'Review',
  completed: 'View history',
};

export function SessionList({ studyId, study, onStartCall, reloadKey }: Props) {
  const [visits, setVisits] = useState<ScheduledVisit[] | null>(null);

  useEffect(() => {
    let live = true;
    api.listVisits(studyId).then((rows) => {
      if (live) setVisits(rows);
    });
    return () => {
      live = false;
    };
  }, [reloadKey, studyId]);

  if (!visits) return <div className="view view-wide"><p className="skeleton">Loading visits…</p></div>;

  const sorted = [...visits].sort((a, b) => a.visitAt.localeCompare(b.visitAt));
  const awaiting = sorted.filter((v) => v.reconStatus === 'awaiting_review').length;
  const flagged = sorted.reduce((n, v) => n + v.prohibitedCount, 0);

  const groups: { key: string; label: string; rows: ScheduledVisit[] }[] = [];
  for (const visit of sorted) {
    const key = dayKey(visit.visitAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(visit);
    else groups.push({ key, label: dayLabel(visit.visitAt), rows: [visit] });
  }

  function act(visit: ScheduledVisit) {
    if (visit.reconStatus === 'not_started') return onStartCall(visit);
    if (!visit.sessionId) return;
    if (visit.reconStatus === 'in_progress') return navigate({ name: 'live', sessionId: visit.sessionId });
    if (visit.reconStatus === 'completed') return navigate({ name: 'audit', sessionId: visit.sessionId });
    navigate({ name: 'review', sessionId: visit.sessionId });
  }

  return (
    <div className="view view-wide">
      <header className="phead">
        <div>
          <h1>{study ? study.shortTitle : studyId}</h1>
          <p className="phead-sub">
            {studyId} · <span className="mono">{study?.nctId ?? ''}</span>
            {study ? ` · ${study.phase} · ${study.principalInvestigator}` : ''}
          </p>
          <p className="phead-sub">
            {awaiting > 0
              ? `${awaiting} reconciliation${awaiting === 1 ? '' : 's'} awaiting review`
              : 'Nothing awaiting review'}
            {flagged > 0 && ` · ${flagged} prohibited finding${flagged === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="phead-right">
          <button className="btn" onClick={() => navigate({ name: 'studies' })}>
            Change trial
          </button>
          {usingFixtures && studyId === 'R1979-ONC-22102' && (
            <button
              className="btn"
              title="Replays the S-014 call from fixtures, end to end, with no backend"
              onClick={() => navigate({ name: 'live', sessionId: 'SES-2026-0431' })}
            >
              Replay demo call
            </button>
          )}
        </div>
      </header>

      <hr className="rule" />

      {study && !study.hasProtocol && (
        <section className="alarm" aria-labelledby="no-protocol-banner">
          <header className="alarm-head">
            <h2 id="no-protocol-banner">No protocol loaded for {studyId}</h2>
            <span className="dim">Prohibited screening is off for every call on this trial</span>
          </header>
          <div className="alarm-item">
            <p className="alarm-why">
              The agent will still resolve and record what participants report, but it cannot flag
              prohibited medications until the Clinical Study Protocol is loaded.
            </p>
            <div className="alarm-acts">
              <button
                className="alarm-jump"
                data-primary="true"
                onClick={() => navigate({ name: 'documents', studyId })}
              >
                Load the protocol
              </button>
            </div>
          </div>
        </section>
      )}

      {sorted.length === 0 ? (
        <div className="empty">
          <h2>No visits scheduled for {studyId}</h2>
          <p>Visits appear here once they are booked in the study calendar.</p>
          <button className="btn" onClick={() => navigate({ name: 'studies' })}>
            Back to all trials
          </button>
        </div>
      ) : (
        <div className="sessions">
          {/* Labels only — each row already reads on its own, so this is not
              announced twice to a screen reader. */}
          <div className="sessions-cols" aria-hidden="true">
            <span>Visit</span>
            <span>Participant</span>
            <span>From the call</span>
            <span>Status</span>
            <span />
          </div>
          {groups.map((group) => (
            <div key={group.key}>
              <div className="sessions-group">
                <span>{group.label}</span>
                <span className="dim">
                  {group.rows.length} visit{group.rows.length === 1 ? '' : 's'}
                </span>
              </div>
              {group.rows.map((visit) => (
                <div
                  className="srow"
                  key={`${visit.subjectId}-${visit.visitAt}`}
                  data-prohibited={visit.prohibitedCount > 0}
                >
                  <div className="srow-when">
                    <b>{clock(visit.visitAt)}</b>
                    <span>{visit.visitName}</span>
                  </div>
                  <div>
                    <div className="srow-subject">{visit.subjectId}</div>
                  </div>
                  <div className="srow-signals">
                    {visit.reconStatus === 'not_started' ? (
                      <span className="dim">No call yet</span>
                    ) : (
                      <>
                        <span>
                          <b>{visit.changeCount}</b> change{visit.changeCount === 1 ? '' : 's'}
                        </span>
                        {visit.unresolvedCount > 0 && (
                          <span>
                            <b>{visit.unresolvedCount}</b> unresolved
                          </span>
                        )}
                        {visit.prohibitedCount > 0 && (
                          <span className="flag">
                            {visit.prohibitedCount} prohibited
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <StatusPill status={visit.reconStatus} />
                  </div>
                  <div className="srow-act">
                    <button
                      className={visit.reconStatus === 'awaiting_review' ? 'btn btn-primary' : 'btn'}
                      onClick={() => act(visit)}
                    >
                      {ACTION[visit.reconStatus]}
                      {visit.reconStatus === 'awaiting_review' && visit.changeCount > 0
                        ? ` ${visit.changeCount}`
                        : ''}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
