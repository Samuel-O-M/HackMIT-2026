'use strict';

/**
 * THE BRAIN — single-instance orchestrator.
 *
 * Two agents, decoupled:
 *
 *   handleTurn()  → runs the TALKER immediately and returns words to speak.
 *                   It does NOT wait for the planner.
 *   schedulePlan()→ runs the THINKER asynchronously, updating planner state,
 *                   applying controlled writes, and persisting memory.
 *
 * The Talker always reads the *latest available* planner state. The planner
 * collapses bursts (only one run at a time; a dirty flag triggers one re-run).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { patient, close } = require('./db');
const { seed, GENERAL_DB, PATIENT_DB } = require('./db/seed');
const patientTools = require('./tools/patient');
const talker = require('./agents/talker');
const thinker = require('./agents/thinker');
const config = require('./config');

function hasTable(file, table) {
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    db.close();
    return Boolean(row);
  } catch {
    return false;
  }
}

class Brain {
  constructor() {
    this.ready = false;
    this.sessions = new Map(); // sessionId -> runtime
  }

  init({ reseed = false } = {}) {
    const missing = !fs.existsSync(GENERAL_DB) || !fs.existsSync(PATIENT_DB);
    const stale = !missing && !hasTable(PATIENT_DB, 'planner_state');
    if (reseed || missing || stale) seed();
    this.ready = true;
    return this;
  }

  // ------------------------------------------------------------ runtime state
  runtime(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        state: null,
        plannerRunning: false,
        plannerDirty: false,
        plannerPromise: null,
        plannerErrors: [],
        lastPlanModel: null,
        lastPlanAt: null,
      });
    }
    return this.sessions.get(sessionId);
  }

  // ---------------------------------------------------------------- sessions
  ensureSession(sessionId, subjectId) {
    const p = patient();
    const existing = p.get('SELECT * FROM call_sessions WHERE session_id = ?', sessionId);
    if (existing) return existing;
    const enrollment = p.get('SELECT study_id FROM enrollments WHERE subject_id = ?', subjectId);
    p.execute(
      'INSERT INTO call_sessions (session_id, subject_id, study_id, status) VALUES (?,?,?,?)',
      sessionId,
      subjectId,
      enrollment?.study_id || null,
      'open'
    );
    return p.get('SELECT * FROM call_sessions WHERE session_id = ?', sessionId);
  }

  startSession(subjectId) {
    this.init();
    const sessionId = crypto.randomUUID();
    this.runtime(sessionId);
    return this.ensureSession(sessionId, subjectId);
  }

  endSession(sessionId) {
    patient().execute(
      "UPDATE call_sessions SET status = 'closed', ended_at = datetime('now') WHERE session_id = ?",
      sessionId
    );
  }

  getConversation(sessionId, limit = config.historyTurns) {
    return patientTools.read({ sessionId, subjectId: this.subjectOf(sessionId), scope: 'transcript', limit });
  }

  subjectOf(sessionId) {
    const row = patient().get('SELECT subject_id FROM call_sessions WHERE session_id = ?', sessionId);
    return row?.subject_id || null;
  }

  saveUtterance(sessionId, speaker, text) {
    if (!text || !String(text).trim()) return;
    const p = patient();
    const { m } = p.get('SELECT COALESCE(MAX(seq), 0) AS m FROM utterances WHERE session_id = ?', sessionId);
    p.execute(
      'INSERT INTO utterances (session_id, seq, speaker, transcript) VALUES (?,?,?,?)',
      sessionId,
      m + 1,
      speaker,
      String(text).trim()
    );
  }

  // ----------------------------------------------------------- planner state
  getState(sessionId, subjectId = this.subjectOf(sessionId)) {
    const rt = this.runtime(sessionId);
    if (rt.state) return rt.state;
    const stored = patientTools.read({ subjectId, sessionId, scope: 'planner_state' });
    if (stored) rt.state = stored;
    return rt.state;
  }

  setState(sessionId, subjectId, state) {
    const rt = this.runtime(sessionId);
    rt.state = state;
    if (state) {
      try {
        patientTools.update({ subjectId, sessionId, op: 'set_planner_state', payload: { state } });
      } catch (err) {
        rt.plannerErrors.push(`persist: ${err.message}`);
      }
    }
    return state;
  }

  // ------------------------------------------------------------- turn cycle
  /**
   * Fast path. Runs only the Talker and returns immediately.
   * Kicks the planner off in the background.
   */
  async handleTurn({ sessionId, subjectId, userText }) {
    this.init();
    const session = this.ensureSession(sessionId, subjectId);
    subjectId = session.subject_id;

    this.saveUtterance(sessionId, 'patient', userText);

    const state = this.getState(sessionId, subjectId);
    const conversation = this.getConversation(sessionId);

    const { say, toolCalls, model } = await talker.respond({
      plannerState: state,
      conversation,
      subjectId,
      sessionId,
    });

    this.saveUtterance(sessionId, 'agent', say);

    // Fire-and-forget: the patient never waits for the planner.
    const planned = this.schedulePlan(sessionId, subjectId);

    return { say, state, toolCalls, model, sessionId, planning: Boolean(planned) };
  }

  /** Queue a planner run (collapses bursts). Returns the running promise, if any. */
  schedulePlan(sessionId, subjectId) {
    const rt = this.runtime(sessionId);
    if (rt.plannerRunning) {
      rt.plannerDirty = true;
      return rt.plannerPromise;
    }
    rt.plannerRunning = true;
    rt.plannerPromise = (async () => {
      try {
        do {
          rt.plannerDirty = false;
          await this.runPlan(sessionId, subjectId);
        } while (rt.plannerDirty);
      } catch (err) {
        rt.plannerErrors.push(String(err.message || err));
        console.error('[planner]', err.message);
      } finally {
        rt.plannerRunning = false;
      }
    })();
    return rt.plannerPromise;
  }

  /** One planner pass: reason → apply structured writes → persist state. */
  async runPlan(sessionId, subjectId) {
    const rt = this.runtime(sessionId);
    const conversation = this.getConversation(sessionId, 50);
    const state = this.getState(sessionId, subjectId);

    const { state: next, toolCalls, model } = await thinker.plan({
      plannerState: state,
      conversation,
      subjectId,
      sessionId,
    });

    // Apply writes from `to_save` through controlled functions.
    const applied = [];
    for (const entry of next.to_save || []) {
      try {
        applied.push(patientTools.update({ subjectId, sessionId, op: entry.op, payload: entry.payload }));
      } catch (err) {
        rt.plannerErrors.push(`save(${entry.op}): ${err.message}`);
      }
    }

    this.setState(sessionId, subjectId, next);
    rt.lastPlanModel = model;
    rt.lastPlanAt = new Date().toISOString();
    return { state: next, applied, toolCalls };
  }

  /** Run a planner pass now and wait for it (used by CLI/tests). */
  async planNow(sessionId, subjectId = this.subjectOf(sessionId)) {
    this.init();
    await this.waitForIdle(sessionId);
    return this.runPlan(sessionId, subjectId);
  }

  async waitForIdle(sessionId) {
    const rt = this.runtime(sessionId);
    if (rt.plannerPromise) await rt.plannerPromise.catch(() => {});
  }

  plannerStatus(sessionId) {
    const rt = this.runtime(sessionId);
    return {
      running: rt.plannerRunning,
      dirty: rt.plannerDirty,
      errors: rt.plannerErrors.slice(-5),
      lastPlanModel: rt.lastPlanModel,
      lastPlanAt: rt.lastPlanAt,
    };
  }

  listPatients() {
    this.init();
    return patient().query(
      `SELECT p.subject_id, p.given_name, p.family_name, e.study_id, s.title AS study_title
         FROM patients p LEFT JOIN enrollments e ON e.subject_id = p.subject_id
         LEFT JOIN studies s ON s.study_id = e.study_id`
    );
  }

  close() {
    close();
    this.sessions.clear();
    this.ready = false;
  }
}

// Single shared instance by construction.
module.exports = new Brain();
module.exports.Brain = Brain;
module.exports.config = config;
