'use strict';

/**
 * Tiny zero-dependency test server for the voice module.
 *
 * - Serves the static UI from ./public
 * - Proxies requests to Deepgram (STT/TTS) and OpenAI (chat) so that the
 *   API keys never reach the browser.
 * - Reads keys from the repository-root .env (../.env relative to this file).
 *
 * Run:  node server.js
 * Then: open http://localhost:8787
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const brain = require('./brain/brain');
const logger = require('./logger');
const calls = require('./calls');
const telephony = require('./telephony');
const { patient } = require('./brain/db');

let WS = null;
try {
  WS = require('ws'); // optional: enables the live-STT WebSocket proxy
} catch {
  WS = null;
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8787;

// --- Load repository-root .env (../.env), without overriding real env vars ---
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return; // no .env, rely on process.env
  }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const DEEPGRAM_STT_MODEL = process.env.DEEPGRAM_STT_MODEL || 'nova-3';
const DEEPGRAM_TTS_MODEL = process.env.DEEPGRAM_TTS_MODEL || 'aura-2-thalia-en';
// Model + reasoning effort are chosen here, in code — not in .env.
const OPENAI_MODEL = 'gpt-5.6-luna';
const OPENAI_REASONING_EFFORT = 'medium';

// Replies are spoken aloud by TTS, so ask for short, plain, conversational prose.
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'You are a helpful, friendly voice assistant. Your replies are read aloud by ' +
  'a text-to-speech engine, so keep them short and conversational (1-3 ' +
  'sentences). Use plain prose: no markdown, bullet lists, emoji, or code ' +
  'blocks. Answer the question directly; if you are unsure, say so briefly.';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function sendJson(res, status, obj, cors = false) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  };
  // Opt-in rather than blanket: only the call endpoints are reached from the
  // dashboard's origin, and the rest have no business being callable from a
  // page the user happens to have open.
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    });
    res.end(data);
  });
}

async function handleHealth(req, res) {
  sendJson(res, 200, {
    deepgram: Boolean(DEEPGRAM_API_KEY),
    openai: Boolean(OPENAI_API_KEY),
    sttModel: DEEPGRAM_STT_MODEL,
    ttsModel: DEEPGRAM_TTS_MODEL,
    chatModel: OPENAI_MODEL,
    reasoningEffort: OPENAI_REASONING_EFFORT,
    systemPrompt: SYSTEM_PROMPT,
    brain: true,
  });
}

// ---- query-param plumbing (allow-list; nothing arbitrary is forwarded) ----
const STT_PARAMS = [
  'model', 'language', 'smart_format', 'punctuate', 'diarize', 'diarize_model', 'numerals',
  'profanity_filter', 'redact', 'keywords', 'keyterm', 'search', 'replace', 'endpointing',
  'interim_results', 'vad_events', 'utterance_end_ms', 'encoding', 'sample_rate', 'channels',
  'multichannel', 'dictation', 'detect_entities', 'tag', 'version', 'mip_opt_out',
];
const TTS_PARAMS = ['model', 'encoding', 'container', 'sample_rate', 'bit_rate', 'speed', 'mip_opt_out'];

function applyAllowed(src, dest, allow) {
  for (const key of allow) {
    const values = src.getAll(key);
    for (const v of values) dest.append(key, v);
  }
}

async function handleTranscribe(req, res) {
  if (!DEEPGRAM_API_KEY) {
    sendJson(res, 500, { error: 'DEEPGRAM_API_KEY is not set (add it to the repo-root .env).' });
    return;
  }
  const { searchParams } = new URL(req.url, 'http://localhost');
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
  const body = await readBody(req);

  // Defaults, overridable by allow-listed query params.
  const params = new URLSearchParams();
  applyAllowed(searchParams, params, STT_PARAMS);
  if (!params.has('model')) params.set('model', DEEPGRAM_STT_MODEL);

  // LOCAL-AI HOOK (STT). To use the local Parakeet-unified-en-0.6B server in
  // ../local-ai/stt instead of Deepgram, replace the two
  // `https://api.deepgram.com/v1/listen?...` URLs below with
  // `${process.env.LOCAL_STT_URL || 'http://127.0.0.1:5001'}/api/transcribe`
  // and drop the `Authorization: Token ...` header. The local server accepts the
  // same raw-audio and {url} bodies and returns {transcript, raw}. See
  // local-ai/README.md §"Use it from the voice app". Live /ws/listen stays on
  // Deepgram (Parakeet's streaming path is not proxied yet).
  let dgRes;
  if (contentType.startsWith('application/json')) {
    // Transcribe a remote file by URL.
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8') || '{}');
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body.' });
      return;
    }
    if (!payload.url) {
      sendJson(res, 400, { error: 'Missing "url".' });
      return;
    }
    dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: payload.url }),
    });
  } else {
    if (!body.length) {
      sendJson(res, 400, { error: 'Empty audio body.' });
      return;
    }
    dgRes = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': contentType || 'audio/webm',
      },
      body,
    });
  }

  const data = await dgRes.json().catch(() => ({}));
  if (!dgRes.ok) {
    sendJson(res, dgRes.status, { error: data || `Deepgram error ${dgRes.status}` });
    return;
  }

  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  sendJson(res, 200, { transcript, params: Object.fromEntries(params), raw: data });
}

async function handleTts(req, res) {
  if (!DEEPGRAM_API_KEY) {
    sendJson(res, 500, { error: 'DEEPGRAM_API_KEY is not set (add it to the repo-root .env).' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  const text = String(payload.text || '').slice(0, 2000); // Aura limit is 2000 chars
  if (!text) {
    sendJson(res, 400, { error: 'Missing "text".' });
    return;
  }

  const { searchParams } = new URL(req.url, 'http://localhost');
  const params = new URLSearchParams();
  applyAllowed(searchParams, params, TTS_PARAMS);
  if (!params.has('model')) params.set('model', DEEPGRAM_TTS_MODEL);

  // LOCAL-AI HOOK (TTS). To use the local Qwen3-TTS-12Hz-0.6B server in
  // ../local-ai/tts instead of Deepgram, replace the next line with
  //   const url = `${process.env.LOCAL_TTS_URL || 'http://127.0.0.1:5002'}/api/tts?${params}`;
  // and drop the `Authorization: Token ...` header below. The local server takes
  // the same {text} body and returns audio/wav. Deepgram-only query params
  // (model, encoding, container, ...) are ignored. See local-ai/README.md.
  const url = `https://api.deepgram.com/v1/speak?${params}`;
  const dgRes = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!dgRes.ok) {
    const detail = await dgRes.text().catch(() => '');
    sendJson(res, dgRes.status, { error: detail || `Deepgram error ${dgRes.status}` });
    return;
  }

  const audio = Buffer.from(await dgRes.arrayBuffer());
  res.writeHead(200, {
    'Content-Type': dgRes.headers.get('content-type') || 'audio/mpeg',
    'Content-Length': audio.length,
  });
  res.end(audio);
}

async function handleChat(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, { error: 'OPENAI_API_KEY is not set (add it to the repo-root .env).' });
    return;
  }
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  const incoming = Array.isArray(payload.messages) ? payload.messages : [];
  if (!incoming.length) {
    sendJson(res, 400, { error: 'Missing "messages".' });
    return;
  }
  // Prepend the voice-friendly system prompt unless the client already sent one.
  const messages = incoming.some((m) => m.role === 'system')
    ? incoming
    : [{ role: 'system', content: SYSTEM_PROMPT }, ...incoming];

  const oaRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: payload.model || OPENAI_MODEL,
      reasoning_effort: payload.reasoningEffort || OPENAI_REASONING_EFFORT,
      messages,
    }),
  });

  const data = await oaRes.json().catch(() => ({}));
  if (!oaRes.ok) {
    sendJson(res, oaRes.status, { error: data || `OpenAI error ${oaRes.status}` });
    return;
  }
  const reply = data?.choices?.[0]?.message?.content || '';
  sendJson(res, 200, { reply, model: data?.model || OPENAI_MODEL });
}

// ---- Deepgram temporary token (for secure browser live STT) ----
async function handleGrantToken(req, res) {
  if (!DEEPGRAM_API_KEY) {
    sendJson(res, 500, { error: 'DEEPGRAM_API_KEY is not set.' });
    return;
  }
  let ttl = 60;
  try {
    const p = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (p.ttl_seconds) ttl = Math.min(Math.max(Number(p.ttl_seconds) || 60, 1), 3600);
  } catch {
    /* default ttl */
  }
  const dgRes = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: ttl }),
  });
  const data = await dgRes.json().catch(() => ({}));
  if (!dgRes.ok) {
    sendJson(res, dgRes.status, { error: data });
    return;
  }
  sendJson(res, 200, data);
}

