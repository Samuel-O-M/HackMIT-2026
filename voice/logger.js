'use strict';

/**
 * Offline session logging for debugging.
 *
 * Every call appends to voice/logs/<sessionId>.jsonl (JSON lines, one event
 * per line): session start/end, every turn — what the participant said, what
 * the agent said, every tool call with its args and result, latency, model —
 * plus channel transitions and server errors.
 *
 * Nothing here sends data anywhere; the files stay on disk and are gitignored.
 */

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'logs');

// Session ids are UUIDs; the check also keeps the filename/header safe.
const ID_OK = /^[a-f0-9-]{10,64}$/i;

function fileFor(sessionId) {
  const id = String(sessionId || '');
  if (!ID_OK.test(id)) return null;
  return path.join(DIR, `${id}.jsonl`);
}

/** Append one event. Logging must never break a call, so it never throws. */
function append(sessionId, event, data = {}) {
  try {
    const file = fileFor(sessionId);
    if (!file) return;
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(
      file,
      JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n'
    );
  } catch {
    /* best-effort */
  }
}

/** Read back a session's log ('' when there is none yet). */
function readLog(sessionId) {
  try {
    const file = fileFor(sessionId);
    return file ? fs.readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

/** Server-wide error log (one file, not per session). */
function appendError(data = {}) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(
      path.join(DIR, 'server-errors.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), event: 'server.error', ...data }) + '\n'
    );
  } catch {
    /* best-effort */
  }
}

module.exports = { append, readLog, appendError, fileFor, DIR };
