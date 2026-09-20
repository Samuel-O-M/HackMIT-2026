/**
 * Placing a call from the dashboard.
 *
 * The voice server owns telephony and runs on its own origin (:8787, or an
 * ngrok host when a real phone is involved), so this is the one place in the
 * frontend that talks to something other than the data service. Kept in
 * `api/` with everything else rather than inlined into a screen, so the
 * origin is configured once.
 *
 * Set VITE_VOICE_BASE when the voice server is not on localhost — pointing it
 * at the ngrok URL is what lets a real handset be rung from this screen.
 */

const BASE = (import.meta.env.VITE_VOICE_BASE as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:8787';

export interface PlacedCall {
  callId: string;
  subjectId: string | null;
  to: string | null;
  from: string | null;
  provider: string;
  status: 'placing' | 'ringing' | 'queued' | 'answered' | 'declined' | 'ended' | 'failed';
  placedBy: string | null;
  placedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  sessionId: string | null;
  reason: string | null;
}

export interface TelephonyStatus {
  provider: string;
  ready: boolean;
  from: string | null;
  detail: string;
}

/**
 * A call that could not be placed is not an exception.
 *
 * "No handset is listening" and "that number is not in the fictitious range"
 * are ordinary outcomes with something useful to tell the coordinator, so
 * they come back as a call record with status 'failed' and a reason. Only a
 * dead server throws.
 */
export async function placeCall(subjectId: string, placedBy?: string): Promise<PlacedCall> {
  const res = await fetch(`${BASE}/api/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subjectId, placedBy }),
  });
  if (!res.ok && res.status >= 500) {
    throw new Error(`The voice server returned ${res.status}.`);
  }
  const body = await res.json();
  if (body?.call) return body.call as PlacedCall;
  throw new Error(body?.error ?? 'The voice server sent back something unexpected.');
}

export async function telephonyStatus(): Promise<TelephonyStatus> {
  const res = await fetch(`${BASE}/api/telephony`);
  if (!res.ok) throw new Error(`The voice server returned ${res.status}.`);
  return (await res.json()) as TelephonyStatus;
}

/**
 * Wait for a placed call to be answered, then hand back its brain session.
 *
 * The session id does not exist until the handset picks up, so there is nothing
 * to navigate to before then. Resolves null if the call is declined, ends, or
 * nobody answers within `timeoutMs` — the caller decides what to say about it.
 */
export async function waitForCallSession(
  callId: string,
  { timeoutMs = 120000, intervalMs = 1000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/calls`);
      if (res.ok) {
        const body = (await res.json()) as { calls?: PlacedCall[] };
        const call = (body.calls ?? []).find((c) => c.callId === callId);
        if (call?.sessionId) return call.sessionId;
        if (call && ['declined', 'failed', 'ended'].includes(call.status)) return null;
      }
    } catch {
      // A blip is not a reason to give up; the next tick tries again.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export const VOICE_BASE = BASE;