// ---- Brain (two-agent product) ----
async function handlePatients(req, res) {
  sendJson(res, 200, { patients: brain.listPatients() });
}

async function handleBrainSession(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  const subjectId = String(payload.subjectId || '');
  if (!subjectId) {
    sendJson(res, 400, { error: 'Missing "subjectId".' });
    return;
  }
  const session = brain.startSession(subjectId);
  logger.append(session.session_id, 'session.start', {
    subjectId,
    studyId: session.study_id ?? null,
  });

  // The agent opens, but not here: the client's first streamed turn carries
  // `opening: true`, which greets AND streams. Greeting here as well would
  // leave a saved agent utterance behind, and brain.handleTurn's isOpening
  // guard (conversation must be empty) would then swallow the spoken one —
  // so the participant would hear nothing at all.
  sendJson(res, 200, { sessionId: session.session_id, subjectId });
}

/** The full record — every tool call with args and result — goes to the offline log. */
function logTurn(sessionId, subjectId, text, result) {
  logger.append(sessionId, 'turn', {
    subjectId,
    userText: String(text || ''),
    say: result.say,
    toolCalls: result.toolCalls,
    model: result.model,
    latencyMs: result.latencyMs,
    firstChunkMs: result.firstChunkMs,
    planning: result.planning,
    state: result.state,
  });
}

