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
  out = dedupeSpoken(out);
  return out;
}

/**
 * The tool loop can make the model restate its own words — sometimes glued
 * together with stray text between the copies ("…right?InvalidWhat…"). For
 * each sentence, look for a long phrase that appears twice: cut at the second
 * copy, then drop any unpunctuated tail the cut left behind. A sentence is
 * never spoken twice.
 */
function dedupeSpoken(text) {
  const seen = new Set();
  const kept = [];
  for (const raw of String(text || '').split(/(?<=[.!?])\s+/)) {
    let sentence = raw.trim();
    if (!sentence) continue;

    // Normalised view of this sentence (letters/digits/spaces) with a map back
    // to original indices, so a match in the normalised text can be cut out of
    // the real one.
    let norm = '';
    const map = [];
    for (let i = 0; i < sentence.length; i++) {
      const ch = sentence[i].toLowerCase();
      if (/[a-z0-9 ]/.test(ch)) {
        norm += ch;
        map.push(i);
      }
    }
    const WIN = 20;
    for (let p = 0; p + WIN <= norm.length; p++) {
      const q = norm.indexOf(norm.slice(p, p + WIN), p + WIN);
      // The second copy sits in the back half and starts well after the first.
      if (q !== -1 && q >= norm.length / 2 && q > p + WIN) {
        sentence = sentence.slice(0, map[q]).trim();
        // The cut can leave stray characters after the final punctuation.
        const tail = sentence.match(/[^.!?]*$/);
        if (tail && tail.index > 0) sentence = sentence.slice(0, tail.index).trim();
        break;
      }
    }

    const key = sentence.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(sentence);
  }
  return kept.join(' ');
}

function buildContext({ plannerState, conversation, patientRecord, opening = false, closing = false }) {
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
  // The planner has decided the review is done and asked to hang up. The Talker
  // gets one last turn, and must use it to say goodbye — not to ask anything.
  if (closing) {
    parts.push(
      '### CALL EVENT — THIS IS YOUR LAST MESSAGE\nThe review is complete. This is your final ' +
        'message: say one short, warm goodbye and nothing else. Do not ask a question and do not ' +
        'start a new topic. The call ends right after you speak.'
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

async function respond({ plannerState, conversation, subjectId, sessionId, closing = false }) {
  let patientRecord = null;
  try {
    patientRecord = await loadPatientRecord(subjectId);
  } catch {
    patientRecord = null; // grounding must never break the turn
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext({ plannerState, conversation, patientRecord, closing }) },
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
 * `onChunk({ text })` fires for each sentence that is ready to be spoken.
 * `onChunk({ wait: true })` fires once if the model reaches for a tool before
 * saying anything, so the client can fill the silence with a small noise.
 *
 * Deliberately simple: sentences are cut out of the finished text and sent to
 * TTS one at a time. No incremental parsing of the stream — that path produced
 * duplicated and clipped speech, and the finished text is always right.
 */
async function respondStream({ plannerState, conversation, subjectId, sessionId, onChunk, opening = false, closing = false }) {
  let patientRecord = null;
  try {
    patientRecord = await loadPatientRecord(subjectId);
  } catch {
    patientRecord = null; // grounding must never break the turn
  }
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildContext({ plannerState, conversation, patientRecord, opening, closing }) },
  ];

  const { text, toolCalls, model } = await chatWithToolsStream({
    messages,
    tools: schemasFor('talker'),
    model: config.talkerModel,
    effort: config.talkerEffort,
    maxRounds: config.maxToolRounds,
    execute: (name, args) => dispatch(name, args, { subjectId, sessionId }),
    // Speak whatever the model already wrote before the tool wait; if it wrote
    // nothing, tell the client there is a wait to cover.
    onToolStart: ({ spokenSoFar }) => {
      if (!spokenSoFar.trim()) onChunk({ wait: true });
    },
  });

  const say = cleanSpoken(text);
  // Take the finished text, split it by ".", speak each piece.
  for (const sentence of splitSentences(say)) onChunk({ text: sentence });
  return { say, toolCalls, model };
}

/** Split into sentences on "." (with abbreviations kept whole). */
function splitSentences(text) {
  return String(text || '')
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { respond, respondStream, cleanSpoken, SYSTEM_PROMPT };
