'use strict';

/**
 * The simulated carrier.
 *
 * "Ringing a phone" here means notifying any voice web app that has subscribed
 * to the call stream. The phone is a browser on the ngrok URL; the ring is a
 * server-sent event. Everything after the answer — the session, the agent
 * speaking first, staging, the bridge — is the real code path.
 *
 * This is not a stub standing in for the interesting part. The interesting
 * part is what happens once someone says hello, and that is identical here.
 */

const listeners = new Set();

/** A browser subscribing to incoming calls. `send` takes a JSON-able event. */
function subscribe(send) {
  listeners.add(send);
  return () => listeners.delete(send);
}

function broadcast(event) {
  for (const send of listeners) {
    try {
      send(event);
    } catch {
      listeners.delete(send); // a dead connection is not an error worth raising
    }
  }
}

const SIMULATED_PROVIDER = {
  // A number in the reserved fictitious range, so the "site" caller ID can
  // never be a real telephone either.
  defaultFrom: '+16175550100',

  ready: () => true,

  describe: () =>
    listeners.size === 0
      ? 'No handset connected. Open the voice app (or the ngrok URL on a phone) to receive calls.'
      : `${listeners.size} handset${listeners.size === 1 ? '' : 's'} connected.`,

  async placeCall({ to, from, subjectId, callId }) {
    if (listeners.size === 0) {
      return {
        ok: false,
        provider: 'simulated',
        reason: 'nothing is listening — open the voice app on the phone first',
      };
    }
    broadcast({ type: 'ringing', callId, subjectId, to, from, at: new Date().toISOString() });
    return { ok: true, provider: 'simulated', to, from, callId, status: 'ringing' };
  },

  async hangUp({ callId }) {
    broadcast({ type: 'hangup', callId, at: new Date().toISOString() });
    return { ok: true, provider: 'simulated' };
  },
};

module.exports = { SIMULATED_PROVIDER, subscribe, broadcast };
