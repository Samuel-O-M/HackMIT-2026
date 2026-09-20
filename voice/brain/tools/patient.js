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
    case 'planner_state': {
      if (!sessionId) return null;
      const row = p.get('SELECT state FROM planner_state WHERE session_id = ?', sessionId);
      return row ? safeParse(row.state) : null;
    }
    case 'transcript': {
      if (!sessionId) return [];
      return p
        .query(
          'SELECT speaker, transcript FROM utterances WHERE session_id = ? ORDER BY seq DESC LIMIT ?',
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

const WRITE_OPS = ['set_planner_state', 'add_medication_change', 'add_advice'];

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

      if (canonical) {
        const dupe = p.get(
          `SELECT staged_id FROM staged_changes
            WHERE session_id = ? AND ifnull(canonical_name,'') = ifnull(?,'')
              AND ifnull(change_type,'') = ifnull(?,'') LIMIT 1`,
          sessionId, canonical, changeType
        );
        if (dupe) return { ok: true, op, skipped: 'duplicate' };
      }

      p.execute(
        `INSERT INTO staged_changes
           (session_id, subject_id, study_id, change_type, reported_text, rxcui, canonical_name,
            indication, dose, route, frequency, start_date, start_date_precision,
            stop_date, stop_date_precision, ongoing)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sessionId, subjectId,
        p.get('SELECT study_id FROM call_sessions WHERE session_id = ?', sessionId)?.study_id || null,
        changeType,
        payload.reported_text || null, payload.rxcui || null, canonical,
        payload.indication || null, payload.dose || null, payload.route || null,
        payload.frequency || null, payload.start_date || null,
        payload.precision || payload.start_date_precision || 'unknown',
        payload.stop_date || null, payload.stop_date_precision || 'unknown',
        payload.ongoing === false ? 0 : 1
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

module.exports = { read, update, verifyIdentity, normalizeDob, READ_SCOPES, WRITE_OPS };
