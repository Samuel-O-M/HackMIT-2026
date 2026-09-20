/**
 * The live call, as the coordinator sees it.
 *
 * While a call is happening the voice server streams two things over SSE: the
 * conversation, and every change the agent stages against the participant's
 * record. This module is the browser end of that stream.
 *
 * It is deliberately separate from the `Transport` in `api/transport.ts`. That
 * interface is the *clinical record* — sessions, changes, signatures — and it is
 * served by fixtures or the data service. This is a live telemetry feed from a
 * different origin (the voice server), and mixing the two would tie the record
 * to whether a call happens to be running.
 */
import { VOICE_BASE } from './telephony';

export interface LiveTurn {
  speaker: 'agent' | 'participant';
  text: string;
}

export interface LiveModification {
  key: string;
  kind: 'medication' | 'adherence' | 'behaviour' | 'symptom';
  /** add | stop | modify | record — the verb, as the agent applied it. */
  action: string;
  name: string;
  detail: string | null;
  reportedText: string | null;
  unresolved?: boolean;
}

export interface LiveSessionInfo {
  subjectId: string;
  studyId: string | null;
  status: string;
  identityStatus: string;
  outcome: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export type LiveEvent =
  | { type: 'ready' }
  | { type: 'session'; session: LiveSessionInfo }
  | { type: 'turn'; turn: LiveTurn }
  | { type: 'modification'; modification: LiveModification }
  | { type: 'error'; error: string };

export type Unsubscribe = () => void;

/**
 * Subscribe to one session's live feed.
 *
 * `EventSource` reconnects on its own; the server replays the current session,
 * turns and modifications on every (re)connect, so a dropped connection heals
 * without the caller doing anything. The caller only has to be idempotent about
 * turns — see `mergeTurn` in the screen.
 */
export function subscribeLiveCall(sessionId: string, onEvent: (event: LiveEvent) => void): Unsubscribe {
  const url = `${VOICE_BASE}/api/brain/live?sessionId=${encodeURIComponent(sessionId)}`;
  let source: EventSource;
  try {
    source = new EventSource(url);
  } catch {
    onEvent({ type: 'error', error: 'This browser cannot open the live stream.' });
    return () => {};
  }

  source.onmessage = (ev) => {
    let parsed: LiveEvent;
    try {
      parsed = JSON.parse(ev.data) as LiveEvent;
    } catch {
      return; // a malformed frame is not worth tearing the stream down for
    }
    onEvent(parsed);
  };
  // A stream that cannot be reached at all is a fact the screen should show.
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) {
      onEvent({ type: 'error', error: `Cannot reach the voice server at ${VOICE_BASE}.` });
    }
  };

  return () => source.close();
}

/** Turn dedupe: the server replays on reconnect, so drop repeats by position. */
export function mergeTurn(list: LiveTurn[], turn: LiveTurn): LiveTurn[] {
  const last = list[list.length - 1];
  if (last && last.speaker === turn.speaker && last.text === turn.text) return list;
  return [...list, turn];
}