async function readTurnPayload(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return null;
  }
  if (!payload.sessionId || !payload.subjectId) {
    sendJson(res, 400, { error: 'Missing "sessionId" or "subjectId".' });
    return null;
  }
  return payload;
}

async function handleBrainTurn(req, res) {
  const payload = await readTurnPayload(req, res);
  if (!payload) return;
  const { sessionId, subjectId, text, source } = payload;
  const result = await brain.handleTurn({ sessionId, subjectId, userText: String(text || ''), source });
  // The browser only gets the tool names.
  logTurn(sessionId, subjectId, text, result);
  sendJson(res, 200, {
    say: result.say,
    state: result.state,
    model: result.model,
    sessionId: result.sessionId,
    planning: result.planning,
    latencyMs: result.latencyMs,
    toolCalls: (result.toolCalls || []).map((t) => t.name),
  });
}

/**
 * Streaming turn: newline-delimited JSON. `{type:'say', text}` for each short
 * chunk of speech as soon as it is ready, `{type:'wait'}` when the agent is
 * about to wait on a lookup before it has said anything, then one
 * `{type:'done', ...}` (or `{type:'error'}`). The browser speaks each chunk while the rest is still
 * being written.
 */
async function handleBrainTurnStream(req, res) {
  const payload = await readTurnPayload(req, res);
  if (!payload) return;
  const { sessionId, subjectId, text, source } = payload;

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  req.socket?.setNoDelay?.(true);
  const send = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
  };

  try {
    const result = await brain.handleTurn({
      sessionId,
      subjectId,
      userText: String(text || ''),
      onEvent: send,
      opening: Boolean(payload.opening),
      source,
    });
    logTurn(sessionId, subjectId, text, result);
    send({
      type: 'done',
      say: result.say,
      model: result.model,
      sessionId: result.sessionId,
      planning: result.planning,
      latencyMs: result.latencyMs,
      firstChunkMs: result.firstChunkMs,
      toolCalls: (result.toolCalls || []).map((t) => t.name),
    });
  } catch (err) {
    console.error(err);
    logger.appendError({ path: '/api/brain/turn/stream', error: String(err?.message || err) });
    send({ type: 'error', error: String(err?.message || err) });
  }
  res.end();
}

