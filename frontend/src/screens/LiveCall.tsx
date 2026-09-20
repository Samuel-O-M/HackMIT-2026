import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import {
  mergeTurn,
  subscribeLiveCall,
  type LiveModification,
  type LiveSessionInfo,
  type LiveTurn,
} from '../api/liveCall';
import type { ProposedChange, ReconciliationSession } from '../types/contract';
import type { TranscriptTurn } from '../types/ui';
import { clock, elapsed } from '../lib/dates';
import { CHANGE_TAG, displayName, isUnresolved } from '../lib/entry';
import { navigate } from '../router';

interface Props {
  sessionId: string;
  /** The fixture session, when this is a finished call being replayed. */
  session: ReconciliationSession | null;
}

/**
 * The transcript screen, in two shapes.
 *
 * A finished call comes from the clinical record and is replayed (the demo's
 * shape). A call happening *right now* has no record yet — it is streamed from
 * the voice server: the conversation, and every change the agent stages. Which
 * one this is decides itself: a live call is one the fixtures do not know.
 */
export function LiveCall({ sessionId, session }: Props) {
  if (!session) return <LiveVoiceCall sessionId={sessionId} />;
  return <ReplayCall sessionId={sessionId} session={session} />;
}

// ---------------------------------------------------------------------------
// A call happening now
// ---------------------------------------------------------------------------

const ACTION_TAG: Record<string, string> = {
  add: 'ADD',
  stop: 'STOP',
  modify: 'MODIFY',
  confirm_unchanged: 'NO CHANGE',
  record: 'RECORD',
};

const KIND_LABEL: Record<LiveModification['kind'], string> = {
  medication: 'Medication',
  adherence: 'Adherence',
  behaviour: 'Protocol question',
  symptom: 'Symptom',
};

