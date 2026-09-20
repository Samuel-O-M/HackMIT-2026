import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProposedChange, ReconciliationSession } from '../types/contract';
import type { DataQuery, ElectronicSignature, ProtocolDeviation } from '../types/ui';
import type { Coordinator } from '../auth';
import { SIGNATURE_MEANING, type DeviationInput } from '../api/transport';
import type { EditableField } from '../lib/entry';
import { acceptedChanges, pendingCount } from '../lib/entry';
import { clock, formatDateTime } from '../lib/dates';
import { navigate } from '../router';
import { ChangeRow } from '../components/ChangeRow';
import { ProhibitedAlert } from '../components/ProhibitedAlert';
import { SafetyAlert } from '../components/SafetyAlert';
import {
  DeviationDialog,
  QueryDialog,
  ReasonForChangeDialog,
  SignOffDialog,
  type PendingEdit,
} from '../components/ReviewDialogs';

interface Props {
  session: ReconciliationSession | null;
  coordinator: Coordinator;
  onSessionChange: (session: ReconciliationSession) => void;
  onToast: (text: string, tone?: 'ok' | 'warn') => void;
}

type Modal =
  | { kind: 'reason'; edit: PendingEdit }
  | { kind: 'query'; change: ProposedChange }
  | { kind: 'deviation'; change: ProposedChange }
  | { kind: 'signoff' }
  | null;