async function handleBrainEnd(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  const { sessionId } = payload;
  if (!sessionId) {
    sendJson(res, 400, { error: 'Missing "sessionId".' });
    return;
  }
  // Hand the call's staged changes and identity result to the review queue.
  // Best effort: a failed publish must not fail a call that is already over.
  let published = null;
  try {
    // The planner runs in the background, so the last thing said on a call is
    // often still being written when the call ends. Publishing straight away
    // raced it and handed the coordinator an empty review queue for a call
    // that had just surfaced a new medication. Let it finish first.
    await brain.waitForIdle(sessionId);
    published = await require('./brain/bridge').publishSession(sessionId);
  } catch (err) {
    published = { published: false, reason: String(err.message || err) };
  }
  brain.endSession(sessionId);
  logger.append(sessionId, 'session.end', { published });
  sendJson(res, 200, { ok: true, sessionId, published });
}

async function handleChannel(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  const { sessionId, state } = payload;
  if (!sessionId) {
    sendJson(res, 400, { error: 'Missing "sessionId".' });
    return;
  }
  sendJson(res, 200, brain.setChannel(sessionId, state));
  logger.append(sessionId, 'channel', { state: String(state || '') });
}

/** Download a session's offline log (voice/logs/<sessionId>.jsonl). */
async function handleBrainLog(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    sendJson(res, 400, { error: 'Missing "sessionId".' });
    return;
  }
  const log = logger.readLog(sessionId);
  const name = logger.fileFor?.(sessionId) ? sessionId : 'session';
  const body = log || '';
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Content-Disposition': `attachment; filename="${name}.jsonl"`,
  });
  res.end(body);
}

async function handleBrainDebug(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    sendJson(res, 400, { error: 'Missing "sessionId".' });
    return;
  }
  sendJson(res, 200, brain.debug(sessionId));
}

async function handleBrainState(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost');
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    sendJson(res, 400, { error: 'Missing "sessionId".' });
    return;
  }
  sendJson(res, 200, {
    state: brain.getState(sessionId),
    planner: brain.plannerStatus(sessionId),
  });
}

// ---------------------------------------------------------------------------
// Calling
//
// The dashboard rings a participant; a handset somewhere answers. With the
// simulated provider the handset is this same web app open on a phone, and
// the ring arrives over the server-sent event stream below.
// ---------------------------------------------------------------------------

/** The number on file for a participant. Loose format; telephony normalises. */
function phoneFor(subjectId) {
  try {
    const row = patient().get('SELECT phone FROM patients WHERE subject_id = ?', subjectId);
    return row?.phone || null;
  } catch {
    return null;
  }
}

async function handleCallPlace(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body.' }, true);
    return;
  }
  const { subjectId, to, placedBy } = payload;
  const number = to || (subjectId ? phoneFor(subjectId) : null);
  if (!number) {
    sendJson(res, 400, { error: `No number on file for "${subjectId}".` }, true);
    return;
  }
  const call = await calls.place({ subjectId, to: number, placedBy });
  logger.append(call.callId, 'call.place', call);
  // A refused call is a 200 with ok:false — the request was understood, the
  // call was not placed, and the reason is the useful part.
  sendJson(res, 200, { ok: call.status !== 'failed', call }, true);
}

