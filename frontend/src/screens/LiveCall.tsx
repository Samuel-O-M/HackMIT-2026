import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { ProposedChange, ReconciliationSession } from '../types/contract';
import type { TranscriptTurn } from '../types/ui';
import { clock, elapsed } from '../lib/dates';
import { CHANGE_TAG, displayName, isUnresolved } from '../lib/entry';
import { navigate } from '../router';

interface Props {
  sessionId: string;
  session: ReconciliationSession | null;
}

const SPEEDS = [1, 4, 12];

/**
 * Read-only. Its job is to make the call legible while it happens — the
 * coordinator cannot steer the agent from here, and pretending otherwise
 * would be a lie about what the system does.
 */
export function LiveCall({ sessionId, session }: Props) {
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [captured, setCaptured] = useState<ProposedChange[]>([]);
  const [ended, setEnded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [run, setRun] = useState(0);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns([]);
    setCaptured([]);
    setEnded(false);
    setUnavailable(false);

    const stop = api.subscribeCall(
      sessionId,
      (event) => {
        if (event.type === 'turn') setTurns((list) => [...list, event.turn]);
        if (event.type === 'change')
          setCaptured((list) =>
            list.some((c) => c.changeId === event.change.changeId) ? list : [...list, event.change],
          );
        if (event.type === 'ended') setEnded(true);
        if (event.type === 'unavailable') setUnavailable(true);
      },
      speed,
    );
    return stop;
  }, [sessionId, speed, run]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  /**
   * Live means the participant is on the phone now. A finished session is a
   * recording being replayed — same transcript, but calling it "in progress"
   * would be a lie, and offering to fast-forward a live call is nonsense.
   */
  const isLive = session !== null && session.endedAt === null;
  const heard = turns.length ? turns[turns.length - 1].atMs : 0;
  const total = useMemo(
    () => (session ? Math.max(heard, 1) : 1),
    [session, heard],
  );
  const flagged = captured.filter((c) => c.prohibitedHit !== null).length;
  const reviewCount = isLive ? captured.length : session?.changes.length ?? captured.length;

  if (unavailable) {
    return (
      <div className="view view-wide">
        <header className="phead">
          <div>
            <h1>{session?.subjectId ?? sessionId}</h1>
            <p className="phead-sub">No call stream for this session</p>
          </div>
        </header>
        <hr className="rule" />
        <div className="empty">
          <h2>There is no call to listen to</h2>
          <p>
            This session has no live stream — the call finished long enough ago that its audio and
            transcript are archived, or it was never placed. The proposed changes are still here.
          </p>
          <button className="btn" onClick={() => navigate({ name: 'review', sessionId })}>
            Go to the review
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view view-wide">
      <header className="phead">
        <div>
          <h1>{session?.subjectId ?? sessionId}</h1>
          <p className="phead-sub">
            {isLive ? (
              <>
                Call in progress
                {session?.startedAt ? ` · started ${clock(session.startedAt)}` : ''} ·{' '}
                {elapsed(heard)} elapsed
              </>
            ) : (
              <>
                Recording of a finished call
                {session?.startedAt && session?.endedAt
                  ? ` · ${clock(session.startedAt)}–${clock(session.endedAt)}`
                  : ''}{' '}
                · playing {elapsed(heard)}
              </>
            )}
          </p>
        </div>
        <div className="phead-right">
          {isLive && !ended && <span className="live-dot" aria-hidden="true" />}
          <span className="pill" data-s={isLive && !ended ? 'in_progress' : 'awaiting_review'}>
            {isLive ? (ended ? 'Awaiting review' : 'Listening') : 'Replay'}
          </span>
          {/* A finished call's changes already exist — no need to sit through
              the replay before the coordinator can go and review them. */}
          {(!isLive || ended) && (
            <button
              className="btn btn-primary"
              onClick={() => navigate({ name: 'review', sessionId })}
            >
              Review {reviewCount} change{reviewCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      </header>

      <hr className="rule" />

      <div className="live">
        <section className="panel">
          <div className="panel-head">
            <h2>Transcript</h2>
            <span className="dim">Read-only</span>
          </div>
          <div className="transcript" ref={feed} aria-live="polite" aria-atomic="false">
            {turns.length === 0 && (
              <p className="dim">
                {isLive ? 'Waiting for the call to connect…' : 'Starting the recording…'}
              </p>
            )}
            {turns.map((turn, i) => (
              <div className="turn" key={`${turn.atMs}-${i}`} data-who={turn.speaker}>
                <div>
                  <div className="turn-who">{turn.speaker === 'agent' ? 'Agent' : 'Participant'}</div>
                  <div className="turn-at">{elapsed(turn.atMs)}</div>
                </div>
                <p className="turn-text">
                  {turn.text}
                  {isLive && !ended && i === turns.length - 1 && (
                    <span className="caret" aria-hidden="true" />
                  )}
                </p>
              </div>
            ))}
          </div>
          <div className="replay">
            <span className="replay-time">{elapsed(heard)}</span>
            <span
              className="replay-track"
              role="img"
              aria-label={isLive ? 'Call progress' : 'Replay position'}
            >
              <i style={{ width: ended ? '100%' : `${Math.min(100, (heard / total) * 100)}%` }} />
            </span>
            {!isLive && <span className="replay-time">Speed</span>}
            {!isLive &&
              SPEEDS.map((s) => (
              <button
                key={s}
                className="btn"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
            {!isLive && (
              <button className="btn" onClick={() => setRun((n) => n + 1)}>
                Restart
              </button>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Captured so far</h2>
            <span className="dim">
              {captured.length} change{captured.length === 1 ? '' : 's'}
              {flagged > 0 && ` · ${flagged} flagged`}
            </span>
          </div>
          {captured.length === 0 ? (
            <div className="panel-body">
              <p className="dim">Medications appear here as the agent resolves them.</p>
            </div>
          ) : (
            <div className="capture">
              {captured.map((change) => (
                <div
                  className="capture-item"
                  key={change.changeId}
                  data-prohibited={change.prohibitedHit !== null}
                >
                  <div className="capture-drug">
                    <span className="tag" data-type={change.changeType}>
                      {CHANGE_TAG[change.changeType]}
                    </span>
                    <b>{displayName(change.proposed)}</b>
                  </div>
                  <div className="capture-sub">
                    {isUnresolved(change.proposed)
                      ? 'Unresolved · no RxCUI match'
                      : [change.proposed.dose, change.proposed.frequency].filter(Boolean).join(' · ') ||
                        'No dose recorded'}
                  </div>
                  {change.prohibitedHit && (
                    <div className="capture-sub" style={{ color: 'var(--alarm)' }}>
                      Prohibited · {change.prohibitedHit.className ?? 'named drug'} · §
                      {change.prohibitedHit.protocolSection}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
