'use strict';

/**
 * Twilio — real calls over the public telephone network.
 *
 * Complete, and deliberately inert. It activates only when all three of
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TELEPHONY_FROM are set AND
 * TELEPHONY_PROVIDER=twilio. Absent any of those it reports why and places
 * nothing, because the failure mode of a half-configured telephony client is
 * a call to a stranger, billed to someone.
 *
 * No SDK. Twilio's REST API is form-encoded HTTP with basic auth, and adding
 * a dependency for that would be a merge conflict and an install step on
 * someone else's machine for no gain.
 *
 * How a real call would join the existing pipeline:
 *
 *   1. POST /Accounts/{sid}/Calls.json with a TwiML `Url`.
 *   2. Twilio fetches that URL and gets <Connect><Stream> pointing at
 *      wss://<public-host>/ws/twilio.
 *   3. Twilio streams 8 kHz mu-law audio both ways over that socket.
 *   4. That socket feeds the same brain the browser path feeds.
 *
 * Step 4 is the only part not written here: the browser sends 16-bit PCM and
 * Twilio sends mu-law, so a codec shim is needed. It is noted rather than
 * guessed at, because writing untested audio transcoding would look finished
 * without being finished.
 */

const API = 'https://api.twilio.com/2010-04-01';

function credentials() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID || '',
    token: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.TELEPHONY_FROM || '',
    publicHost: process.env.PUBLIC_HOST || '',
  };
}

function missing() {
  const c = credentials();
  const gaps = [];
  if (!c.sid) gaps.push('TWILIO_ACCOUNT_SID');
  if (!c.token) gaps.push('TWILIO_AUTH_TOKEN');
  if (!c.from) gaps.push('TELEPHONY_FROM');
  return gaps;
}

const TWILIO_PROVIDER = {
  defaultFrom: null,

  ready: () => missing().length === 0,

  describe() {
    const gaps = missing();
    if (gaps.length) return `Not configured — missing ${gaps.join(', ')}.`;
    const { publicHost } = credentials();
    return publicHost
      ? `Configured. Media stream would connect to wss://${publicHost}/ws/twilio.`
      : 'Credentials present, but PUBLIC_HOST is unset so Twilio has no media stream to connect to.';
  },

  async placeCall({ to, from, subjectId, callId }) {
    const gaps = missing();
    if (gaps.length) {
      return {
        ok: false,
        provider: 'twilio',
        reason: `Twilio is not configured (missing ${gaps.join(', ')}). No call was placed.`,
      };
    }
    const { sid, token, publicHost } = credentials();
    if (!publicHost) {
      return {
        ok: false,
        provider: 'twilio',
        reason: 'PUBLIC_HOST is unset — Twilio would have nowhere to stream audio to.',
      };
    }

    // Twilio fetches this and gets TwiML telling it where to stream.
    const twimlUrl = `https://${publicHost}/api/twilio/twiml?callId=${encodeURIComponent(callId)}` +
      `&subjectId=${encodeURIComponent(subjectId || '')}`;

    const body = new URLSearchParams({
      To: to,
      From: from,
      Url: twimlUrl,
      StatusCallback: `https://${publicHost}/api/twilio/status?callId=${encodeURIComponent(callId)}`,
      StatusCallbackEvent: 'initiated ringing answered completed',
      Method: 'POST',
    });

    const res = await fetch(`${API}/Accounts/${sid}/Calls.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, provider: 'twilio', reason: data.message || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      provider: 'twilio',
      to,
      from,
      callId,
      providerCallSid: data.sid || null,
      status: data.status || 'queued',
    };
  },

  async hangUp({ providerCallSid }) {
    const gaps = missing();
    if (gaps.length || !providerCallSid) {
      return { ok: false, provider: 'twilio', reason: 'not configured, or no call sid' };
    }
    const { sid, token } = credentials();
    await fetch(`${API}/Accounts/${sid}/Calls/${providerCallSid}.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ Status: 'completed' }),
    }).catch(() => {});
    return { ok: true, provider: 'twilio' };
  },
};

/**
 * The TwiML Twilio fetches when the callee picks up.
 *
 * <Connect><Stream> is the bidirectional form — <Start><Stream> only forks
 * audio outward, which would let the agent hear the participant but never
 * reply.
 */
function twimlFor({ publicHost, callId, subjectId }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${publicHost}/ws/twilio">
      <Parameter name="callId" value="${callId}"/>
      <Parameter name="subjectId" value="${subjectId || ''}"/>
    </Stream>
  </Connect>
</Response>`;
}

module.exports = { TWILIO_PROVIDER, twimlFor };
