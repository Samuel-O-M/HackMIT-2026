'use strict';

/**
 * Creates and seeds the two databases.
 *
 *   general_health.db  — READ-ONLY knowledge base.
 *                        General, non-personal guidance only. Drug and class
 *                        facts live in ../../api/medical_data (RxNorm / RxClass).
 *   patient.db         — READ + controlled WRITE clinical record, including the
 *                        planner state.
 *
 * Idempotent: drops and recreates both files.
 * Run:  node db/seed.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const GENERAL_DB = path.join(__dirname, '..', '..', '..', 'databases', 'health_guidance', 'general_health.db');
const PATIENT_DB = path.join(__dirname, '..', '..', '..', 'databases', 'call_sessions', 'patient.db');

// ---------------------------------------------------------------------------
// general_health.db  (read-only)
// ---------------------------------------------------------------------------
function seedGeneral() {
  const db = new DatabaseSync(GENERAL_DB);

  db.exec(`
    DROP TABLE IF EXISTS guidance;
    DROP TABLE IF EXISTS topics;

    -- General, non-personal guidance (the only trusted prose source)
    CREATE TABLE topics (
      topic_id TEXT PRIMARY KEY,
      title    TEXT NOT NULL,
      summary  TEXT NOT NULL
    );
    CREATE TABLE guidance (
      guidance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id    TEXT NOT NULL REFERENCES topics(topic_id),
      advice      TEXT NOT NULL,
      source      TEXT
    );
  `);

  const topics = [
    ['hypertension', 'High blood pressure', 'Usually symptomless; managed with lifestyle and medication taken consistently.'],
    ['type2_diabetes', 'Type 2 diabetes', 'Managed with diet, activity, and medication such as metformin.'],
    ['medication_adherence', 'Taking medication consistently', 'Routines and reminders improve consistency; missed doses are common and worth discussing.'],
    ['nsaid_caution', 'NSAIDs', 'Common pain relievers that can raise blood pressure and irritate the stomach.'],
    ['statin_therapy', 'Statins', 'Cholesterol-lowering medication; muscle aches are a reason to talk to a clinician.'],
    ['polypharmacy_review', 'Reviewing all medications', 'Over-the-counter drugs, vitamins, supplements and herbals count as medication.'],
  ];
  const guidance = [
    ['hypertension', 'Take blood-pressure medication at the same time each day, even when you feel fine.', 'General guidance (synthetic)'],
    ['type2_diabetes', 'Metformin is usually taken with meals to reduce stomach upset.', 'General guidance (synthetic)'],
    ['medication_adherence', 'A weekly pill organizer or a phone reminder can make a routine easier to keep.', 'General guidance (synthetic)'],
    ['medication_adherence', 'It is safe and useful to tell your care team about every medication you take, including ones you buy yourself.', 'General guidance (synthetic)'],
    ['nsaid_caution', 'Regular NSAID use can raise blood pressure; mention it if you take one often.', 'General guidance (synthetic)'],
    ['nsaid_caution', 'Some trials restrict NSAIDs; a study team can say whether they are allowed.', 'General guidance (synthetic)'],
    ['statin_therapy', 'New muscle aches while on a statin are worth reporting to a clinician.', 'General guidance (synthetic)'],
    ['polypharmacy_review', 'Bring or list everything you take — prescriptions, over-the-counter, vitamins, herbals — at each visit.', 'General guidance (synthetic)'],
  ];

  const run = (sql, rows) => {
    const stmt = db.prepare(sql);
    for (const row of rows) stmt.run(...row);
  };
  run('INSERT INTO topics (topic_id, title, summary) VALUES (?,?,?)', topics);
  run('INSERT INTO guidance (topic_id, advice, source) VALUES (?,?,?)', guidance);

  db.close();
  return GENERAL_DB;
}

// ---------------------------------------------------------------------------
// patient.db  (read + controlled write)
// ---------------------------------------------------------------------------
function seedPatient() {
  const db = new DatabaseSync(PATIENT_DB);

  db.exec(`
    -- Children before parents. A foreign key to a table that has already been
    -- dropped is a constraint failure, not a no-op, so this order is load
    -- bearing: every table here must appear before the ones it references.
    DROP TABLE IF EXISTS advice_log;
    DROP TABLE IF EXISTS planner_state;
    DROP TABLE IF EXISTS utterances;
    DROP TABLE IF EXISTS staged_symptoms;
    DROP TABLE IF EXISTS staged_adherence;
    DROP TABLE IF EXISTS staged_behaviours;
    DROP TABLE IF EXISTS staged_changes;
    DROP TABLE IF EXISTS call_sessions;
    DROP TABLE IF EXISTS authorised_contacts;
    DROP TABLE IF EXISTS behaviour_rules;
    DROP TABLE IF EXISTS protocol_rules;
    DROP TABLE IF EXISTS medications;
    DROP TABLE IF EXISTS enrollments;
    DROP TABLE IF EXISTS studies;
    DROP TABLE IF EXISTS patients;

    CREATE TABLE patients (
      subject_id         TEXT PRIMARY KEY,
      given_name         TEXT NOT NULL,
      family_name        TEXT NOT NULL,
      dob                TEXT,
      phone              TEXT,
      preferred_language TEXT DEFAULT 'en'
    );
    CREATE TABLE studies (
      study_id         TEXT PRIMARY KEY,
      nct_id           TEXT,
      title            TEXT NOT NULL,
      protocol_version TEXT
    );
    CREATE TABLE enrollments (
      subject_id    TEXT NOT NULL REFERENCES patients(subject_id),
      study_id      TEXT NOT NULL REFERENCES studies(study_id),
      enrolled_date TEXT,
      arm           TEXT,
      PRIMARY KEY (subject_id, study_id)
    );
    CREATE TABLE medications (
      log_id               INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id           TEXT NOT NULL REFERENCES patients(subject_id),
      study_id             TEXT,
      reported_text        TEXT,
      rxcui                TEXT,
      canonical_name       TEXT,
      indication           TEXT,
      dose                 TEXT,
      route                TEXT,
      frequency            TEXT,
      start_date           TEXT,
      start_date_precision TEXT,
      stop_date            TEXT,
      stop_date_precision  TEXT,
      ongoing              INTEGER DEFAULT 1,
      status               TEXT DEFAULT 'active',
      version              INTEGER DEFAULT 1,
      superseded_by        INTEGER,
      created_by           TEXT,
      created_at           TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE protocol_rules (
      rule_id          INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id         TEXT NOT NULL REFERENCES studies(study_id),
      rule_type        TEXT NOT NULL,
      rxcui            TEXT,
      class_id         TEXT,
      protocol_section TEXT,
      rationale        TEXT
    );
    -- People other than the participant who may lawfully be spoken to.
    --
    -- Consent is not something the agent can infer from the call. Either the
    -- site recorded this person on the participant's authorisation form before
    -- the call, or the agent may not discuss anything with them. A caller who
    -- says "I'm her daughter, she's right here" is not authorisation.
    CREATE TABLE authorised_contacts (
      contact_id      INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id      TEXT NOT NULL REFERENCES patients(subject_id),
      given_name      TEXT,
      family_name     TEXT,
      relationship    TEXT,
      -- caregiver | legally_authorised_representative | interpreter
      role            TEXT DEFAULT 'caregiver',
      authorised      INTEGER DEFAULT 0,
      consent_on_file TEXT
    );
    -- What the call proposes. NOT the medication log.
    --
    -- The agent is a proposer, never a writer: a coordinator reviews every one
    -- of these and only then promotes it into the medications table. Writing
    -- to the log would mean a rejection had to be a delete, which breaks the
    -- audit trail the study depends on.
    CREATE TABLE staged_changes (
      staged_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL REFERENCES call_sessions(session_id),
      subject_id   TEXT NOT NULL REFERENCES patients(subject_id),
      study_id     TEXT,
      change_type  TEXT,
      reported_text TEXT,
      rxcui        TEXT,
      canonical_name TEXT,
      indication   TEXT,
      dose         TEXT,
      route        TEXT,
      frequency    TEXT,
      start_date   TEXT,
      start_date_precision TEXT,
      stop_date    TEXT,
      stop_date_precision  TEXT,
      ongoing      INTEGER,
      -- Follow-up answers, in the participant's terms. NULL = never asked.
      effectiveness     TEXT,   -- working | partly | not_working | unsure
      side_effects      TEXT,   -- none | reported | serious | unsure
      side_effects_note TEXT,   -- what they said, when they reported something
      stop_reason       TEXT,   -- why they stopped or changed it
      created_at   TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE call_sessions (
      session_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES patients(subject_id),
      study_id   TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at   TEXT,
      status     TEXT DEFAULT 'open',
      identity_status   TEXT DEFAULT 'unverified',
      identity_attempts INTEGER DEFAULT 0,
      -- How the call ended, and therefore what an empty result MEANS.
      --
      -- Without this, a call where the participant hung up after giving their
      -- name is indistinguishable from one that walked the whole sweep and
      -- found nothing changed. Both produce no staged rows. One is a clean
      -- confirmatory result; the other needs calling back. A coordinator
      -- cannot tell them apart, and 'no changes' is the more dangerous
      -- reading, because it looks like an answer.
      --
      -- completed | partial | reschedule_requested | no_answer | declined |
      -- unable_to_verify | participant_unavailable | abandoned | agent_error
      outcome           TEXT DEFAULT 'in_progress',
      outcome_detail    TEXT,
      -- When they asked to be called back, in their words. Not parsed into a
      -- timestamp unless they gave one — the same precision rule the dates
      -- follow, for the same reason.
      callback_text     TEXT,
      callback_after    TEXT,
      -- Which attempt this is for this participant. Repeated failures to
      -- reach someone become a protocol deviation, so the count is data.
      attempt           INTEGER DEFAULT 1,
      -- Who was actually on the call. A spouse or adult child is often the one
      -- who knows what is in the pill organiser, and a coordinator reading the
      -- record later needs to know whose account this was.
      caregiver_present     INTEGER DEFAULT 0,
      caregiver_contact_id  INTEGER REFERENCES authorised_contacts(contact_id),
      caregiver_relationship TEXT,
      -- none | authorised | not_authorised | unverified. Never the details the
      -- caller offered — only whether they cleared the check.
      caregiver_auth_status TEXT DEFAULT 'none'
    );

    -- Non-drug protocol requirements.
    --
    -- Protocols restrict more than medication: alcohol, nicotine, grapefruit,
    -- sun exposure, strenuous exercise, blood donation, contraception. These
    -- are as reportable as a prohibited drug and nobody was asking about them.
    --
    -- The rule_type 'required' is not a typo. Contraception compliance is a rule the
    -- participant must MEET, so the flag fires on absence rather than presence.
    CREATE TABLE behaviour_rules (
      behaviour_rule_id INTEGER PRIMARY KEY AUTOINCREMENT,
      study_id          TEXT NOT NULL REFERENCES studies(study_id),
      behaviour_code    TEXT NOT NULL,
      -- prohibited | restricted | monitored | required
      rule_type         TEXT NOT NULL,
      threshold         TEXT,
      -- A validated screen, where one exists for this behaviour (e.g. AUDIT-C).
      instrument        TEXT,
      protocol_section  TEXT,
      rationale         TEXT
    );

    -- What the call heard about those behaviours. Staged, never the record.
    CREATE TABLE staged_behaviours (
      staged_behaviour_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT NOT NULL REFERENCES call_sessions(session_id),
      subject_id     TEXT NOT NULL REFERENCES patients(subject_id),
      study_id       TEXT,
      behaviour_code TEXT NOT NULL,
      reported_text  TEXT,
      -- reported | denied | declined_to_answer | unknown. "Declined" is a real
      -- answer and must survive to the coordinator, not be recorded as "no".
      status         TEXT,
      frequency      TEXT,
      quantity       TEXT,
      period         TEXT,
      instrument     TEXT,
      instrument_score INTEGER,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    -- Whether they are actually taking what is on the log.
    --
    -- The log records what was prescribed. Reconciling it against what is
    -- being swallowed is a different question, and the one that decides
    -- whether an efficacy signal means anything.
    CREATE TABLE staged_adherence (
      staged_adherence_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT NOT NULL REFERENCES call_sessions(session_id),
      subject_id    TEXT NOT NULL REFERENCES patients(subject_id),
      study_id      TEXT,
      log_id        INTEGER,
      canonical_name TEXT,
      is_study_drug INTEGER DEFAULT 0,
      -- as_prescribed | missed_some | stopped | never_started | unknown
      extent        TEXT,
      -- A count over a stated window, not a frequency adverb. "How many days
      -- out of the last seven" is answerable; "how often do you forget" invites
      -- the answer the participant thinks is wanted.
      days_missed   INTEGER,
      recall_days   INTEGER DEFAULT 7,
      -- JSON array of coded reasons: forgot | side_effects | felt_better |
      -- cost | too_many | ran_out | instructions_unclear | other
      reasons       TEXT,
      reported_text TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );

    -- Symptoms the participant reported, per medication.
    --
    -- The reason this exists: comparing clinician-reported to patient-reported
    -- adverse events, some symptoms are under-reported by clinicians by a
    -- factor of fifty. The participant is the only one who knows, and nobody
    -- was asking them between visits.
    --
    -- This is NOT an adverse-event determination. Causality, grading and
    -- expectedness are the investigator's to assign. This records what was
    -- said, with the label that prompted the question, and hands it over.
    CREATE TABLE staged_symptoms (
      staged_symptom_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT NOT NULL REFERENCES call_sessions(session_id),
      subject_id     TEXT NOT NULL REFERENCES patients(subject_id),
      study_id       TEXT,
      canonical_name TEXT,
      is_study_drug  INTEGER DEFAULT 0,
      symptom        TEXT NOT NULL,
      -- Their words, not a grade. 'mild'|'moderate'|'severe' only if they used
      -- one; otherwise null. Never inferred from tone.
      severity       TEXT,
      since          TEXT,
      since_precision TEXT DEFAULT 'unknown',
      -- Whether this symptom appears on the drug's own FDA label, and where
      -- that was checked. An unlabelled symptom is the interesting one.
      on_label       INTEGER,
      label_source   TEXT,
      reported_text  TEXT,
      created_at     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE utterances (
      utterance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL REFERENCES call_sessions(session_id),
      seq          INTEGER NOT NULL,
      speaker      TEXT NOT NULL,
      transcript   TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'text',
      created_at   TEXT DEFAULT (datetime('now'))
    );
    -- The planner's structured state (one row per session, latest wins).
    CREATE TABLE planner_state (
      session_id TEXT PRIMARY KEY REFERENCES call_sessions(session_id),
      subject_id TEXT NOT NULL REFERENCES patients(subject_id),
      state      TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE advice_log (
      advice_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL REFERENCES call_sessions(session_id),
      subject_id  TEXT NOT NULL REFERENCES patients(subject_id),
      topic_id    TEXT,
      advice_text TEXT NOT NULL,
      created_at  TEXT DEFAULT (datetime('now'))
    );
  `);

  db.prepare('INSERT INTO patients (subject_id, given_name, family_name, dob, phone, preferred_language) VALUES (?,?,?,?,?,?)')
    .run('0412', 'John', 'Smith', '1958-03-12', '555-0142', 'en');
  db.prepare('INSERT INTO studies (study_id, nct_id, title, protocol_version) VALUES (?,?,?,?)')
    .run('S1', 'NCT00000000', 'Phase 1 Study of an Investigational Agent (synthetic demo)', 'v3.0');
  db.prepare('INSERT INTO enrollments (subject_id, study_id, enrolled_date, arm) VALUES (?,?,?,?)')
    .run('0412', 'S1', '2026-05-04', 'Dose escalation');

  const med = db.prepare(`INSERT INTO medications
    (subject_id, study_id, reported_text, rxcui, canonical_name, indication, dose, route, frequency,
     start_date, start_date_precision, ongoing, status, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  med.run('0412', 'S1', 'metformin', '6809', 'metformin', 'type 2 diabetes', '500 mg', 'oral', 'twice daily', '2024-01-10', 'day', 1, 'active', 'seed');
  med.run('0412', 'S1', 'lisinopril', '29046', 'lisinopril', 'high blood pressure', '10 mg', 'oral', 'once daily', '2023-11-02', 'day', 1, 'active', 'seed');
  med.run('0412', 'S1', 'atorvastatin', '83367', 'atorvastatin', 'cholesterol', '20 mg', 'oral', 'once daily', '2023-11-02', 'day', 1, 'active', 'seed');

  const rule = db.prepare('INSERT INTO protocol_rules (study_id, rule_type, rxcui, class_id, protocol_section, rationale) VALUES (?,?,?,?,?,?)');
  // One row per RxClass id. 'NSAID' resolves to ATC M01A and the FDA EPC
  // "Nonsteroidal Anti-inflammatory Drug" (`node api/medical_data/cli.js class NSAID`).
  for (const classId of ['M01A', 'N0000175722']) {
    rule.run('S1', 'prohibited', null, classId, '6.5', 'NSAIDs prohibited from 7 days before first dose through end of study.');
  }
  rule.run('S1', 'monitored', '6809', null, '6.6', 'Metformin permitted but monitored for glycemic control.');

  // Non-drug restrictions. Every one of these is a real protocol clause type:
  // alcohol and hepatotoxicity, grapefruit and CYP3A4, live vaccines, UV
  // exposure on photosensitising agents, and contraception — which is a
  // requirement, so the flag fires when it is ABSENT.
  const brule = db.prepare(
    'INSERT INTO behaviour_rules (study_id, behaviour_code, rule_type, threshold, instrument, protocol_section, rationale) VALUES (?,?,?,?,?,?,?)'
  );
  brule.run('S1', 'alcohol', 'restricted', 'No more than 7 standard drinks per week, none within 48 hours of a dose',
    'AUDIT-C', '5.3.1', 'Study drug is hepatically cleared; alcohol confounds liver function tests.');
  brule.run('S1', 'grapefruit', 'prohibited', 'None for the duration of dosing', null, '5.3.2',
    'Grapefruit inhibits CYP3A4 and raises study drug exposure unpredictably.');
  brule.run('S1', 'nicotine', 'monitored', 'Record current use and any change since screening', null, '5.3.3',
    'Smoking status induces CYP1A2 and is a covariate in the PK model.');
  brule.run('S1', 'contraception', 'required', 'Two effective methods for participants of childbearing potential',
    null, '5.3.4', 'Reproductive toxicity is unknown for this agent.');
  brule.run('S1', 'blood_donation', 'prohibited', 'No donation during the study or for 30 days after the last dose',
    null, '5.3.5', 'Protects the participant from compounded haemoglobin decline.');

  db.close();
  return PATIENT_DB;
}

function seed() {
  return { general: seedGeneral(), patient: seedPatient() };
}

if (require.main === module) {
  const out = seed();
  console.log('Seeded:');
  console.log('  general_health.db ->', out.general, '(read-only: general guidance)');
  console.log('  patient.db        ->', out.patient, '(read + controlled write)');
}

module.exports = { seed, seedGeneral, seedPatient, GENERAL_DB, PATIENT_DB };
