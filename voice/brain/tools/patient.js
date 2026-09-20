'use strict';

/**
 * Controlled patient-data access.
 *
 * Reads are scoped (never a full dump). Writes go through a fixed set of named
 * operations — there is no arbitrary SQL surface exposed to the agents.
 */

const { patient } = require('../db');
const { normalizeDob } = require('../dates');

const READ_SCOPES = [
  'profile',
  'enrollment',
  'medications',
  'protocol_rules',
  'planner_state',
  'transcript',
  'advice',
  'behaviour_rules',
  'adherence',
  'authorised_contacts',
];

function read({ subjectId, sessionId, scope, limit }) {
  const p = patient();
  const max = Math.min(Number(limit) || 20, 100);
  const needSubject = () => {
    if (!subjectId) throw new Error(`patient_read("${scope}") requires a subject.`);
  };

  switch (scope) {
    case 'profile':
      needSubject();
      return p.get(
        'SELECT subject_id, given_name, family_name, dob, phone, preferred_language FROM patients WHERE subject_id = ?',
        subjectId
      );
    case 'enrollment':
      needSubject();
      return (
        p.get(
          `SELECT e.study_id, e.arm, e.enrolled_date, s.nct_id, s.title AS study_title, s.protocol_version
             FROM enrollments e JOIN studies s ON s.study_id = e.study_id
            WHERE e.subject_id = ?`,
          subjectId
        ) || null
      );
    case 'medications':
      needSubject();
      return p.query(
        `SELECT log_id, reported_text, canonical_name, rxcui, dose, route, frequency,
                status, start_date, start_date_precision, stop_date, stop_date_precision, ongoing
           FROM medications
          WHERE subject_id = ? AND status != 'stopped'
          ORDER BY log_id`,
        subjectId
      );
    case 'protocol_rules': {
      needSubject();
      const e = p.get('SELECT study_id FROM enrollments WHERE subject_id = ?', subjectId);
      return e
        ? p.query(
            'SELECT rule_type, rxcui, class_id, protocol_section, rationale FROM protocol_rules WHERE study_id = ?',
            e.study_id
          )
        : [];
    }
    case 'behaviour_rules': {
      needSubject();
      const e = p.get('SELECT study_id FROM enrollments WHERE subject_id = ?', subjectId);
      return e
        ? p.query(
            `SELECT behaviour_code, rule_type, threshold, instrument, protocol_section, rationale
               FROM behaviour_rules WHERE study_id = ? ORDER BY behaviour_code`,
            e.study_id
          )
        : [];
    }
    case 'adherence': {
      if (!sessionId) return [];
      return p.query(
        `SELECT canonical_name, is_study_drug, extent, days_missed, recall_days, reasons
           FROM staged_adherence WHERE session_id = ? ORDER BY staged_adherence_id`,
        sessionId
      );
    }
    case 'authorised_contacts': {
      needSubject();
      // Relationship and role only. The agent decides whether it may speak to
      // someone; it has no reason to be handed their name and read it aloud.
      return p.query(
        `SELECT contact_id, relationship, role, authorised
           FROM authorised_contacts WHERE subject_id = ? AND authorised = 1`,
        subjectId
      );
    }
    case 'planner_state': {
      if (!sessionId) return null;
      const row = p.get('SELECT state FROM planner_state WHERE session_id = ?', sessionId);
      return row ? safeParse(row.state) : null;
    }
    case 'transcript': {
      if (!sessionId) return [];
      return p
        .query(
          'SELECT speaker, transcript, source FROM utterances WHERE session_id = ? ORDER BY seq DESC LIMIT ?',
          sessionId,
          max
        )
        .reverse();
    }
    case 'advice': {
      if (!sessionId) return [];
      return p.query(
        'SELECT topic_id, advice_text, created_at FROM advice_log WHERE session_id = ? ORDER BY advice_id DESC LIMIT ?',
        sessionId,
        max
      );
    }
    default:
      throw new Error(`Unknown read scope "${scope}". Valid: ${READ_SCOPES.join(', ')}`);
  }
}


const EFFECTIVENESS = ['working', 'partly', 'not_working', 'unsure'];
const SIDE_EFFECTS = ['none', 'reported', 'serious', 'unsure'];
const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

/**
 * The follow-up answers on a medication, validated. Anything outside the
 * allowed values is dropped rather than stored: these are the participant's
 * words classified coarsely, and a made-up category is worse than a blank.
 * `null`/absent means "not asked" and is never written as a value.
 */
