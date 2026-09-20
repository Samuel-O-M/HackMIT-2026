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

const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  thirtieth: 30, 'thirty-first': 31, thirtyfirst: 31,
};
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function wordsToNumber(words) {
  let total = 0;
  let any = false;
  for (const w of words) {
    const v = NUM_WORDS[w];
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function iso(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parse a date of birth from digits or spoken words into YYYY-MM-DD. */
function normalizeDob(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = s.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 30 ? 2000 : 1900;
    let mo = a;
    let d = b;
    if (mo > 12 && b <= 12) {
      mo = b;
      d = a;
    }
    return iso(y, mo, d);
  }

  const tokens = s.split(' ');
  const monthIdx = tokens.findIndex((t) => MONTHS[t] != null);
  const month = monthIdx >= 0 ? MONTHS[tokens[monthIdx]] : null;

  let yStart = -1;
  let yEnd = -1;
  const i4 = tokens.findIndex((t) => /^(1[89]\d{2}|20\d{2})$/.test(t));
  const i19 = tokens.indexOf('nineteen');
  const i20 = tokens.indexOf('twenty');
  if (i4 !== -1) {
    yStart = i4;
    yEnd = i4;
  } else if (i19 !== -1) {
    yStart = i19;
    yEnd = i19;
    while (yEnd + 1 < tokens.length && NUM_WORDS[tokens[yEnd + 1]] != null) yEnd++;
  } else if (i20 !== -1) {
    yStart = i20;
    yEnd = i20;
    while (yEnd + 1 < tokens.length && NUM_WORDS[tokens[yEnd + 1]] != null) yEnd++;
  }

  let year = null;
  if (yStart >= 0) {
    if (i4 === yStart) {
      year = +tokens[yStart];
    } else {
      const rest = tokens.slice(yStart + 1, yEnd + 1);
      year = (tokens[yStart] === 'nineteen' ? 1900 : 2000) + (wordsToNumber(rest) || 0);
    }
  }

  let day = null;
  for (let i = 0; i < tokens.length; i++) {
    if (yStart >= 0 && i >= yStart && i <= yEnd) continue;
    if (/^\d{1,2}$/.test(tokens[i])) {
      const n = +tokens[i];
      if (n >= 1 && n <= 31) {
        day = n;
        break;
      }
    }
  }
  if (day == null) {
    const dayWords = tokens.filter((t, i) => {
      if (yStart >= 0 && i >= yStart && i <= yEnd) return false;
      if (i === monthIdx) return false;
      return NUM_WORDS[t] != null;
    });
    day = wordsToNumber(dayWords);
  }

  return month && day && year ? iso(year, month, day) : null;
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

module.exports = { read, update, verifyIdentity, normalizeDob, READ_SCOPES, WRITE_OPS };
