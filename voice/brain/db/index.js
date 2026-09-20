'use strict';

/**
 * Database access layer with hard-wired access control:
 *
 *   generalHealth — READ-ONLY. Exposes only query() and SELECT-only statements.
 *   patient       — READ/WRITE. Exposes query() and execute().
 *
 * The separation is enforced here, not by convention: the general_health
 * database is opened with { readOnly: true } and every statement is checked to
 * be a SELECT before it runs.
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const GENERAL_DB = path.join(__dirname, '..', '..', '..', 'databases', 'health_guidance', 'general_health.db');
const PATIENT_DB = path.join(__dirname, '..', '..', '..', 'databases', 'call_sessions', 'patient.db');

function assertSelect(sql, label) {
  const head = sql.trim().split(/\s+/)[0].toUpperCase();
  if (head !== 'SELECT' && head !== 'WITH') {
    throw new Error(`${label} is read-only; only SELECT/WITH is allowed (got: ${head}).`);
  }
}

class ReadOnlyStore {
  constructor(file, label) {
    if (!fs.existsSync(file)) {
      throw new Error(`${label} not found at ${file}. Run: node db/seed.js`);
    }
    // readOnly: true is the real enforcement — any write throws at the engine level.
    this.db = new DatabaseSync(file, { readOnly: true });
    this.label = label;
    try {
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      /* best effort */
    }
  }
  /** Run a read-only query. Returns all rows. */
  query(sql, ...params) {
    assertSelect(sql, this.label);
    return this.db.prepare(sql).all(...params);
  }
  /** Convenience: first row or undefined. */
  get(sql, ...params) {
    assertSelect(sql, this.label);
    return this.db.prepare(sql).get(...params);
  }
  close() { this.db.close(); }
}

/** Follow-up answers on a staged change; databases seeded before these existed lack them. */
const FEEDBACK_COLUMNS = ['effectiveness', 'side_effects', 'side_effects_note', 'stop_reason'];

function migrate(db) {
  const have = db.prepare('PRAGMA table_info(staged_changes)').all().map((c) => c.name);
  if (have.length === 0) return; // table absent: nothing seeded yet
  for (const col of FEEDBACK_COLUMNS) {
    if (!have.includes(col)) db.exec(`ALTER TABLE staged_changes ADD COLUMN ${col} TEXT`);
  }
}

class ReadWriteStore {
  constructor(file, label) {
    if (!fs.existsSync(file)) {
      throw new Error(`${label} not found at ${file}. Run: node db/seed.js`);
    }
    this.db = new DatabaseSync(file);
    this.label = label;
    try {
      // WAL + busy_timeout avoid "database is locked" when another process
      // (the CLI, a reseed) touches the same file.
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      /* best effort */
    }
    migrate(this.db);
  }
  query(sql, ...params) {
    return this.db.prepare(sql).all(...params);
  }
  get(sql, ...params) {
    return this.db.prepare(sql).get(...params);
  }
  /** INSERT / UPDATE / DELETE. Returns { changes, lastInsertRowid }. */
  execute(sql, ...params) {
    return this.db.prepare(sql).run(...params);
  }
  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  close() { this.db.close(); }
}

let _general = null;
let _patient = null;

function generalHealth() {
  if (!_general) _general = new ReadOnlyStore(GENERAL_DB, 'general_health');
  return _general;
}

function patient() {
  if (!_patient) _patient = new ReadWriteStore(PATIENT_DB, 'patient');
  return _patient;
}

function close() {
  if (_general) { _general.close(); _general = null; }
  if (_patient) { _patient.close(); _patient = null; }
}

module.exports = { generalHealth, patient, close, GENERAL_DB, PATIENT_DB };
