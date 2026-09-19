'use strict';

/**
 * Controlled patient-data access.
 *
 * Reads are scoped (never a full dump). Writes go through a fixed set of named
 * operations — there is no arbitrary SQL surface exposed to the agents.
 */

const { patient } = require('../db');

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
  if (!subjectId) throw new Error('patient_read requires a subject.');
  const max = Math.min(Number(limit) || 20, 100);

  switch (scope) {
    case 'profile':
      return p.get(
        'SELECT subject_id, given_name, family_name, preferred_language FROM patients WHERE subject_id = ?',
        subjectId
      );
    case 'enrollment':
      return (
        p.get(
          `SELECT e.study_id, e.arm, e.enrolled_date, s.nct_id, s.title AS study_title, s.protocol_version
             FROM enrollments e JOIN studies s ON s.study_id = e.study_id
            WHERE e.subject_id = ?`,
          subjectId
        ) || null
      );
    case 'medications':
      return p.query(
        `SELECT log_id, reported_text, canonical_name, rxcui, dose, route, frequency,
                status, start_date, start_date_precision, stop_date, stop_date_precision, ongoing
           FROM medications
          WHERE subject_id = ? AND status != 'stopped'
          ORDER BY log_id`,
        subjectId
      );
    case 'protocol_rules': {
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
      const canonical = payload.canonical_name || null;
      const status = payload.status || 'active';
      if (canonical) {
        const dupe = p.get(
          `SELECT log_id FROM medications
            WHERE subject_id = ? AND created_by = 'agent'
              AND ifnull(canonical_name,'') = ifnull(?,'')
              AND ifnull(status,'') = ifnull(?,'')
              AND ifnull(stop_date,'') = ifnull(?,'')
            LIMIT 1`,
          subjectId,
          canonical,
          status,
          payload.stop_date || null
        );
        if (dupe) return { ok: true, op, skipped: 'duplicate' };
      }
      p.execute(
        `INSERT INTO medications
           (subject_id, reported_text, rxcui, canonical_name, indication, dose, route, frequency,
            status, start_date, start_date_precision, stop_date, stop_date_precision, ongoing, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'agent')`,
        subjectId,
        payload.reported_text || null,
        payload.rxcui || null,
        canonical,
        payload.indication || null,
        payload.dose || null,
        payload.route || null,
        payload.frequency || null,
        status,
        payload.start_date || null,
        payload.precision || null,
        payload.stop_date || null,
        payload.precision || null,
        status === 'stopped' ? 0 : 1
      );
      return { ok: true, op, canonical_name: canonical, status };
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

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

module.exports = { read, update, READ_SCOPES, WRITE_OPS };
