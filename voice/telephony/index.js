'use strict';

/**
 * Placing a call.
 *
 * Two providers behind one interface:
 *
 *   simulated  (default) — rings the voice web app. The "phone" is a browser
 *                          on the ngrok URL. Costs nothing, needs no account,
 *                          and is what the demo runs on.
 *   twilio               — places a real PSTN call. Fully written, and inert
 *                          until credentials exist, because a live call costs
 *                          money and can reach a real person.
 *
 * The seam exists so the rest of the system never learns which one is in use.
 * `placeCall` returns the same shape either way, and the review queue cannot
 * tell a simulated call from a real one — which is the point, since every
 * other part of this pipeline should be exercised identically by both.
 */

const { SIMULATED_PROVIDER } = require('./providers/simulated');
const { TWILIO_PROVIDER } = require('./providers/twilio');

const PROVIDERS = {
  simulated: SIMULATED_PROVIDER,
  twilio: TWILIO_PROVIDER,
};

/**
 * The reserved fictitious range.
 *
 * NANP sets aside 555-0100 through 555-0199 in every area code as numbers
 * that can never be assigned. Anything else — 555-0202 included — may be a
 * real telephone belonging to a real person. For a system that is one
 * environment variable away from dialling for real, seeding numbers outside
 * this range is a loaded gun, so the check lives here rather than in the
 * seeder alone.
 */
const FICTITIOUS = /^\+1\d{3}555 ?01\d{2}$/;

function isFictitious(e164) {
  return FICTITIOUS.test(String(e164 || '').replace(/[^\d+]/g, ''));
}

/** Best-effort E.164. Demo numbers are stored loosely; real ones will not be. */
function toE164(raw, defaultAreaCode = '617') {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (String(raw).trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  // "555-0114" — a seven-digit demo number missing its area code.
  if (digits.length === 7) return `+1${defaultAreaCode}${digits}`;
  return null;
}

function providerName() {
  const requested = String(process.env.TELEPHONY_PROVIDER || 'simulated').toLowerCase();
  return PROVIDERS[requested] ? requested : 'simulated';
}

function describe() {
  const name = providerName();
  const provider = PROVIDERS[name];
  return {
    provider: name,
    ready: provider.ready(),
    from: process.env.TELEPHONY_FROM || provider.defaultFrom || null,
    detail: provider.describe(),
  };
}

/**
 * Ring `to`.
 *
 * Refuses a non-fictitious number unless TELEPHONY_ALLOW_REAL_NUMBERS is set.
 * The guard is deliberately not something the caller can pass in: the whole
 * reason it exists is that a mistake here reaches a stranger's phone.
 */
async function placeCall({ to, subjectId, callId, sessionId }) {
  const name = providerName();
  const provider = PROVIDERS[name];
  const e164 = toE164(to);

  if (!e164) {
    return { ok: false, provider: name, reason: `"${to}" is not a dialable number` };
  }
  if (!isFictitious(e164) && process.env.TELEPHONY_ALLOW_REAL_NUMBERS !== 'true') {
    return {
      ok: false,
      provider: name,
      reason:
        `${e164} is outside the reserved fictitious range (555-0100 to 555-0199). ` +
        'Set TELEPHONY_ALLOW_REAL_NUMBERS=true only when you intend to dial a real telephone.',
    };
  }

  return provider.placeCall({
    to: e164,
    from: process.env.TELEPHONY_FROM || provider.defaultFrom,
    subjectId,
    callId,
    sessionId,
  });
}

module.exports = { placeCall, describe, providerName, toE164, isFictitious };
