'use strict';

/**
 * Brain configuration.
 *
 * API keys come from the repo-root .env (../.env).
 * Model + reasoning-effort choices are made HERE, in code — not in .env.
 */

const fs = require('node:fs');
const path = require('node:path');

(function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

// ---------------------------------------------------------------------------
// Model + effort choices (edit here, not in .env)
// ---------------------------------------------------------------------------
// To run on a local model instead of Luna: set MODEL = 'gemma-4-e4b' (see
// ../../local-ai/llm/), point lib/openai.js at the local server, and set the
// efforts below to null — llama.cpp has no reasoning_effort.
const MODEL = 'gpt-5.6-luna';

module.exports = {
  openaiKey: process.env.OPENAI_API_KEY,

  // Fast talker: realtime. Chat Completions requires reasoning_effort 'none'
  // when function tools are attached, and the talker always has tools.
  talkerModel: MODEL,
  talkerEffort: 'none',

  // Slower planner: deeper reasoning (runs as two tool-free reasoning passes).
  plannerModel: MODEL,
  plannerEffort: 'medium',

  // Loop limits
  maxToolRounds: 4,
  historyTurns: 20,
  plannerDebounceMs: 250,
};