/**
 * A handset waiting to be rung.
 *
 * Server-sent events rather than polling: a ring has to feel immediate, and
 * SSE reconnects on its own when a phone's network drops, which polling loops
 * have to reimplement badly.
 */
function handleCallStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: 'ready', at: new Date().toISOString() });

  const unsubscribe = calls.subscribe(send);
  // Comment frames keep proxies (and ngrok) from closing an idle stream.
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}

async function handleCallAction(req, res, callId, action) {
  let payload = {};
  if (req.method === 'POST') {
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      payload = {};
    }
  }
  const fn = { answer: calls.answer, decline: calls.decline, end: calls.end }[action];
  const call = fn(callId, payload);
  if (!call) {
    sendJson(res, 404, { error: 'Unknown call.' }, true);
    return;
  }
  logger.append(callId, `call.${action}`, call);
  sendJson(res, 200, { ok: true, call }, true);
}

// ---------------------------------------------------------------------------
// Live call stream
//
// The coordinator watches a call happen. Two things come down this stream and
// nothing else: the conversation, and every change the agent has staged against
// the participant's record. Not the planner's internals — a coordinator reading
// a live call needs to see what was said and what it changed, not how the model
// arrived at it.
//
// The brain already writes every turn to `utterances` and every proposal to the
// staged_* tables as the call runs, so this is a reader over that, diffed and
// pushed. It is deliberately a poll inside an SSE frame rather than hooks in the
// brain: the brain has one job (talking to the participant) and should not grow
// a second one (notifying dashboards).
// ---------------------------------------------------------------------------

/** Turns after `sinceSeq`, oldest first. `patient` speaker -> `participant`. */
function liveTurns(sessionId, sinceSeq) {
  const rows =
    patient().query(
      'SELECT seq, speaker, transcript FROM utterances WHERE session_id = ? AND seq > ? ORDER BY seq',
      sessionId,
      sinceSeq
    ) || [];
  return rows.map((r) => ({
    seq: r.seq,
    speaker: r.speaker === 'patient' ? 'participant' : 'agent',
    text: r.transcript,
  }));
}

/**
 * Every modification the agent has staged, in a shape a coordinator can read as
 * a changelog. `action` is the verb: add, stop, modify, or record.
 */
function liveModifications(sessionId) {
  const p = patient();
  const out = [];

  const staged = p.query('SELECT * FROM staged_changes WHERE session_id = ? ORDER BY staged_id', sessionId) || [];
  for (const r of staged) {
    out.push({
      key: `med:${r.staged_id}`,
      kind: 'medication',
      action: r.change_type || 'add',
      name: r.canonical_name || r.reported_text || 'Unresolved',
      detail: [r.dose, r.frequency].filter(Boolean).join(' · ') || null,
      reportedText: r.reported_text || null,
      unresolved: !r.rxcui,
    });
  }

  const adherence = p.query('SELECT * FROM staged_adherence WHERE session_id = ? ORDER BY staged_adherence_id', sessionId) || [];
  for (const r of adherence) {
    out.push({
      key: `adh:${r.staged_adherence_id}`,
      kind: 'adherence',
      action: 'record',
      name: r.canonical_name || r.reported_text || 'Adherence',
      detail:
        r.extent === 'missed' && r.days_missed != null
          ? `${r.days_missed} of ${r.recall_days ?? 7} days missed`
          : r.extent || null,
      reportedText: r.reported_text || null,
    });
  }

  const behaviours = p.query('SELECT * FROM staged_behaviours WHERE session_id = ? ORDER BY staged_behaviour_id', sessionId) || [];
  for (const r of behaviours) {
    out.push({
      key: `beh:${r.staged_behaviour_id}`,
      kind: 'behaviour',
      action: 'record',
      name: r.behaviour_code,
      detail: r.status || null,
      reportedText: r.reported_text || null,
    });
  }

  const symptoms = p.query('SELECT * FROM staged_symptoms WHERE session_id = ? ORDER BY staged_symptom_id', sessionId) || [];
  for (const r of symptoms) {
    out.push({
      key: `sym:${r.staged_symptom_id}`,
      kind: 'symptom',
      action: 'record',
      name: r.symptom || r.canonical_name || 'Symptom',
      detail: r.severity || null,
      reportedText: r.reported_text || null,
    });
  }

  return out;
}

