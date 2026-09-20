'use strict';

/**
 * The call registry: what is ringing, what was answered, what is over.
 *
 * A coordinator presses "Call" in the dashboard; a handset rings somewhere
 * else; the two have to find each other. This holds that state between them.
 *
 * In memory on purpose. A call in progress does not survive a server restart
 * in any telephony system — the carrier drops it too — so persisting it would
 * only produce ghost calls that can never be answered. What matters outlives
 * the process anyway: the conversation is in patient.db and the outcome is
 * published by the bridge.
 */

const { randomUUID } = require('node:crypto');
const telephony = require('./telephony');
const { subscribe } = require('./telephony/providers/simulated');

/** callId -> record. Bounded; see prune(). */
const calls = new Map();
const MAX_CALLS = 200;

function prune() {
  if (calls.size <= MAX_CALLS) return;
  const done = [...calls.values()]
    .filter((c) => c.status === 'ended' || c.status === 'declined' || c.status === 'failed')
    .sort((a, b) => (a.endedAt || a.placedAt).localeCompare(b.endedAt || b.placedAt));
  for (const c of done.slice(0, calls.size - MAX_CALLS)) calls.delete(c.callId);
}

function publicView(call) {
  if (!call) return null;
  const { providerCallSid, ...rest } = call;
  return rest;
}

/**
 * Ring a participant.
 *
 * `lookupPhone` is injected rather than imported so this module does not reach
 * into the patient database — the number is the caller's to supply, and a unit
 * test should not need a database to ring a fake phone.
 */
async function place({ subjectId, to, placedBy }) {
  const callId = randomUUID();
  const call = {
    callId,
    subjectId: subjectId || null,
    to: telephony.toE164(to),
    from: null,
    provider: telephony.providerName(),
    status: 'placing',
    placedBy: placedBy || null,
    placedAt: new Date().toISOString(),
    answeredAt: null,
    endedAt: null,
    sessionId: null,
    reason: null,
  };
  calls.set(callId, call);
  prune();

  const result = await telephony.placeCall({ to, subjectId, callId });
  if (!result.ok) {
    call.status = 'failed';
    call.reason = result.reason || 'could not place the call';
    call.endedAt = new Date().toISOString();
    return publicView(call);
  }

  call.status = result.status === 'ringing' ? 'ringing' : result.status || 'ringing';
  call.from = result.from || null;
  call.providerCallSid = result.providerCallSid || null;
  return publicView(call);
}

/** The handset picked up. `sessionId` ties the call to the brain session. */
function answer(callId, { sessionId } = {}) {
  const call = calls.get(callId);
  if (!call) return null;
  if (call.status === 'ringing' || call.status === 'placing' || call.status === 'queued') {
    call.status = 'answered';
    call.answeredAt = new Date().toISOString();
  }
  if (sessionId) call.sessionId = sessionId;
  return publicView(call);
}

function decline(callId) {
  const call = calls.get(callId);
  if (!call) return null;
  call.status = 'declined';
  call.endedAt = new Date().toISOString();
  return publicView(call);
}

function end(callId, { sessionId } = {}) {
  const call = calls.get(callId);
  if (!call) return null;
  call.status = 'ended';
  call.endedAt = new Date().toISOString();
  if (sessionId) call.sessionId = sessionId;
  return publicView(call);
}

/** The call a given brain session belongs to, if any. */
function forSession(sessionId) {
  for (const call of calls.values()) if (call.sessionId === sessionId) return publicView(call);
  return null;
}

function get(callId) {
  return publicView(calls.get(callId));
}

function list({ limit = 25 } = {}) {
  return [...calls.values()]
    .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    .slice(0, limit)
    .map(publicView);
}

module.exports = { place, answer, decline, end, get, list, forSession, subscribe };
