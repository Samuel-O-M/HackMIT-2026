# The Brain — Talker + Planner

A single-instance orchestrator running a **fast realtime Talker** and a
**slower background Thinker/Planner**.

```
                         HEALTH KNOWLEDGE DB  (read only)
                                  |
                                  v
 User audio -> STT -> Conversational Agent (Talker) -> TTS -> User
                       |        ^
                       |        |  latest planner state
                       |        |
                       |   tools: health_search() · patient_read() · patient_update()
                       v
                  Thinker / Planner   (async, between turns)
                       |-- extract important facts
                       |-- determine missing information
                       |-- decide useful future questions
                       |-- retrieve relevant context
                       |-- update patient / session memory
                       v
                    PATIENT DB  (read + controlled write)
```

## The key decoupling

- `handleTurn()` runs **only the Talker** and returns immediately. It surfaces
  `planning: true` but never waits.
- `schedulePlan()` runs the **Planer** asynchronously. Bursts collapse: one run
  at a time, with a dirty flag triggering a single re-run.
- The Talker always reads the **latest available** planner state, and may call
  tools directly for anything immediately needed.

## Agents

| Agent | File | Prompt | Effort | Tools |
|-------|------|--------|--------|-------|
| **Talker** | `agents/talker.js` | `prompts/talker.md` | `none` (tools require it) | health_search, patient_read, patient_update |
| **Planner** | `agents/thinker.js` | `prompts/thinker.md` | medium | read-only (two reasoning passes) |

The Talker returns **only** the words to say out loud.

### Why the planner is two-phase
Chat Completions rejects `reasoning_effort` together with function tools
("use /v1/responses or set reasoning_effort to 'none'"). So the Planner:
1. **Phase 1** — reasons about what to retrieve (no tools).
2. The orchestrator executes those read-only lookups.
3. **Phase 2** — reasons again over the results and emits the final state.

This keeps full reasoning **and** grounded retrieval, without tools.

## Planner state

```json
{
  "goal": "...",
  "known":   [{ "fact": "...", "source": "patient|patient_db|health_kb" }],
  "missing": ["..."],
  "next_questions": ["..."],
  "retrieval": ["..."],
  "to_save": [{ "op": "add_medication_change", "payload": { ... } }],
  "flags":   [{ "type": "prohibited", "detail": "...", "protocol_section": "6.5" }],
  "summary": "..."
}
```

Persisted per session in `planner_state`, so a future instance resumes.

## Tools (`tools/`)

| Tool | Access | Notes |
|------|--------|-------|
| `health_search(query)` | **read-only** | Drug/brand/class lookup via the shared `drugdb` (RxNorm + RxClass), plus plain-language guidance. The *only* source of medical facts. |
| `check_prohibited(rxcui)` | read | Does a resolved drug trip this participant's protocol rules? Membership only; dose/timing limits are still the agent's to compare. |
| `patient_read(scope, limit?)` | read | scoped slices only: profile, enrollment, medications, protocol_rules, planner_state, transcript, advice |
| `patient_update(op, payload)` | controlled write | named ops only: `add_medication_change`, `add_advice`, `set_planner_state` |

No arbitrary SQL is exposed to the agents, and reads never return a full record.

## Grounding — no hallucination

Both prompts restrict medical claims to: (1) what the participant said,
(2) `patient_read` output, (3) `health_search` output. If a lookup returns
nothing, the model must record it as missing rather than guess. See
`prompts/thinker.md` for the full rule and the schema-is-not-final disclaimer.

## Databases

| DB | File | Access |
|----|------|--------|
| Health knowledge | `db/general_health.db` | **read-only** (opened `readOnly`, SELECT-only, no write method). General guidance only. |
| Patient / clinical | `db/patient.db` | **read + controlled write** |

Generated, not committed. Reset with `node db/seed.js`.
Drug and class facts are not in these files: they come from `../../drugdb`
(real RxNorm / RxClass, cached locally; see its README).

## Run

```bash
node db/seed.js
node cli.js 0412                 # interactive; shows talker reply + planner state
node cli.js 0412 "hello"         # one turn
```

Server API (`voice/server.js`): `GET /api/patients`, `POST /api/brain/session`,
`POST /api/brain/turn` → `{say, state, planning}`, `GET /api/brain/state?sessionId=`
→ `{state, planner}`.

## Config

API keys live in the repo-root `.env`. **Model and reasoning-effort choices are
made in code**, not `.env`:

```js
// brain/config.js
const MODEL = 'gpt-5.6-luna';
module.exports = {
  talkerModel: MODEL,  talkerEffort: 'none',    // realtime, tools attached
  plannerModel: MODEL, plannerEffort: 'medium', // deeper, two passes
  maxToolRounds: 4,
  historyTurns: 20,
  plannerDebounceMs: 250,
};
```

`.env` therefore contains only:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | reasoning/chat |
| `DEEPGRAM_API_KEY` | STT + TTS |

All data is **synthetic** and for demo purposes only — not medical advice.