export function Reconciliation({ session, coordinator, onSessionChange, onToast }: Props) {
  const [flashId, setFlashId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [queries, setQueries] = useState<DataQuery[]>([]);
  const [deviations, setDeviations] = useState<ProtocolDeviation[]>([]);

  const sessionId = session?.sessionId ?? null;

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    Promise.all([api.listQueries(sessionId), api.listDeviations(sessionId)]).then(([q, d]) => {
      if (!live) return;
      setQueries(q);
      setDeviations(d);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!flashId) return;
    const t = window.setTimeout(() => setFlashId(null), 1200);
    return () => window.clearTimeout(t);
  }, [flashId]);

  const replace = useCallback(
    (updated: ProposedChange) => {
      if (!session) return;
      onSessionChange({
        ...session,
        changes: session.changes.map((c) => (c.changeId === updated.changeId ? updated : c)),
      });
    },
    [session, onSessionChange],
  );

  if (!session) {
    return (
      <div className="view view-wide">
        <p className="skeleton">Loading reconciliation…</p>
      </div>
    );
  }

  const locked = session.status === 'completed';
  const accepted = acceptedChanges(session.changes);
  const rejected = session.changes.filter((c) => c.reviewStatus === 'rejected').length;
  const pending = pendingCount(session.changes);
  const openQueries = queries.filter((q) => q.status === 'open');
  const undecidedProhibited = session.changes.filter(
    (c) => c.prohibitedHit !== null && c.reviewStatus === 'pending',
  ).length;

  function jump(changeId: string) {
    document.getElementById(`change-${changeId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(changeId);
  }

  async function setStatus(change: ProposedChange, next: 'accepted' | 'rejected') {
    // Clicking the active state clears it, so a misclick is one click to undo.
    const target = change.reviewStatus === next ? 'pending' : next;
    replace(await api.setReviewStatus(session!.sessionId, change.changeId, target));
  }

  async function commitEdit(edit: PendingEdit, reason: string) {
    setModal(null);
    replace(
      await api.editProposed(session!.sessionId, edit.change.changeId, { [edit.field]: edit.value }, reason),
    );
    onToast(`Change saved · reason recorded in the audit trail`);
  }

  async function commitQuery(change: ProposedChange, text: string) {
    setModal(null);
    const query = await api.raiseQuery(session!.sessionId, change.changeId, text);
    setQueries((list) => [...list, query]);
    onToast(`Query ${query.queryId} raised · this row stays pending until it is answered`, 'warn');
  }

  async function commitDeviation(change: ProposedChange, input: DeviationInput) {
    setModal(null);
    const deviation = await api.logDeviation(session!.sessionId, change.changeId, input);
    setDeviations((list) => [...list, deviation]);
    onToast(
      `Deviation ${deviation.deviationId} logged${input.notifyPi ? ' · PI and medical monitor notified' : ''}`,
      'warn',
    );
  }

  async function commitPromote() {
    setModal(null);
    setPromoting(true);
    const signature: ElectronicSignature = {
      username: coordinator.username,
      displayName: coordinator.displayName,
      meaning: SIGNATURE_MEANING,
      signedAt: new Date().toISOString(),
    };
    try {
      const result = await api.promote(
        session!.sessionId,
        accepted.map((c) => c.changeId),
        signature,
      );
      onSessionChange({ ...session!, status: 'completed' });
      onToast(
        `Promoted to log · ${result.promoted} change${result.promoted === 1 ? '' : 's'} for ${session!.subjectId}, signed by ${coordinator.displayName}`,
      );
    } finally {
      setPromoting(false);
    }
  }

  return (
    <>
      <div className="view view-wide">
        <header className="phead">
          <div>
            <h1>{session.subjectId}</h1>
            <p className="phead-sub">
              Call {session.startedAt ? clock(session.startedAt) : '—'}
              {session.endedAt ? `–${clock(session.endedAt)}` : ' · in progress'} ·{' '}
              {session.changes.length} proposed change{session.changes.length === 1 ? '' : 's'}
              {openQueries.length > 0 && ` · ${openQueries.length} open quer${openQueries.length === 1 ? 'y' : 'ies'}`}
            </p>
          </div>
          <div className="phead-right">
            <dl className="facts">
              <div className="fact">
                <dt>Study</dt>
                <dd>{session.studyId}</dd>
              </div>
              <div className="fact">
                <dt>Protocol</dt>
                <dd className="mono">{session.nctId}</dd>
              </div>
              <div className="fact">
                <dt>Session</dt>
                <dd className="mono">{session.sessionId}</dd>
              </div>
            </dl>
          </div>
        </header>

        <SafetyAlert changes={session.changes} flags={session.safetyFlags} onJump={jump} />

        <ProhibitedAlert
          changes={session.changes}
          deviations={deviations}
          locked={locked}
          onJump={jump}
          onLogDeviation={(change) => setModal({ kind: 'deviation', change })}
        />

        {session.changes.length === 0 ? (
          <div className="empty">
            <h2>Nothing changed since the last visit</h2>
            <p>
              {session.endedAt ? formatDateTime(session.endedAt) : 'Call ended'} · nothing to promote.
            </p>
            <button
              className="btn"
              onClick={() => navigate({ name: 'visits', studyId: session.studyId })}
            >
              Back to {session.studyId} visits
            </button>
          </div>
        ) : (
          <div className="diff">
            <div className="diff-cols" aria-hidden="true">
              <span>Type</span>
              <span>In the medication log</span>
              <span>
                From the call{session.endedAt ? `, ${clock(session.endedAt)}` : ''}
              </span>
              <span>Confidence</span>
              <span>Review</span>
            </div>
            <div className="rows">
              {session.changes.map((change) => (
                <ChangeRow
                  key={change.changeId}
                  sessionId={session.sessionId}
                  change={change}
                  queries={queries.filter((q) => q.changeId === change.changeId)}
                  flash={flashId === change.changeId}
                  locked={locked}
                  onAccept={() => setStatus(change, 'accepted')}
                  onReject={() => setStatus(change, 'rejected')}
                  onQuery={() => setModal({ kind: 'query', change })}
                  onEdit={(field: EditableField, value) =>
                    setModal({ kind: 'reason', edit: { change, field, value } })
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {session.changes.length > 0 && (
        <div className="promote">
          <div className="promote-tally">
            <span data-zero={accepted.length === 0}>
              <b>{accepted.length}</b> confirmed
            </span>
            <span data-zero={rejected === 0}>
              <b>{rejected}</b> rejected
            </span>
            <span data-zero={openQueries.length === 0}>
              <b>{openQueries.length}</b> queried
            </span>
            <span data-zero={pending === 0}>
              <b>{pending}</b> still to review
            </span>
          </div>
          <div className="promote-right">
            {locked ? (
              <>
                <span className="promote-note">Promoted to the log. This session is closed.</span>
                <button
                  className="btn"
                  onClick={() => navigate({ name: 'audit', sessionId: session.sessionId })}
                >
                  View history
                </button>
              </>
            ) : (
              <>
                {undecidedProhibited > 0 && (
                  <span className="promote-note" data-blocking="true">
                    {undecidedProhibited} prohibited finding{undecidedProhibited === 1 ? '' : 's'} still
                    undecided
                  </span>
                )}
                {undecidedProhibited === 0 && accepted.length === 0 && (
                  <span className="promote-note">Confirm at least one change to promote</span>
                )}
                <button
                  className="btn btn-primary"
                  disabled={accepted.length === 0 || promoting}
                  onClick={() => setModal({ kind: 'signoff' })}
                >
                  {promoting
                    ? 'Promoting…'
                    : accepted.length === 0
                      ? 'Sign and promote'
                      : `Sign and promote ${accepted.length}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {modal?.kind === 'reason' && (
        <ReasonForChangeDialog
          edit={modal.edit}
          onConfirm={(reason) => commitEdit(modal.edit, reason)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'query' && (
        <QueryDialog
          change={modal.change}
          onConfirm={(text) => commitQuery(modal.change, text)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'deviation' && (
        <DeviationDialog
          change={modal.change}
          onConfirm={(input) => commitDeviation(modal.change, input)}
          onCancel={() => setModal(null)}
        />
      )}
      {modal?.kind === 'signoff' && (
        <SignOffDialog
          coordinator={coordinator}
          count={accepted.length}
          onConfirm={commitPromote}
          onCancel={() => setModal(null)}
        />
      )}
    </>
  );
}
