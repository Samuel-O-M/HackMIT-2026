'use strict';

/** OpenAI Chat Completions helper, with a tool-calling loop. */

const config = require('../config');

// This host has IPv6 addresses but no public IPv6 route (Tailscale ULA only),
// yet DNS returns AAAA records. Prefer IPv4 so Node's Happy-Eyeballs doesn't
// waste attempts on unreachable IPv6 endpoints.
const dns = require('node:dns');
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* older node */
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with a hard timeout and retries on network errors / 5xx / 429. */
async function fetchWithRetry(url, options, { retries = 3, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function request(messages, { model, effort, json, tools, stream }) {
  const body = { model, messages };
  if (stream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }
  if (effort) body.reasoning_effort = effort;
  // response_format and tools don't mix well; only use JSON mode without tools.
  if (json && !(tools && tools.length)) body.response_format = { type: 'json_object' };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  // For a local OpenAI-compatible server (e.g. llama.cpp + Gemma 4 E4B): point
  // the URL below at `${OPENAI_BASE_URL || 'http://127.0.0.1:5003/v1'}` and drop
  // the Authorization header; set the efforts to null in config.js. See
  // ../../local-ai/llm/.
  return fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function parseOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI error ${res.status}`);
  }
  return data;
}

/** Plain completion. */
async function chat(messages, opts = {}) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is not set (repo-root .env).');
  const { model = config.plannerModel, effort, json = false } = opts;
  let res = await request(messages, { model, effort, json });
  if (!res.ok && json) res = await request(messages, { model, effort, json: false });
  const data = await parseOrThrow(res);
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    model: data?.model || model,
    usage: data?.usage || {},
  };
}

/**
 * Completion with tools. Executes tool calls via `execute(name, args)` and
 * loops until the model answers without calling a tool (or maxRounds is hit).
 * Tool results are truncated so we never pass huge payloads between agents.
 *
 * @returns {Promise<{text:string, model:string, toolCalls:Array, usage:object}>}
 */
async function chatWithTools({ messages, tools, model, effort, maxRounds = 4, execute }) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is not set (repo-root .env).');
  const toolCalls = [];
  // Chat Completions forbids function tools together with reasoning_effort
  // (Luna: "use /v1/responses or set reasoning_effort to 'none'"). Tools win.
  const eff = tools && tools.length ? 'none' : effort;

  for (let round = 0; round <= maxRounds; round++) {
    const res = await request(messages, { model, effort: eff, tools });
    const data = await parseOrThrow(res);
    const msg = data?.choices?.[0]?.message || {};
    messages.push(msg);

    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { text: msg.content || '', model: data?.model || model, toolCalls, usage: data?.usage || {} };
    }

    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = { _parse_error: call.function?.arguments };
      }
      const result = execute ? await execute(call.function?.name, args) : { error: 'no executor' };
      toolCalls.push({ name: call.function?.name, args, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
  }

  // Out of rounds: make one final, tool-free call to get an answer.
  const res = await request(messages, { model, effort });  const data = await parseOrThrow(res);
  return {
    text: data?.choices?.[0]?.message?.content || '',
    model: data?.model || model,
    toolCalls,
    usage: data?.usage || {},
  };
}

/**
 * Read one streamed chat completion. Text deltas go to `onText` as they
 * arrive; tool calls are assembled from their fragments. `onToolStart` fires
 * once, the moment the model begins asking for a tool.
 */
async function readCompletionStream(res, { onText, onToolStart }) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let modelName = null;
  let usage = {};
  let toolStarted = false;
  const calls = [];

  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    modelName = chunk.model || modelName;
    if (chunk.usage) usage = chunk.usage;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;
    if (delta.content) {
      content += delta.content;
      onText?.(delta.content);
    }
    for (const t of delta.tool_calls || []) {
      const c = (calls[t.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (t.id) c.id = t.id;
      if (t.function?.name) c.function.name += t.function.name;
      if (t.function?.arguments) c.function.arguments += t.function.arguments;
      if (!toolStarted) {
        toolStarted = true;
        onToolStart?.();
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) handle(line);
  }
  if (pending) handle(pending);
  return { content, calls: calls.filter(Boolean), model: modelName, usage };
}

/**
 * Streaming twin of chatWithTools. Same tool loop, but text is pushed to
 * `onText` token by token so the caller can start speaking before the model
 * has finished, and `onToolStart` fires when a tool round begins.
 */
async function chatWithToolsStream({ messages, tools, model, effort, maxRounds = 4, execute, onText, onToolStart }) {
  if (!config.openaiKey) throw new Error('OPENAI_API_KEY is not set (repo-root .env).');
  const toolCalls = [];
  const eff = tools && tools.length ? 'none' : effort;
  let spoken = '';
  const collect = (d) => {
    spoken += d;
    onText?.(d);
  };

  for (let round = 0; round <= maxRounds; round++) {
    const withTools = round < maxRounds;
    const res = await request(messages, { model, effort: withTools ? eff : effort, tools: withTools ? tools : undefined, stream: true });
    if (!res.ok) await parseOrThrow(res); // throws with the API's message
    const out = await readCompletionStream(res, {
      onText: collect,
      onToolStart: () => onToolStart?.({ spokenSoFar: spoken }),
    });
    messages.push({ role: 'assistant', content: out.content || null, ...(out.calls.length ? { tool_calls: out.calls } : {}) });

    if (!out.calls.length) return { text: spoken, model: out.model || model, toolCalls, usage: out.usage };

    for (const call of out.calls) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = { _parse_error: call.function?.arguments };
      }
      const result = execute ? await execute(call.function?.name, args) : { error: 'no executor' };
      toolCalls.push({ name: call.function?.name, args, result });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
    }

    // A tool round ends with the model's draft already in the transcript as its
    // own message. Left alone, the next round re-answers from scratch and says
    // the same words again — the participant hears every sentence twice. Tell it
    // to continue instead. Re-added after EVERY round, not just the first: a
    // turn can chain several tools, and only the first round was covered.
    if (spoken.trim()) {
      messages.push({
        role: 'user',
        content:
          'Everything you have written so far was already spoken aloud to the participant. ' +
          'Do not repeat any of it. Continue from exactly where you stopped, adding only what is new.',
      });
    }
  }
  return { text: spoken, model, toolCalls, usage: {} };
}

/** Extract the first JSON object from a string (tolerates fences/prose). */
function parseJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Model did not return valid JSON.');
  }
}

module.exports = { chat, chatWithTools, chatWithToolsStream, parseJson };
