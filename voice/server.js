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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
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
  const { sessionId, subjectId, text } = payload;
  const result = await brain.handleTurn({ sessionId, subjectId, userText: String(text || '') });
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
 * Streaming turn: newline-delimited JSON. `{type:'say', text, filler}` for each
 * short chunk of speech as soon as it is ready, then one `{type:'done', ...}`
 * (or `{type:'error'}`). The browser speaks each chunk while the rest is still
 * being written.
 */
async function handleBrainTurnStream(req, res) {
  const payload = await readTurnPayload(req, res);
  if (!payload) return;
  const { sessionId, subjectId, text } = payload;

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
    const result = await brain.handleTurn({ sessionId, subjectId, userText: String(text || ''), onEvent: send });
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
    published = await require('./brain/bridge').publishSession(sessionId);
  } catch (err) {
    published = { published: false, reason: String(err.message || err) };
  }
  brain.endSession(sessionId);
  logger.append(sessionId, 'session.end', {});
  sendJson(res, 200, { ok: true, sessionId });
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

  dg.on('open', () => {
    while (pending.length) dg.send(pending.shift());
  });
  dg.on('message', (data, isBinary) => {
    if (client.readyState === OPEN) client.send(data, { binary: isBinary });
  });
  dg.on('close', (code, reason) => {
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
  client.on('close', () => { try { dg.close(); } catch {} });
  client.on('error', () => { try { dg.close(); } catch {} });
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