/** The session row, reduced to what the coordinator's header needs. */
function liveSession(sessionId) {
  const row = patient().get(
    `SELECT session_id, subject_id, study_id, status, identity_status, outcome, started_at, ended_at
       FROM call_sessions WHERE session_id = ?`,
    sessionId
  );
  if (!row) return null;
  return {
    subjectId: row.subject_id,
    studyId: row.study_id,
    status: row.status,
    identityStatus: row.identity_status,
    outcome: row.outcome,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

/**
 * GET /api/brain/live?sessionId=…  (server-sent events)
 *
 * Emits `session` (status changes), `turn` (each new utterance, in order), and
 * `modification` (each staged change, re-emitted when it changes). A client can
 * drop and reconnect: the first `session` and the replay of current turns and
 * modifications make the stream self-describing from any point.
 */
function handleBrainLive(req, res) {
  const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  if (!sessionId) {
    send({ type: 'error', error: 'missing sessionId' });
    res.end();
    return;
  }

  send({ type: 'ready', at: new Date().toISOString() });

  let lastSeq = 0;
  const sentMods = new Map();
  let lastSessionSig = null;

  const tick = () => {
    try {
      const session = liveSession(sessionId);
      if (session) {
        const sig = `${session.status}|${session.identityStatus}|${session.outcome}|${session.endedAt}`;
        if (sig !== lastSessionSig) {
          lastSessionSig = sig;
          send({ type: 'session', session });
        }
      }
      for (const turn of liveTurns(sessionId, lastSeq)) {
        lastSeq = turn.seq;
        send({ type: 'turn', turn: { speaker: turn.speaker, text: turn.text } });
      }
      for (const mod of liveModifications(sessionId)) {
        const json = JSON.stringify(mod);
        if (sentMods.get(mod.key) !== json) {
          sentMods.set(mod.key, json);
          send({ type: 'modification', modification: mod });
        }
      }
    } catch (err) {
      send({ type: 'error', error: String((err && err.message) || err) });
    }
  };

  tick();
  const poll = setInterval(tick, 800);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(poll);
    clearInterval(keepAlive);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/health') return await handleHealth(req, res);
    if (pathname === '/api/deepgram/token' && req.method === 'POST') return await handleGrantToken(req, res);
    if (pathname === '/api/transcribe' && req.method === 'POST') return await handleTranscribe(req, res);
    if (pathname === '/api/tts' && req.method === 'POST') return await handleTts(req, res);
    if (pathname === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
    if (pathname === '/api/patients' && req.method === 'GET') return await handlePatients(req, res);
    if (pathname === '/api/brain/session' && req.method === 'POST') return await handleBrainSession(req, res);
    if (pathname === '/api/brain/turn/stream' && req.method === 'POST') return await handleBrainTurnStream(req, res);
    if (pathname === '/api/brain/turn' && req.method === 'POST') return await handleBrainTurn(req, res);
    if (pathname === '/api/brain/end' && req.method === 'POST') return await handleBrainEnd(req, res);
    if (pathname === '/api/brain/channel' && req.method === 'POST') return await handleChannel(req, res);
    if (pathname === '/api/brain/state' && req.method === 'GET') return await handleBrainState(req, res);
    if (pathname === '/api/brain/debug' && req.method === 'GET') return await handleBrainDebug(req, res);
    if (pathname === '/api/brain/log' && req.method === 'GET') return await handleBrainLog(req, res);
    if (pathname === '/api/brain/live' && req.method === 'GET') return handleBrainLive(req, res);

    // The dashboard lives on another origin, so these need preflight.
    if (pathname.startsWith('/api/calls') && req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    if (pathname === '/api/calls/stream' && req.method === 'GET') return handleCallStream(req, res);
    if (pathname === '/api/calls' && req.method === 'POST') return await handleCallPlace(req, res);
    if (pathname === '/api/calls' && req.method === 'GET') {
      return sendJson(res, 200, { calls: calls.list(), telephony: telephony.describe() }, true);
    }
    if (pathname === '/api/telephony' && req.method === 'GET') {
      return sendJson(res, 200, telephony.describe(), true);
    }
    {
      const m = /^\/api\/calls\/([^/]+)\/(answer|decline|end)$/.exec(pathname);
      if (m) return await handleCallAction(req, res, m[1], m[2]);
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Unknown API route.' });
      return;
    }
    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    logger.appendError({
      path: (() => { try { return new URL(req.url, 'http://localhost').pathname; } catch { return '?'; } })(),
      error: String(err?.message || err),
    });
    if (!res.headersSent) sendJson(res, 500, { error: String(err?.message || err) });
    else res.end();
  }
});

// ---- live STT WebSocket proxy (/ws/listen -> Deepgram) ----
function handleLiveProxy(client, searchParams) {
  const params = new URLSearchParams();
  applyAllowed(searchParams, params, STT_PARAMS);
  if (!params.has('model')) params.set('model', DEEPGRAM_STT_MODEL);

  const dg = new WS.WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
  });
  const pending = [];
  const OPEN = 1;
  const CONNECTING = 0;

  // Deepgram closes a socket that has received no audio for ~10 s. The handset
  // sends none while the agent is speaking, so a long reply used to drop the
  // connection mid-call. KeepAlive is a control frame and costs nothing.
  let keepAlive = null;
  dg.on('open', () => {
    while (pending.length) dg.send(pending.shift());
    keepAlive = setInterval(() => {
      if (dg.readyState === OPEN) dg.send(JSON.stringify({ type: 'KeepAlive' }));
    }, 5000);
  });
  dg.on('message', (data, isBinary) => {
    if (client.readyState === OPEN) client.send(data, { binary: isBinary });
  });
  dg.on('close', (code, reason) => {
    clearInterval(keepAlive);
    console.log(`[stt] deepgram closed: ${code} ${reason ? reason.toString() : ''}`);
    try { client.close(code, reason ? reason.toString() : undefined); } catch {}
  });
  dg.on('error', (err) => {
    try { client.send(JSON.stringify({ type: 'ProxyError', message: err.message })); } catch {}
    try { client.close(); } catch {}
  });
  client.on('message', (data, isBinary) => {
    if (dg.readyState === OPEN) dg.send(data, { binary: isBinary });
    else if (dg.readyState === CONNECTING) pending.push(data);
  });
  client.on('close', () => { clearInterval(keepAlive); try { dg.close(); } catch {} });
  client.on('error', () => { clearInterval(keepAlive); try { dg.close(); } catch {} });
}

if (WS) {
  const wss = new WS.WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== '/ws/listen' || !DEEPGRAM_API_KEY) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => handleLiveProxy(client, url.searchParams));
  });
}

server.listen(PORT, () => {
  console.log(`voice test UI  →  http://localhost:${PORT}`);
  console.log(`  Deepgram key: ${DEEPGRAM_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`  OpenAI key:   ${OPENAI_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`  STT model:    ${DEEPGRAM_STT_MODEL}`);
  console.log(`  TTS model:    ${DEEPGRAM_TTS_MODEL}`);
  console.log(`  Chat model:   ${OPENAI_MODEL} (reasoning: ${OPENAI_REASONING_EFFORT})`);
  console.log('  Brain:        enabled (/api/brain/*)');
  console.log(`  Live STT:     ${WS ? 'enabled (/ws/listen)' : 'disabled (run `npm install` in voice/)'}`);
});
