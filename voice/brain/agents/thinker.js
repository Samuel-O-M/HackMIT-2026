'use strict';

/**
 * THE THINKER / PLANNER — slower background brain.
 *
 * Because Chat Completions forbids reasoning_effort together with function
 * tools, the planner works in two tool-free reasoning passes:
 *
 *   Phase 1 — decide what to retrieve (health_search / patient_read).
 *   (orchestrator executes the retrievals — read-only)
 *   Phase 2 — given results, produce the final structured planner state.
 *
 * Writes are never performed here; they are returned as `to_save` and applied
 * by the orchestrator through controlled functions.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { chat, parseJson } = require('../lib/openai');
const { formatConversation } = require('../lib/format');
const { dispatch } = require('../tools');

const POLICY = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'policy.md'), 'utf8');
const ROLE = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'thinker.md'), 'utf8');
const SYSTEM_PROMPT = `${POLICY}\n\n---\n\n${ROLE}`;

function buildContext({ plannerState, conversation }) {
  const state = plannerState ? JSON.stringify(plannerState, null, 2) : '(none yet)';
  return [
    `### CURRENT PLANNER STATE\n${state}`,
    `### FULL CONVERSATION\n${formatConversation(conversation)}`,
  ].join('\n\n');
}

function safeParse(text) {
  try {
    return parseJson(text);
  } catch {
    return null;
  }
}

function normalize(raw) {
  const src = raw || {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    goal: typeof src.goal === 'string' ? src.goal : '',
    known: arr(src.known),
    missing: arr(src.missing).map(String),
    next_questions: arr(src.next_questions).map(String),
    retrieval: arr(src.retrieval).map((r) => (typeof r === 'string' ? r : JSON.stringify(r))),
    to_save: arr(src.to_save).filter((x) => x && x.op),
    flags: arr(src.flags),
    summary: typeof src.summary === 'string' ? src.summary : '',
    identity_status: typeof src.identity_status === 'string' ? src.identity_status : undefined,
    updated_at: new Date().toISOString(),
  };
}

const READ_TOOLS = new Set(['health_search', 'check_prohibited', 'patient_read', 'verify_identity']);

/** Phase 1: which lookups does the planner need? */
async function decideRetrieval(context) {
  const { text } = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `${context}\n\n### RETRIEVAL PHASE\n` +
          'Before finalizing, list the lookups you need. Return ONLY JSON:\n' +
          '{"retrieval":[{"tool":"health_search","args":{"query":"..."}},' +
          '{"tool":"patient_read","args":{"scope":"medications"}}]}\n' +
          'Maximum 3, read-only tools only (health_search, check_prohibited, patient_read). ' +
          'Use {"retrieval":[]} if you need none.',
      },
    ],
    { model: config.plannerModel, effort: config.plannerEffort, json: true }
  );
  const parsed = safeParse(text);
  const list = Array.isArray(parsed?.retrieval) ? parsed.retrieval : [];
  return list.filter((r) => r && READ_TOOLS.has(r.tool)).slice(0, 3);
}

/** Phase 2: produce the final planner state. */
async function synthesize(context, results) {
  const { text, model } = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `${context}\n\n### RETRIEVAL RESULTS\n${JSON.stringify(results, null, 2).slice(0, 8000)}\n\n` +
          'Return ONLY the final planner state JSON.',
      },
    ],
    { model: config.plannerModel, effort: config.plannerEffort, json: true }
  );
  return { state: normalize(parseJson(text)), model };
}

async function plan({ plannerState, conversation, subjectId, sessionId }) {
  const context = buildContext({ plannerState, conversation });

  let requests = [];
  try {
    requests = await decideRetrieval(context);
  } catch {
    requests = [];
  }

  const results = [];
  for (const req of requests) {
    const result = await dispatch(req.tool, req.args || {}, { subjectId, sessionId });
    results.push({ tool: req.tool, args: req.args || {}, result });
  }

  const { state, model } = await synthesize(context, results);
  return { state, toolCalls: results, model };
}

module.exports = { plan, normalize, SYSTEM_PROMPT };