function readFeedback(payload) {
  const out = {};
  if (EFFECTIVENESS.includes(payload.effectiveness)) out.effectiveness = payload.effectiveness;
  if (SIDE_EFFECTS.includes(payload.side_effects)) out.side_effects = payload.side_effects;
  const note = clip(payload.side_effects_note, 500);
  if (note) out.side_effects_note = note;
  const reason = clip(payload.stop_reason, 300);
  if (reason) out.stop_reason = reason;
  return out;
}

/** Fold new follow-up answers into an already-staged row. Returns the fields changed. */
function mergeFeedback(p, row, feedback) {
  const sets = [];
  const vals = [];
  const put = (col, val) => {
    sets.push(`${col} = ?`);
    vals.push(val);
  };
  if (feedback.effectiveness) put('effectiveness', feedback.effectiveness);
  if (feedback.stop_reason) put('stop_reason', feedback.stop_reason);
  if (feedback.side_effects) {
    // "serious" is sticky: a later, calmer-sounding answer must not hide it.
    put('side_effects', row.side_effects === 'serious' ? 'serious' : feedback.side_effects);
  }
  if (feedback.side_effects_note) {
    // Answers accumulate ("upset stomach" ... then "mostly evenings"), but the
    // planner often re-sends the earlier words inside the later ones.
    const prior = row.side_effects_note;
    const next = feedback.side_effects_note;
    let note = next;
    if (prior && !next.includes(prior)) note = prior.includes(next) ? prior : `${prior}; ${next}`;
    put('side_effects_note', note.slice(0, 500));
  }
  if (!sets.length) return [];
  p.execute(`UPDATE staged_changes SET ${sets.join(', ')} WHERE staged_id = ?`, ...vals, row.staged_id);
  return sets.map((s) => s.split(' ')[0]);
}


// Both sides of the merge added follow-up capture, at different grains, and
// they are complementary rather than duplicate:
//
//   effectiveness / side_effects (above) ride on the medication row. Coarse,
//   per-drug, and the 'serious' flag is sticky — that is triage.
//   staged_symptoms / staged_adherence (below) are separate rows: a named
//   symptom checked against the drug's own FDA label, and a dose count over a
//   stated window. That is the record.
//
// Keeping only the flags would lose which symptom and whether the label knows
// it; keeping only the rows would lose the at-a-glance "is this working".
const WRITE_OPS = [
  'set_planner_state',
  'add_medication_change',
  'add_advice',
  'add_adherence_report',
  'add_behaviour_report',
  'add_symptom_report',
];

