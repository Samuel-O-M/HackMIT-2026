'use strict';

/**
 * The bridge from a finished call to the coordinator's review queue.
 *
 * During a call the agent accumulates proposals in `staged_changes` and the
 * identity check lands on `call_sessions`. Neither is the clinical record.
 * When the call ends, this hands both to the service that owns patient_data,
 * where they become a reconciliation session a coordinator can review.
 *
 * Nothing here writes to the medication log. A proposal becomes a log entry
 * only when a coordinator promotes it, under signature.
 *
 * If the service is not running the call still completes — the staged rows stay
 * in the call database and can be published later. A failed publish must never
 * take down a call that is already over.
 */
const { patient } = require('./db');

const API = process.env.TRIAL_API_BASE || 'http://localhost:5174';

/** staged_changes rows -> the ProposedChange shape the app reviews. */
function toProposedChange(row, index) {
  const entry = {
    logId: `NEW-${row.staged_id}`,
    reportedText: row.reported_text || '',
    rxcui: row.rxcui || null,
    canonicalName: row.canonical_name || null,
    indication: row.indication || null,
    dose: row.dose || null,
    route: row.route || null,
    frequency: row.frequency || null,
    startDate: row.start_date || null,
    startDatePrecision: row.start_date_precision || 'unknown',
    stopDate: row.stop_date || null,
    stopDatePrecision: row.stop_date_precision || 'unknown',
    ongoing: row.ongoing !== 0,
    // Follow-up answers: null means the agent never asked, not "no".
    effectiveness: row.effectiveness || null,
    sideEffects: row.side_effects || null,
    sideEffectsNote: row.side_effects_note || null,
    stopReason: row.stop_reason || null,
  };
  return {
    changeId: `CH-${row.session_id.slice(0, 4)}-${String(index + 1).padStart(2, '0')}`,
    changeType: row.change_type || 'add',
    targetLogId: null,
    current: null,
    proposed: entry,
    // The agent does not score itself here; the coordinator sees the trace.
    agentConfidence: row.rxcui ? 0.9 : 0.4,
    agentReasoning: `Reported on the call as "${entry.reportedText}".`,
    toolTrace: [],
    prohibitedHit: null,
    reviewStatus: 'pending',
  };
}

async function publishSession(sessionId) {
  const p = patient();
  const call = p.get('SELECT * FROM call_sessions WHERE session_id = ?', sessionId);
  if (!call) {
    // Say so. A publish that declines in silence is indistinguishable from one
    // that worked, which is exactly how this went unnoticed the first time.
    console.warn('[bridge] no call_sessions row for', sessionId);
    return { published: false, reason: 'unknown session' };
  }

  const staged = p.query('SELECT * FROM staged_changes WHERE session_id = ? ORDER BY staged_id', sessionId) || [];
  // Safety flags live only in the planner's state. A symptom that belongs to no
  // one medication has no staged row, so without this it would never reach a
  // coordinator at all.
  let safetyFlags = [];
  try {
    const row = p.get('SELECT state FROM planner_state WHERE session_id = ?', sessionId);
    const flags = row ? JSON.parse(row.state).flags : [];
    safetyFlags = (Array.isArray(flags) ? flags : [])
      .filter((f) => f && f.type === 'safety' && f.detail)
      .map((f) => ({ detail: String(f.detail).slice(0, 500) }));
  } catch {
    /* an unreadable state is not a reason to lose the call */
  }

  const turns = p.query('SELECT speaker, transcript FROM utterances WHERE session_id = ? ORDER BY seq', sessionId) || [];

  const identity = {
    sessionId,
    subjectId: call.subject_id,
    method: 'name_and_dob',
    // Only the outcome. The date of birth the caller offered is never stored —
    // on a failed check that would be data about someone who may not be them.
    outcome: call.identity_status === 'verified' ? 'verified'
      : call.identity_attempts > 0 ? 'failed' : 'not_attempted',
    attempts: call.identity_attempts || 0,
    verifiedAt: call.identity_status === 'verified' ? (call.ended_at || new Date().toISOString()) : null,
  };

  const payload = {
    session: {
      sessionId,
      subjectId: call.subject_id,
      studyId: call.study_id,
      startedAt: call.started_at,
      endedAt: call.ended_at || new Date().toISOString(),
      // A call whose identity never checked out is not reviewable clinical
      // data. It is published so the attempt is on record, and held back.
      status: identity.outcome === 'verified' ? 'awaiting_review' : 'in_progress',
      changes: identity.outcome === 'verified' ? staged.map(toProposedChange) : [],
      ...(identity.outcome === 'verified' && safetyFlags.length ? { safetyFlags } : {}),
    },
    identity,
    transcript: turns.map((t, i) => ({
      atMs: i * 6000,
      speaker: t.speaker === 'patient' ? 'participant' : 'agent',
      text: t.transcript,
    })),
  };

  try {
    const res = await fetch(`${API}/agent/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    console.log(`[bridge] published ${sessionId} · ${payload.session.changes.length} change(s) · identity ${identity.outcome}`);
    return { published: true, changes: payload.session.changes.length, identity: identity.outcome };
  } catch (err) {
    console.error('[bridge] could not publish', sessionId, String(err.message || err));
    return { published: false, reason: String(err.message || err), staged: staged.length };
  }
}

module.exports = { publishSession };
