'use strict';

/**
 * Creates and seeds the two databases.
 *
 *   general_health.db  — READ-ONLY knowledge base.
 *                        General, non-personal guidance only. Drug and class
 *                        facts live in ../../drugdb (RxNorm / RxClass).
 *   patient.db         — READ + controlled WRITE clinical record, including the
 *                        planner state.
 *
 * Idempotent: drops and recreates both files.
 * Run:  node db/seed.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const GENERAL_DB = path.join(__dirname, 'general_health.db');
const PATIENT_DB = path.join(__dirname, 'patient.db');

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
    DROP TABLE IF EXISTS advice_log;
    DROP TABLE IF EXISTS planner_state;
    DROP TABLE IF EXISTS utterances;
    DROP TABLE IF EXISTS call_sessions;
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
    CREATE TABLE call_sessions (
      session_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES patients(subject_id),
      study_id   TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at   TEXT,
      status     TEXT DEFAULT 'open',
      identity_status   TEXT DEFAULT 'unverified',
      identity_attempts INTEGER DEFAULT 0
    );
    CREATE TABLE utterances (
      utterance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL REFERENCES call_sessions(session_id),
      seq          INTEGER NOT NULL,
      speaker      TEXT NOT NULL,
      transcript   TEXT NOT NULL,
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
  // "Nonsteroidal Anti-inflammatory Drug" (`node drugdb/cli.js class NSAID`).
  for (const classId of ['M01A', 'N0000175722']) {
    rule.run('S1', 'prohibited', null, classId, '6.5', 'NSAIDs prohibited from 7 days before first dose through end of study.');
  }
  rule.run('S1', 'monitored', '6809', null, '6.6', 'Metformin permitted but monitored for glycemic control.');

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
