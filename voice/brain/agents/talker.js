'use strict';

/**
 * THE TALKER — fast, realtime conversational agent.
 *
 * Uses the latest planner state (never waits for the planner) and may call
 * tools directly for anything immediately needed. Returns ONLY spoken words.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { chatWithTools, chatWithToolsStream } = require('../lib/openai');
const { createChunker, speakable } = require('../lib/speech');
const { formatConversation } = require('../lib/format');
const { schemasFor, dispatch } = require('../tools');
const patientTools = require('../tools/patient');

const POLICY = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'policy.md'), 'utf8');
const ROLE = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'talker.md'), 'utf8');
const SYSTEM_PROMPT = `${POLICY}\n\n---\n\n${ROLE}`;

function cleanSpoken(text) {
  let out = String(text || '').trim();
  out = out.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
  if (out.startsWith('"') && out.endsWith('"') && out.length > 1) out = out.slice(1, -1).trim();
  out = out.replace(/^(agent|assistant|say|speak|output)\s*[:\-]\s*/i, '').trim();
  return out;
}

function buildContext({ plannerState, conversation, patientRecord, opening = false }) {
  const state = plannerState
    ? JSON.stringify(plannerState, null, 2)
    : '(no planner state yet — this is the start of the call; greet and confirm identity)';
  const parts = [
    `### PLANNER STATE\n${state}`,
  ];
  // The participant's own record is preloaded every turn so the Talker is
  // grounded by default — it only calls patient_read for things not shown here.
  if (patientRecord) {
    parts.push(
      `### PATIENT RECORD (read from patient.db — authoritative)\n${JSON.stringify(patientRecord, null, 2)}`
    );
  }
  parts.push(`### RECENT CONVERSATION\n${formatConversation(conversation)}`);
  if (opening) {
    parts.push(
      '### CALL EVENT\nThe call has just connected. The participant has picked up and has not said anything yet. ' +
        'You speak first: open the call as your instructions describe.'
    );
  }
  parts.push('Return ONLY the words to say out loud.');
  return parts.join('\n\n');
}

/**
 * Small, always-current slice of patient.db: who they are, what study they are
 * on, and which medications are ongoing. Failures degrade to "not preloaded"
 * — the agents can still call patient_read.
 */
async function loadPatientRecord(subjectId) {
  if (!subjectId) return null;
  const read = (scope) => {
    try {
      return patientTools.read({ subjectId, scope, limit: 20 });
    } catch {
      return null;
    }
  };
  const record = {
    profile: read('profile'),
    enrollment: read('enrollment'),
    medications: read('medications'),
  };
  return record.profile || record.enrollment || (record.medications && record.medications.length)
    ? record
    : null;
}

async function respond({ plannerState, conversation, subjectId, sessionId }) {
  let patientRecord = null;
  try {
    patientRecord = await loadPatientRecord(subjectId);
  } catch {
    patientRecord = null; // grounding must never break the turn
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext({ plannerState, conversation, patientRecord }) },
  ];
  const { text, toolCalls, model } = await chatWithTools({
    messages,
    tools: schemasFor('talker'),
    model: config.talkerModel,
    effort: config.talkerEffort,
    maxRounds: config.maxToolRounds,
    execute: (name, args) => dispatch(name, args, { subjectId, sessionId }),
  });
  return { say: cleanSpoken(text), toolCalls, model };
}

/**
 * Same turn as respond(), but speech is handed out as it is written.
 * `onChunk({ text })` fires for each short piece that is ready to be spoken.
 * `onChunk({ wait: true })` fires once if the model reaches for a tool before
 * saying anything, so the client can fill the silence with a small noise.
 */
async function respondStream({ plannerState, conversation, subjectId, sessionId, onChunk, opening = false }) {
  let patientRecord = null;
  try {
    patientRecord = await loadPatientRecord(subjectId);
  } catch {
    patientRecord = null; // grounding must never break the turn
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext({ plannerState, conversation, patientRecord, opening }) },
  ];

  let count = 0;
  let waited = false;
  const send = (text) => {
    const clean = speakable(text, { first: count === 0 });
    if (!clean) return;
    count++;
    onChunk({ text: clean });
  };
  const chunker = createChunker((piece) => send(piece));

  const { text, toolCalls, model } = await chatWithToolsStream({
    messages,
    tools: schemasFor('talker'),
    model: config.talkerModel,
    effort: config.talkerEffort,
    maxRounds: config.maxToolRounds,
    execute: (name, args) => dispatch(name, args, { subjectId, sessionId }),
    onText: (delta) => chunker.push(delta),
    // Speak whatever the model already wrote before the tool wait; if it wrote
    // nothing, tell the client there is a wait to cover.
    onToolStart: ({ spokenSoFar }) => {
      chunker.flush();
      if (!spokenSoFar.trim() && !waited) {
        waited = true;
        onChunk({ wait: true });
      }
    },
  });
  chunker.flush();
  return { say: cleanSpoken(text), toolCalls, model };
}

module.exports = { respond, respondStream, cleanSpoken, SYSTEM_PROMPT };