function LiveVoiceCall({ sessionId }: { sessionId: string }) {
  const [turns, setTurns] = useState<LiveTurn[]>([]);
  const [mods, setMods] = useState<LiveModification[]>([]);
  const [info, setInfo] = useState<LiveSessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTurns([]);
    setMods([]);
    setInfo(null);
    setError(null);
    return subscribeLiveCall(sessionId, (event) => {
      if (event.type === 'turn') setTurns((list) => mergeTurn(list, event.turn));
      else if (event.type === 'modification')
        setMods((list) => {
          const at = list.findIndex((m) => m.key === event.modification.key);
          if (at === -1) return [...list, event.modification];
          const next = list.slice();
          next[at] = event.modification; // re-emitted when it changes
          return next;
        });
      else if (event.type === 'session') setInfo(event.session);
      else if (event.type === 'error') setError(event.error);
    });
  }, [sessionId]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [turns.length]);

  const ended = Boolean(info?.endedAt);
  const subjectId = info?.subjectId ?? sessionId;

  return (
    <div className="view view-wide">
      <header className="phead">
        <div>
          <h1>{subjectId}</h1>
          <p className="phead-sub">
            {ended ? 'Call finished' : 'Call in progress'}
            {info?.startedAt ? ` · started ${clock(info.startedAt)}` : ''}
            {info?.identityStatus === 'verified' ? ' · identity verified' : ''}
          </p>
        </div>
        <div className="phead-right">
          {!ended && <span className="live-dot" aria-hidden="true" />}
          <span className="pill" data-s={ended ? 'awaiting_review' : 'in_progress'}>
            {ended ? 'Finished' : 'Live'}
          </span>
          {info?.studyId && (
            <button className="btn" onClick={() => navigate({ name: 'visits', studyId: info.studyId as string })}>
              Back to visits
            </button>
          )}
        </div>
      </header>

      <hr className="rule" />

      {error && <p className="alarm-why">{error}</p>}

      <div className="live">
        <section className="panel">
          <div className="panel-head">
            <h2>Conversation</h2>
            <span className="dim">Live</span>
          </div>
          <div className="transcript" ref={feed} aria-live="polite" aria-atomic="false">
            {turns.length === 0 && <p className="dim">Waiting for the call to connect…</p>}
            {turns.map((turn, i) => (
              <div className="turn" key={`${i}-${turn.speaker}`} data-who={turn.speaker}>
                <div>
                  <div className="turn-who">{turn.speaker === 'agent' ? 'Agent' : 'Participant'}</div>
                </div>
                <p className="turn-text">{turn.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Changes to the record</h2>
            <span className="dim">
              {mods.length} change{mods.length === 1 ? '' : 's'}
            </span>
          </div>
          {mods.length === 0 ? (
            <div className="panel-body">
              <p className="dim">Changes appear here as the agent records them.</p>
            </div>
          ) : (
            <div className="capture">
              {mods.map((m) => (
                <div className="capture-item" key={m.key}>
                  <div className="capture-drug">
                    <span className="tag" data-type={m.action}>
                      {ACTION_TAG[m.action] ?? m.action}
                    </span>
                    <b>{m.name}</b>
                  </div>
                  <div className="capture-sub">
                    {[KIND_LABEL[m.kind], m.detail, m.reportedText ? `“${m.reportedText}”` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {m.unresolved && m.kind === 'medication' && (
                    <div className="capture-sub">Unresolved · no RxCUI match</div>
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

// ---------------------------------------------------------------------------
// A finished call, replayed from the record
// ---------------------------------------------------------------------------

const SPEEDS = [1, 4, 12];

function ReplayCall({ sessionId, session }: { sessionId: string; session: ReconciliationSession }) {
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

  const isLive = session.endedAt === null;
  const heard = turns.length ? turns[turns.length - 1].atMs : 0;
  const total = useMemo(() => (session ? Math.max(heard, 1) : 1), [session, heard]);
  const flagged = captured.filter((c) => c.prohibitedHit !== null).length;
  const reviewCount = isLive ? captured.length : session.changes.length || captured.length;

  if (unavailable) {
    return (
      <div className="view view-wide">
        <header className="phead">
          <div>
            <h1>{session.subjectId}</h1>
            <p className="phead-sub">No call stream for this session</p>
          </div>
        </header>
        <hr className="rule" />
        <div className="empty">
          <h2>There is no call to listen to</h2>
          <p>Its transcript is archived, or the call was never placed.</p>
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
          <h1>{session.subjectId}</h1>
          <p className="phead-sub">
            {isLive ? (
              <>
                Call in progress
                {session.startedAt ? ` · started ${clock(session.startedAt)}` : ''} · {elapsed(heard)} elapsed
              </>
            ) : (
              <>
                Recording of a finished call
                {session.startedAt && session.endedAt
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
          {(!isLive || ended) && (
            <button className="btn btn-primary" onClick={() => navigate({ name: 'review', sessionId })}>
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
              <p className="dim">{isLive ? 'Waiting for the call to connect…' : 'Starting the recording…'}</p>
            )}
            {turns.map((turn, i) => (
              <div className="turn" key={`${turn.atMs}-${i}`} data-who={turn.speaker}>
                <div>
                  <div className="turn-who">{turn.speaker === 'agent' ? 'Agent' : 'Participant'}</div>
                  <div className="turn-at">{elapsed(turn.atMs)}</div>
                </div>
                <p className="turn-text">
                  {turn.text}
                  {isLive && !ended && i === turns.length - 1 && <span className="caret" aria-hidden="true" />}
                </p>
              </div>
            ))}
          </div>
          <div className="replay">
            <span className="replay-time">{elapsed(heard)}</span>
            <span className="replay-track" role="img" aria-label={isLive ? 'Call progress' : 'Replay position'}>
              <i style={{ width: ended ? '100%' : `${Math.min(100, (heard / total) * 100)}%` }} />
            </span>
            {!isLive && <span className="replay-time">Speed</span>}
            {!isLive &&
              SPEEDS.map((s) => (
                <button key={s} className="btn" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
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
