'use strict';

/**
 * SQLite cache in front of RxNav. Write-through: anything looked up live is
 * kept, so a demo that has run once (or `node build.js`) works offline.
 *
 * Misses are never cached — a term RxNav cannot resolve today might tomorrow.
 * The committed drugs.db is a snapshot of what `build.js` warmed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DRUGDB_PATH || path.join(__dirname, 'drugs.db');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS concepts (
    rxcui TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    tty   TEXT
  );
  CREATE TABLE IF NOT EXISTS ingredients (
    rxcui            TEXT NOT NULL,
    ingredient_rxcui TEXT NOT NULL,
    PRIMARY KEY (rxcui, ingredient_rxcui)
  );
  CREATE TABLE IF NOT EXISTS terms (
    term  TEXT PRIMARY KEY,
    rxcui TEXT NOT NULL,
    match TEXT NOT NULL,
    score REAL
  );
  CREATE TABLE IF NOT EXISTS classes (
    class_id TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    type     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS drug_classes (
    rxcui    TEXT NOT NULL,
    class_id TEXT NOT NULL,
    PRIMARY KEY (rxcui, class_id)
  );
  CREATE TABLE IF NOT EXISTS classified (
    rxcui TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`;

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  return db;
}

const one = (sql, ...p) => open().prepare(sql).get(...p);
const all = (sql, ...p) => open().prepare(sql).all(...p);
const run = (sql, ...p) => open().prepare(sql).run(...p);

function tx(fn) {
  open().exec('BEGIN');
  try {
    const out = fn();
    open().exec('COMMIT');
    return out;
  } catch (err) {
    open().exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  DB_PATH,
  close() {
    if (db) db.close();
    db = null;
  },

  getTerm: (term) => one('SELECT rxcui, match, score FROM terms WHERE term = ?', term),
  putTerm: (term, rxcui, match, score) =>
    run('INSERT OR REPLACE INTO terms (term, rxcui, match, score) VALUES (?,?,?,?)', term, rxcui, match, score ?? null),

  getConcept: (rxcui) => one('SELECT rxcui, name, tty FROM concepts WHERE rxcui = ?', rxcui),
  putConcept: (c) => run('INSERT OR REPLACE INTO concepts (rxcui, name, tty) VALUES (?,?,?)', c.rxcui, c.name, c.tty ?? null),

  getIngredients: (rxcui) =>
    all(
      `SELECT c.rxcui, c.name, c.tty FROM ingredients i JOIN concepts c ON c.rxcui = i.ingredient_rxcui
        WHERE i.rxcui = ? ORDER BY c.name`,
      rxcui,
    ),
  putIngredients: (rxcui, list) =>
    tx(() => {
      for (const c of list) {
        run('INSERT OR REPLACE INTO concepts (rxcui, name, tty) VALUES (?,?,?)', c.rxcui, c.name, c.tty ?? null);
        run('INSERT OR IGNORE INTO ingredients (rxcui, ingredient_rxcui) VALUES (?,?)', rxcui, c.rxcui);
      }
    }),

  isClassified: (rxcui) => Boolean(one('SELECT 1 AS x FROM classified WHERE rxcui = ?', rxcui)),
  getDirectClassIds: (rxcui) => all('SELECT class_id FROM drug_classes WHERE rxcui = ?', rxcui).map((r) => r.class_id),
  putDirectClasses: (rxcui, classes) =>
    tx(() => {
      for (const c of classes) {
        run('INSERT OR IGNORE INTO classes (class_id, name, type) VALUES (?,?,?)', c.classId, c.name, c.type);
        run('INSERT OR IGNORE INTO drug_classes (rxcui, class_id) VALUES (?,?)', rxcui, c.classId);
      }
      run('INSERT OR IGNORE INTO classified (rxcui) VALUES (?)', rxcui);
    }),

  getClass: (classId) => one('SELECT class_id AS classId, name, type FROM classes WHERE class_id = ?', classId),
  getClasses: (ids) => ids.map((id) => one('SELECT class_id AS classId, name, type FROM classes WHERE class_id = ?', id)).filter(Boolean),
  allClasses: () => all('SELECT class_id AS classId, name, type FROM classes'),
  putClasses: (list) =>
    tx(() => {
      for (const c of list) run('INSERT OR REPLACE INTO classes (class_id, name, type) VALUES (?,?,?)', c.classId, c.name, c.type);
    }),

  getMeta: (key) => one('SELECT value FROM meta WHERE key = ?', key)?.value ?? null,
  putMeta: (key, value) => run('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)', key, String(value)),
};