function update({ subjectId, sessionId, op, payload = {} }) {
  const p = patient();
  if (!subjectId) throw new Error('patient_update requires a subject.');

  switch (op) {
    case 'set_planner_state': {
      if (!sessionId) throw new Error('set_planner_state requires a session.');
      const json = JSON.stringify(payload.state || {});
      const existing = p.get('SELECT session_id FROM planner_state WHERE session_id = ?', sessionId);
      if (existing) {
        p.execute(
          "UPDATE planner_state SET state = ?, updated_at = datetime('now') WHERE session_id = ?",
          json,
          sessionId
        );
      } else {
        p.execute(
          'INSERT INTO planner_state (session_id, subject_id, state) VALUES (?,?,?)',
          sessionId,
          subjectId,
          json
        );
      }
      return { ok: true, op };
    }

    case 'add_medication_change': {
      // Staged for review, never written to the medication log. The coordinator
      // promotes; the agent proposes. See staged_changes in db/seed.js.
      const canonical = payload.canonical_name || null;
      const status = payload.status || 'active';
      const changeType =
        status === 'stopped' ? 'stop' :
        status === 'changed' ? 'modify' :
        status === 'unchanged' ? 'confirm_unchanged' : 'add';
      const feedback = readFeedback(payload);

      // The same medicine, however the planner happens to identify it this pass.
      const reported = payload.reported_text ? String(payload.reported_text).trim().toLowerCase() : null;
      const rxcui = payload.rxcui || null;
      if (canonical || rxcui || reported) {
        const dupe = p.get(
          `SELECT staged_id, side_effects, side_effects_note FROM staged_changes
            WHERE session_id = ? AND ifnull(change_type,'') = ?
              AND ( (? IS NOT NULL AND lower(canonical_name) = lower(?))
                 OR (? IS NOT NULL AND rxcui = ?)
                 OR (? IS NOT NULL AND lower(trim(reported_text)) = ?) )
            LIMIT 1`,
          sessionId, changeType, canonical, canonical, rxcui, rxcui, reported, reported
        );
        if (dupe) {
          // The planner re-emits a medication every pass. The change itself is
          // already staged, but a later pass may carry a new follow-up answer
          // ("it upsets my stomach"), which must not be lost to the duplicate check.
          const merged = mergeFeedback(p, dupe, feedback);
          return { ok: true, op, skipped: 'duplicate', ...(merged.length ? { merged } : {}) };
        }
      }

      p.execute(
        `INSERT INTO staged_changes
           (session_id, subject_id, study_id, change_type, reported_text, rxcui, canonical_name,
            indication, dose, route, frequency, start_date, start_date_precision,
            stop_date, stop_date_precision, ongoing,
            effectiveness, side_effects, side_effects_note, stop_reason)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sessionId, subjectId,
        p.get('SELECT study_id FROM call_sessions WHERE session_id = ?', sessionId)?.study_id || null,
        changeType,
        payload.reported_text || null, payload.rxcui || null, canonical,
        payload.indication || null, payload.dose || null, payload.route || null,
        payload.frequency || null, payload.start_date || null,
        payload.precision || payload.start_date_precision || 'unknown',
        payload.stop_date || null, payload.stop_date_precision || 'unknown',
        payload.ongoing === false ? 0 : 1,
        feedback.effectiveness ?? null, feedback.side_effects ?? null,
        feedback.side_effects_note ?? null, feedback.stop_reason ?? null
      );
      return { ok: true, op, staged: true };
    }

    case 'add_adherence_report': {
      if (!sessionId) throw new Error('add_adherence_report requires a session.');
      const name = payload.canonical_name || null;
      const extent = ['as_prescribed', 'missed_some', 'stopped', 'never_started', 'unknown']
        .includes(payload.extent) ? payload.extent : 'unknown';

      // A count only means something next to the window it was counted over.
      const recall = Number(payload.recall_days) > 0 ? Number(payload.recall_days) : 7;
      let missed = payload.days_missed == null ? null : Number(payload.days_missed);
      if (missed != null && (!Number.isFinite(missed) || missed < 0 || missed > recall)) missed = null;

      const dupe = name && p.get(
        `SELECT staged_adherence_id FROM staged_adherence
          WHERE session_id = ? AND ifnull(canonical_name,'') = ifnull(?,'') LIMIT 1`,
        sessionId, name
      );
      if (dupe) {
        p.execute(
          `UPDATE staged_adherence SET extent = ?, days_missed = ?, recall_days = ?,
                  reasons = ?, reported_text = ? WHERE staged_adherence_id = ?`,
          extent, missed, recall,
          JSON.stringify(payload.reasons || []), payload.reported_text || null,
          dupe.staged_adherence_id
        );
        return { ok: true, op, updated: true };
      }

      p.execute(
        `INSERT INTO staged_adherence
           (session_id, subject_id, study_id, log_id, canonical_name, is_study_drug,
            extent, days_missed, recall_days, reasons, reported_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        sessionId, subjectId,
        p.get('SELECT study_id FROM call_sessions WHERE session_id = ?', sessionId)?.study_id || null,
        payload.log_id == null ? null : Number(payload.log_id),
        name,
        payload.is_study_drug ? 1 : 0,
        extent, missed, recall,
        JSON.stringify(payload.reasons || []),
        payload.reported_text || null
      );
      return { ok: true, op, staged: true };
    }

    case 'add_behaviour_report': {
      if (!sessionId) throw new Error('add_behaviour_report requires a session.');
      const code = String(payload.behaviour_code || '').trim().toLowerCase();
      if (!code) throw new Error('add_behaviour_report requires a behaviour_code.');
      // "declined_to_answer" must survive as itself. Folding it into "denied"
      // would turn a refusal into a negative finding, which it is not.
      const status = ['reported', 'denied', 'declined_to_answer', 'unknown']
        .includes(payload.status) ? payload.status : 'unknown';

      const dupe = p.get(
        `SELECT staged_behaviour_id FROM staged_behaviours
          WHERE session_id = ? AND behaviour_code = ? LIMIT 1`,
        sessionId, code
      );
      const score = payload.instrument_score == null ? null : Number(payload.instrument_score);
      if (dupe) {
        p.execute(
          `UPDATE staged_behaviours SET status = ?, reported_text = ?, frequency = ?,
                  quantity = ?, period = ?, instrument = ?, instrument_score = ?
            WHERE staged_behaviour_id = ?`,
          status, payload.reported_text || null, payload.frequency || null,
          payload.quantity || null, payload.period || null,
          payload.instrument || null, Number.isFinite(score) ? score : null,
          dupe.staged_behaviour_id
        );
        return { ok: true, op, updated: true };
      }

      p.execute(
        `INSERT INTO staged_behaviours
           (session_id, subject_id, study_id, behaviour_code, reported_text, status,
            frequency, quantity, period, instrument, instrument_score)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        sessionId, subjectId,
        p.get('SELECT study_id FROM call_sessions WHERE session_id = ?', sessionId)?.study_id || null,
        code, payload.reported_text || null, status,
        payload.frequency || null, payload.quantity || null, payload.period || null,
        payload.instrument || null, Number.isFinite(score) ? score : null
      );
      return { ok: true, op, staged: true };
    }

    case 'add_symptom_report': {
      if (!sessionId) throw new Error('add_symptom_report requires a session.');
      const symptom = String(payload.symptom || '').trim();
      if (!symptom) throw new Error('add_symptom_report requires a symptom.');
      const sev = ['mild', 'moderate', 'severe'].includes(payload.severity) ? payload.severity : null;

      const dupe = p.get(
        `SELECT staged_symptom_id FROM staged_symptoms
          WHERE session_id = ? AND lower(symptom) = lower(?)
            AND ifnull(canonical_name,'') = ifnull(?,'') LIMIT 1`,
        sessionId, symptom, payload.canonical_name || null
      );
      if (dupe) return { ok: true, op, skipped: 'duplicate' };

      p.execute(
        `INSERT INTO staged_symptoms
           (session_id, subject_id, study_id, canonical_name, is_study_drug, symptom,
            severity, since, since_precision, on_label, label_source, reported_text)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        sessionId, subjectId,
        p.get('SELECT study_id FROM call_sessions WHERE session_id = ?', sessionId)?.study_id || null,
        payload.canonical_name || null,
        payload.is_study_drug ? 1 : 0,
        symptom, sev,
        payload.since || null,
        payload.since_precision || 'unknown',
        payload.on_label == null ? null : (payload.on_label ? 1 : 0),
        payload.label_source || null,
        payload.reported_text || null
      );
      return { ok: true, op, staged: true };
    }

    case 'add_advice': {
      if (!sessionId) throw new Error('add_advice requires a session.');
      p.execute(
        'INSERT INTO advice_log (session_id, subject_id, topic_id, advice_text) VALUES (?,?,?,?)',
        sessionId,
        subjectId,
        payload.topic_id || null,
        String(payload.text || '')
      );
      return { ok: true, op };
    }

    default:
      throw new Error(`Unknown write op "${op}". Valid: ${WRITE_OPS.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Identity verification (deterministic — the model must NOT compare dates)
// ---------------------------------------------------------------------------


const OUTCOMES = [
  'completed',
  'partial',
  'reschedule_requested',
  'no_answer',
  'declined',
  'unable_to_verify',
  'participant_unavailable',
  'abandoned',
  'agent_error',
];

/**
 * Record how the call ended.
 *
 * The agent's own reading of the call, because nothing downstream can recover
 * it. An empty result with no outcome is ambiguous in the worst direction: it
 * looks like "nothing has changed", which is a clinical finding, when it may
 * mean "we never got to ask".
 *
 * `callback_after` is only set when the participant gave something that
 * resolves to a real time. "Tomorrow morning" stays in `callback_text` as
 * their words — the same rule the medication dates follow, and for the same
 * reason: an invented precise time is worse than an honest vague one.
 */
function setCallOutcome({ sessionId, outcome, detail, callback_text, callback_after }) {
  if (!sessionId) throw new Error('set_call_outcome requires a session.');
  const p = patient();
  const value = OUTCOMES.includes(outcome) ? outcome : 'partial';

  // A reschedule without a callback note is still a reschedule, but the
  // coordinator has nothing to act on, so say so rather than losing it.
  const text = callback_text || null;
  let after = callback_after || null;
  if (after && Number.isNaN(Date.parse(after))) after = null;

  p.execute(
    `UPDATE call_sessions
        SET outcome = ?, outcome_detail = ?, callback_text = ?, callback_after = ?
      WHERE session_id = ?`,
    value, detail || null, text, after, sessionId
  );
  return {
    ok: true,
    outcome: value,
    callback: text,
    note: value === 'reschedule_requested' && !text
      ? 'Recorded, but no callback time was captured — ask when would suit them.'
      : undefined,
  };
}

/**
 * Does this behaviour trip the participant's protocol?
 *
 * The drug path resolves a name to an RxCUI and matches a rule. Behaviours
 * have no RxNorm concept, so the protocol rule is the whole answer — which is
 * why the codes are a closed set rather than free text.
 */
function checkBehaviour({ subjectId, behaviour_code }) {
  const p = patient();
  const code = String(behaviour_code || '').trim().toLowerCase();
  if (!code) return { error: 'behaviour_code required' };
  const e = p.get('SELECT study_id FROM enrollments WHERE subject_id = ?', subjectId);
  if (!e) return { restricted: false, reason: 'no enrollment on file' };

  const rule = p.get(
    `SELECT behaviour_code, rule_type, threshold, instrument, protocol_section, rationale
       FROM behaviour_rules WHERE study_id = ? AND behaviour_code = ?`,
    e.study_id, code
  );
  if (!rule) return { restricted: false, behaviour_code: code };
  return {
    restricted: rule.rule_type !== 'monitored',
    behaviour_code: code,
    rule_type: rule.rule_type,
    threshold: rule.threshold || null,
    instrument: rule.instrument || null,
    protocol_section: rule.protocol_section || null,
    rationale: rule.rationale || null,
  };
}

/**
 * May the agent speak to the person who is not the participant?
 *
 * Only if the site recorded them beforehand. A caller asserting a relationship
 * is not authorisation — that is the whole point of the check, and the reason
 * this reads a table rather than believing the transcript.
 *
 * Like the identity check, this returns an outcome. It never returns who is on
 * the list, which would let a caller guess their way onto it.
 */
function verifyCaregiver({ subjectId, sessionId, name, given_name, family_name, relationship }) {
  const p = patient();
  const rows = p.query(
    'SELECT contact_id, given_name, family_name, relationship, role FROM authorised_contacts WHERE subject_id = ? AND authorised = 1',
    subjectId
  ) || [];

  const claimed = normName([name, given_name, family_name].filter(Boolean).join(' '));
  const claimedRel = normName(relationship);
  const match = rows.find((r) => {
    const nameOk = claimed
      ? claimed.includes(normName(r.given_name)) && claimed.includes(normName(r.family_name))
      : false;
    const relOk = claimedRel ? normName(r.relationship) === claimedRel : false;
    // Name is the strong signal; relationship alone is not enough to pass.
    return nameOk && (relOk || !claimedRel);
  });

  const status = match ? 'authorised' : rows.length ? 'not_authorised' : 'none';
  if (sessionId) {
    p.execute(
      `UPDATE call_sessions
          SET caregiver_present = 1, caregiver_auth_status = ?, caregiver_contact_id = ?, caregiver_relationship = ?
        WHERE session_id = ?`,
      status, match ? match.contact_id : null, match ? match.relationship : null, sessionId
    );
  }
  return match
    ? { authorised: true, relationship: match.relationship, role: match.role }
    : { authorised: false, reason: rows.length ? 'not on the authorisation list' : 'no authorised contacts on file' };
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Compare a stated name + DOB against the record. Returns only pass/fail +
 * attempts — never the record value. Lockout after 3 failed attempts.
 */
function verifyIdentity({ subjectId, sessionId, name, given_name, family_name, dob }) {
  const p = patient();
  const rec = p.get('SELECT given_name, family_name, dob FROM patients WHERE subject_id = ?', subjectId);
  if (!rec) return { verified: false, error: 'unknown subject' };

  const sess = sessionId
    ? p.get('SELECT identity_status, identity_attempts FROM call_sessions WHERE session_id = ?', sessionId)
    : null;
  if (sess?.identity_status === 'verified') return { verified: true, already: true };
  if (sess?.identity_status === 'failed') return { verified: false, locked: true, attempts_left: 0 };

  const claimedName = normName([name, given_name, family_name].filter(Boolean).join(' '));
  const recGiven = normName(rec.given_name);
  const recFamily = normName(rec.family_name);
  const nameOk = claimedName ? claimedName.includes(recGiven) && claimedName.includes(recFamily) : true;

  const claimedDob = normalizeDob(dob);
  const recDob = normalizeDob(rec.dob);
  const dobOk = Boolean(claimedDob) && claimedDob === recDob;
  const verified = nameOk && dobOk;

  const attempts = (sess?.identity_attempts || 0) + (verified ? 0 : 1);
  const status = verified ? 'verified' : attempts >= 3 ? 'failed' : 'unverified';
  if (sessionId && sess) {
    p.execute(
      'UPDATE call_sessions SET identity_status = ?, identity_attempts = ? WHERE session_id = ?',
      status,
      attempts,
      sessionId
    );
  }

  return verified
    ? { verified: true, attempts }
    : { verified: false, attempts_left: Math.max(0, 3 - attempts), locked: attempts >= 3 };
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

module.exports = {
  read, update, verifyIdentity, checkBehaviour, verifyCaregiver, setCallOutcome, OUTCOMES,
  normalizeDob, READ_SCOPES, WRITE_OPS,
};
