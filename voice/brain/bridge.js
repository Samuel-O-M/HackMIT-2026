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
const { redactTurns } = require('./redact');

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
    // Symptom answer: null means the agent never asked, not "no".
    sideEffects: row.side_effects || null,
    sideEffectsNote: row.side_effects_note || null,
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
  const adherence = p.query('SELECT * FROM staged_adherence WHERE session_id = ? ORDER BY staged_adherence_id', sessionId) || [];
  const behaviours = p.query('SELECT * FROM staged_behaviours WHERE session_id = ? ORDER BY staged_behaviour_id', sessionId) || [];
  const symptoms = p.query('SELECT * FROM staged_symptoms WHERE session_id = ? ORDER BY staged_symptom_id', sessionId) || [];

  // Which of those behaviours actually breach this protocol. Resolved here
  // rather than on the call, because a "required" rule is breached by a
  // participant saying no — the agent's job was to ask, not to adjudicate.
  const studyId = call.study_id;
  const behaviourRules = studyId
    ? p.query('SELECT * FROM behaviour_rules WHERE study_id = ?', studyId) || []
    : [];
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

  const toBehaviour = (row) => {
    const rule = behaviourRules.find((r) => r.behaviour_code === row.behaviour_code) || null;
    // A rule the participant must MEET is breached when they report they are
    // not meeting it; every other rule type is breached by the behaviour
    // being present. Declining to answer is neither — it is unresolved.
    let breach = false;
    if (rule && row.status !== 'declined_to_answer' && row.status !== 'unknown') {
      breach = rule.rule_type === 'required'
        ? row.status === 'denied'
        : row.status === 'reported' && rule.rule_type !== 'monitored';
    }
    return {
      behaviourCode: row.behaviour_code,
      status: row.status || 'unknown',
      reportedText: row.reported_text || null,
      frequency: row.frequency || null,
      quantity: row.quantity || null,
      period: row.period || null,
      instrument: row.instrument || null,
      instrumentScore: row.instrument_score == null ? null : Number(row.instrument_score),
      rule: rule && {
        ruleType: rule.rule_type,
        threshold: rule.threshold || null,
        protocolSection: rule.protocol_section || null,
        rationale: rule.rationale || null,
      },
      breachesRule: breach,
    };
  };

  /**
   * Whether the drug's label lists this symptom.
   *
   * Resolved here rather than trusted from the planner. The model was leaving
   * it null even on turns where it had just called drug_safety, and "is this
   * on the label" is a string lookup against a cached FDA document — there is
   * no judgement in it, so there is no reason to ask a model.
   */
  const labelCache = (() => {
    try { return require('../../api/medical_data/openfda'); } catch { return null; }
  })();

  const toSymptom = (row) => ({
    canonicalName: row.canonical_name || null,
    isStudyDrug: row.is_study_drug === 1,
    symptom: row.symptom,
    severity: row.severity || null,
    since: row.since || null,
    sincePrecision: row.since_precision || 'unknown',
    // null means not checked. false means the label does not list it, which is
    // the finding an investigator most wants to see.
    onLabel: row.on_label == null ? resolvedLabels.get(row.staged_symptom_id) ?? null : row.on_label === 1,
    labelSource: row.label_source || resolvedSources.get(row.staged_symptom_id) || null,
    reportedText: row.reported_text || null,
  });

  const toAdherence = (row) => ({
    canonicalName: row.canonical_name || null,
    isStudyDrug: row.is_study_drug === 1,
    extent: row.extent || 'unknown',
    daysMissed: row.days_missed == null ? null : Number(row.days_missed),
    recallDays: row.recall_days == null ? 7 : Number(row.recall_days),
    reasons: (() => { try { return JSON.parse(row.reasons || '[]'); } catch { return []; } })(),
    reportedText: row.reported_text || null,
  });

  // Fill in on_label for anything the planner left unresolved. Cache-only
  // where possible; a publish must not hang on api.fda.gov.
  const resolvedLabels = new Map();
  const resolvedSources = new Map();
  if (labelCache) {
    for (const row of symptoms) {
      if (row.on_label != null || !row.canonical_name) continue;
      try {
        const label = await labelCache.labelFor(row.canonical_name);
        if (!label?.found) continue;
        const term = String(row.symptom || '').toLowerCase();
        const listed = label.symptoms.some((sx) => sx.includes(term) || term.includes(sx));
        resolvedLabels.set(row.staged_symptom_id, listed);
        resolvedSources.set(row.staged_symptom_id, label.source || 'openFDA drug label');
      } catch {
        // Leave it null. "Not checked" is honest; a guess is not.
      }
    }
  }

  // How the call ended, and what that makes of an empty result.
  const outcome = call.outcome && call.outcome !== 'in_progress'
    ? call.outcome
    // The agent never said. Infer only what is safe to infer: a call with no
    // turns was never had. Anything else stays 'partial' — honest about not
    // knowing, rather than claiming 'completed' on the agent's behalf.
    : turns.length === 0 ? 'no_answer' : 'partial';

  // Which attempt this was. Repeated failures to reach someone become a
  // protocol deviation, so the count is data, not trivia.
  const attempt = (p.get(
    `SELECT COUNT(*) AS n FROM call_sessions
      WHERE subject_id = ? AND started_at <= ?`,
    call.subject_id, call.started_at
  )?.n) || 1;

  /**
   * Questions the call never reached.
   *
   * A protocol rule with no staged row was not answered "no" — it was not
   * asked. Publishing only what was said would let a coordinator read silence
   * as a clean sweep, which is the same mistake as the empty-changes one.
   */
  const asked = new Set(behaviours.map((b) => b.behaviour_code));
  const notAsked = behaviourRules
    .map((r) => r.behaviour_code)
    .filter((code) => !asked.has(code));

  const ending = {
    outcome,
    detail: call.outcome_detail || null,
    callbackText: call.callback_text || null,
    callbackAfter: call.callback_after || null,
    attempt,
    notAsked,
  };

  // Did this call produce anything a coordinator can act on?
  const hasContent =
    staged.length > 0 || adherence.length > 0 || behaviours.length > 0 || symptoms.length > 0;

  const REVIEWABLE = new Set(['completed', 'partial']);
  const status =
    identity.outcome !== 'verified' ? 'no_contact'
      : REVIEWABLE.has(outcome) || hasContent ? 'awaiting_review'
      : 'no_contact';

  const payload = {
    session: {
      sessionId,
      subjectId: call.subject_id,
      studyId: call.study_id,
      startedAt: call.started_at,
      endedAt: call.ended_at || new Date().toISOString(),
      // A call whose identity never checked out is not reviewable clinical
      // data. It is published so the attempt is on record, and held back.
      status,
      changes: identity.outcome === 'verified' ? staged.map(toProposedChange) : [],
      adherence: identity.outcome === 'verified' ? adherence.map(toAdherence) : [],
      behaviours: identity.outcome === 'verified' ? behaviours.map(toBehaviour) : [],
      symptoms: identity.outcome === 'verified' ? symptoms.map(toSymptom) : [],
      // Whose account this is. A coordinator reading a medication list needs to
      // know it came from the participant's spouse rather than the participant.
      ending,
      callParticipants: {
        caregiverPresent: call.caregiver_present === 1,
        caregiverRelationship: call.caregiver_relationship || null,
        caregiverAuthStatus: call.caregiver_auth_status || 'none',
      },
      ...(identity.outcome === 'verified' && safetyFlags.length ? { safetyFlags } : {}),
    },
    identity,
    // Redacted here, at the boundary. The identity exchange stays; the name
    // and date of birth inside it do not cross into the clinical record.
    transcript: redactTurns(
      turns.map((t, i) => ({
        atMs: i * 6000,
        speaker: t.speaker === 'patient' ? 'participant' : 'agent',
        text: t.transcript,
      })),
      [
        p.get('SELECT given_name, family_name, dob FROM patients WHERE subject_id = ?', call.subject_id),
        // Anyone authorised to speak for them is named on the call too.
        ...(p.query('SELECT given_name, family_name FROM authorised_contacts WHERE subject_id = ?', call.subject_id) || []),
      ],
    ),
  };

  try {
    const res = await fetch(`${API}/agent/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    console.log(
      `[bridge] published ${sessionId} · ${payload.session.changes.length} change(s) · ` +
      `${payload.session.adherence.length} adherence · ${payload.session.behaviours.length} behaviour(s) · ` +
      `${payload.session.symptoms.length} symptom(s) · ` +
      `outcome ${outcome} · attempt ${attempt} · identity ${identity.outcome}` +
      (payload.session.callParticipants.caregiverPresent ? ` · caregiver ${payload.session.callParticipants.caregiverAuthStatus}` : '')
    );
    return {
      published: true,
      changes: payload.session.changes.length,
      adherence: payload.session.adherence.length,
      behaviours: payload.session.behaviours.length,
      symptoms: payload.session.symptoms.length,
      identity: identity.outcome,
      outcome,
      status,
    };
  } catch (err) {
    console.error('[bridge] could not publish', sessionId, String(err.message || err));
    return { published: false, reason: String(err.message || err), staged: staged.length };
  }
}

module.exports = { publishSession };
