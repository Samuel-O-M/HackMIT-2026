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
        // What the Talker asked the planner to work out next (consumed by runPlan).
        plannerDirective: null,
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
    const subjectId = this.subjectOf(sessionId);
    if (!subjectId) return [];
    return patientTools.read({ sessionId, subjectId, scope: 'transcript', limit });
  }

  subjectOf(sessionId) {
    const row = patient().get('SELECT subject_id FROM call_sessions WHERE session_id = ?', sessionId);
    return row?.subject_id || null;
  }

  identityStatus(sessionId) {
    const row = patient().get('SELECT identity_status FROM call_sessions WHERE session_id = ?', sessionId);
    return row?.identity_status || 'unverified';
  }

  /**
   * Once identity is verified, strip any identity/DOB asks from the state the
   * Talker sees, so it can never be handed self-contradictory instructions.
   */
  stateForTalker(sessionId, subjectId) {
    const state = { ...(this.getState(sessionId, subjectId) || {}), identity_status: this.identityStatus(sessionId) };

    // Follow-ups are a medication conversation: never before identity is done,
    // and the optional kinds stop for good once the per-call cap is reached.
    // Enforced here, in code, so a planner that loses count cannot turn the call
    // into a questionnaire. (Asking *why* something was stopped is exempt.)
    const optional = state.followup && ['feedback', 'group'].includes(state.followup.kind);
    const capped = (state.followups?.used ?? 0) >= config.maxFollowups;
    if (state.identity_status !== 'verified' || (optional && capped)) state.followup = null;

    if (state.identity_status !== 'verified') return state;
    const isIdentity = (s) => /identity|date of birth|\bdob\b|birth/i.test(String(s));
    return {
      ...state,
      missing: (state.missing || []).filter((m) => !isIdentity(m)),
      next_questions: (state.next_questions || []).filter((q) => !isIdentity(q)),
      retrieval: (state.retrieval || []).filter((r) => !isIdentity(r)),
    };
  }

  saveUtterance(sessionId, speaker, text, source = 'text') {
    if (!text || !String(text).trim()) return;
    const p = patient();
    const { m } = p.get('SELECT COALESCE(MAX(seq), 0) AS m FROM utterances WHERE session_id = ?', sessionId);
    p.execute(
      'INSERT INTO utterances (session_id, seq, speaker, transcript, source) VALUES (?,?,?,?,?)',
      sessionId,
      m + 1,
      speaker,
      String(text).trim(),
      source === 'stt' ? 'stt' : 'text'
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
  async handleTurn({ sessionId, subjectId, userText, onEvent, opening = false, source = 'text' }) {
    this.init();
    const session = this.ensureSession(sessionId, subjectId);
    subjectId = session.subject_id;

    // An opening turn is the agent speaking first: there is no participant
    // utterance to record, and it only makes sense at the very start.
    const isOpening = opening && this.getConversation(sessionId).length === 0;
    if (opening && !isOpening) {
      // Already underway: a repeated opening request must not greet twice or
      // record an empty participant turn.
      return { say: '', state: this.getState(sessionId, subjectId), toolCalls: [], model: null, latencyMs: 0, firstChunkMs: null, sessionId, planning: false };
    }
    if (!isOpening) this.saveUtterance(sessionId, 'patient', userText, source);

    const state = this.stateForTalker(sessionId, subjectId);
    const conversation = this.getConversation(sessionId);

    const t0 = Date.now();
    let firstChunkMs = null;
    // With `onEvent` the reply is streamed: short speakable chunks go out as
    // the model writes them. Without it, behaviour is unchanged.
    const { say, toolCalls, model, directive } = onEvent
      ? await talker.respondStream({
          plannerState: state,
          conversation,
          subjectId,
          sessionId,
          opening: isOpening,
          onChunk: (chunk) => {
            if (chunk.wait) return onEvent({ type: 'wait' });
            if (firstChunkMs === null) firstChunkMs = Date.now() - t0;
            onEvent({ type: 'say', text: chunk.text });
          },
        })
      : await talker.respond({ plannerState: state, conversation, subjectId, sessionId });
    const latencyMs = Date.now() - t0;

    this.saveUtterance(sessionId, 'agent', say);

    const rt = this.runtime(sessionId);
    rt.lastTurn = {
      at: new Date().toISOString(),
      userText,
      say,
      talker: { model, latencyMs, firstChunkMs, toolCalls, stateUsed: state, directive },
    };

    // Fire-and-forget: the patient never waits for the planner. The Talker has
    // just heard the answer, so it says here what the planner should work out —
    // the planner is no longer rediscovering the turn on its own.
    const planned = this.schedulePlan(sessionId, subjectId, directive);

    return { say, state, toolCalls, model, latencyMs, firstChunkMs, sessionId, planning: Boolean(planned), directive };
  }

  /** Queue a planner run (collapses bursts). Returns the running promise, if any. */
  schedulePlan(sessionId, subjectId, directive = null) {
    const rt = this.runtime(sessionId);
    // Newest directive wins: a burst of turns collapses into one planner run.
    if (directive) rt.plannerDirective = directive;
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

  /**
   * The planner keeps the follow-up count and the "closing question" status in
   * its own JSON, and a model can lose count or declare something done that never
   * happened. So the parts that can be checked are checked:
   *  - the count never goes backwards;
   *  - the closing question cannot be `asked`/`done` unless an agent turn in the
   *    transcript actually asked it (otherwise the call would close without it).
   */
  reconcileFollowups(next, previous, conversation) {
    const f = next.followups;
    if (!f) return next;
    f.used = Math.max(f.used || 0, previous?.followups?.used || 0);
    const askedGroup = conversation.some(
      (t) => t.speaker === 'agent' && /side effects?|not agreed with you|agreed with you|any (problems|trouble)/i.test(t.transcript || '')
    );
    if (f.group_check !== 'pending' && !askedGroup) f.group_check = 'pending';
    return next;
  }

  /** One planner pass: reason → apply structured writes → persist state. */
  async runPlan(sessionId, subjectId) {
    const rt = this.runtime(sessionId);
    const conversation = this.getConversation(sessionId, 50);
    const state = { ...(this.getState(sessionId, subjectId) || {}), identity_status: this.identityStatus(sessionId) };

    const directive = rt.plannerDirective;
    rt.plannerDirective = null;

    const { state: next, toolCalls, model } = await thinker.plan({
      plannerState: state,
      conversation,
      subjectId,
      sessionId,
      directive,
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

    this.reconcileFollowups(next, this.getState(sessionId, subjectId), conversation);
    this.setState(sessionId, subjectId, next);
    rt.lastPlanModel = model;
    rt.lastPlanAt = new Date().toISOString();
    rt.lastPlan = { at: rt.lastPlanAt, model, toolCalls, applied, state: next };
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

  /** Everything the debug UI needs, in one payload. */
  debug(sessionId) {
    const rt = this.runtime(sessionId);
    const session = patient().get('SELECT * FROM call_sessions WHERE session_id = ?', sessionId) || null;
    if (!session) {
      return {
        session: null,
        conversation: [],
        state: null,
        planner: this.plannerStatus(sessionId),
        lastTurn: rt.lastTurn || null,
        lastPlan: rt.lastPlan || null,
        channel: rt.channel || null,
        patient: null,
      };
    }
    const subjectId = session.subject_id;

    const patient_snapshot = subjectId
      ? {
          profile: patient().get(
            'SELECT subject_id, given_name, family_name, preferred_language FROM patients WHERE subject_id = ?',
            subjectId
          ),
          enrollment: patient().get(
            `SELECT e.study_id, e.arm, s.nct_id, s.title AS study_title, s.protocol_version
               FROM enrollments e JOIN studies s ON s.study_id = e.study_id WHERE e.subject_id = ?`,
            subjectId
          ),
          medications: patient().query(
            'SELECT log_id, canonical_name, rxcui, status, stop_date, start_date_precision, created_by, created_at FROM medications WHERE subject_id = ? ORDER BY log_id',
            subjectId
          ),
          protocol_rules: patient().query('SELECT rule_type, class_id, protocol_section FROM protocol_rules'),
          advice: patient().query(
            'SELECT topic_id, advice_text, created_at FROM advice_log WHERE session_id = ? ORDER BY advice_id DESC LIMIT 10',
            sessionId
          ),
        }
      : null;

    return {
      session,
      conversation: this.getConversation(sessionId, 100),
      state: this.getState(sessionId, subjectId),
      planner: this.plannerStatus(sessionId),
      lastTurn: rt.lastTurn || null,
      lastPlan: rt.lastPlan || null,
      channel: rt.channel || null,
      patient: patient_snapshot,
      maxFollowups: config.maxFollowups,
    };
  }

  /** Channel state reported by the voice client: idle | listening | thinking | speaking. */
  setChannel(sessionId, state) {
    const rt = this.runtime(sessionId);
    rt.channel = { state: String(state || 'idle'), at: new Date().toISOString() };
    return rt.channel;
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
