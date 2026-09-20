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
//
// LOCAL-LLM HOOK. Default is the hosted GPT-5.6 Luna. To run the brain on the
// local Gemma 4 E4B Q4 model instead (see ../../local-ai/llm/, one command:
// `./run_server.sh`), change this to the alias the server advertises:
//
//   const MODEL = 'gemma-4-e4b';
//
// and point the client at the local server in lib/openai.js. Two differences to
// remember: a local server needs no API key, and it has no `reasoning_effort` —
// set talkerEffort/plannerEffort to null below, because llama.cpp has no such
// field and Chat Completions tools + effort is an OpenAI-only combination.
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

  // Follow-up questions ("has it been working?", "any side effects?"): asking
  // them of every medicine sounds like a form. At most this many *optional* ones
  // per call; the "why did you stop it?" kind is not counted against this.
  maxFollowups: 3,
  plannerDebounceMs: 250,
};
