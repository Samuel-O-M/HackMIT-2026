<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# The Brain — Talker + Planner

<img src="../../presentation/thumbnail.png" alt="ReconMed" width="560" />

> A single-instance orchestrator running a **fast realtime Talker** and a
> **slower background Thinker/Planner**.

Part of **[ReconMed](../../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. This is the agent that holds the
conversation and reasons about the participant's medication record between turns.

```
                         HEALTH KNOWLEDGE DB  (read only)
                                  |
                                  v
 User audio -> STT -> Talker -> TTS -> User
                       |    ^
                       |    |  latest planner state
                       v    |
                  Thinker / Planner   (async, between turns)
                       |-- extract important facts
                       |-- determine missing information
                       |-- decide useful future questions
                       |-- retrieve relevant context
                       |-- update patient / session memory
                       v
                    PATIENT DB  (read + controlled write)
```

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#the-key-decoupling">The key decoupling</a></li>
    <li><a href="#agents">Agents</a></li>
    <li><a href="#why-the-planner-is-two-phase">Why the planner is two-phase</a></li>
    <li><a href="#planner-state">Planner state</a></li>
    <li><a href="#tools-tools">Tools</a></li>
    <li><a href="#grounding--no-hallucination">Grounding — no hallucination</a></li>
    <li><a href="#databases">Databases</a></li>
    <li><a href="#run">Run</a></li>
    <li><a href="#config">Config</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

## The key decoupling

- `handleTurn()` runs **only the Talker** and returns immediately. It surfaces
  `planning: true` but never waits.
- `schedulePlan()` runs the **Planner** asynchronously. Bursts collapse: one run
  at a time, with a dirty flag triggering a single re-run.
- The Talker always reads the **latest available** planner state, and may call
  tools directly for anything immediately needed.

## Agents

| Agent | File | Prompt | Effort | Calls |
|-------|------|--------|--------|-------|
| **Talker** | `agents/talker.js` | `prompts/talker.md` | `none` (tools require it) | every tool below |
| **Planner** | `agents/thinker.js` | `prompts/thinker.md` | medium | read-only retrieval; writes and `end_call` as `to_save` |

The Talker returns **only** the words to say out loud. Speech handling (sentence
split, dedupe, TTS) lives in the voice layer — see
[`../README.md#how-the-agent-speaks`](../README.md#how-the-agent-speaks).

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
  "to_save": [{ "op": "add_medication_change", "payload": { "...": "..." } }],
  "flags":   [{ "type": "prohibited", "detail": "...", "protocol_section": "6.5" }],
  "summary": "..."
}
```

Persisted per session in `planner_state`, so a future instance resumes.
`to_save` supports the named write ops plus `end_call`, which asks the Talker to
give a goodbye and hang up.

## Tools (`tools/`)

| Tool | Access | Notes |
|------|--------|-------|
| `health_search(query)` | read-only | drug/brand/class lookup via the shared `medical_data` (RxNorm + RxClass), plus plain-language guidance. The *only* source of medical facts. |
| `check_prohibited(rxcui)` | read | does a resolved drug trip this participant's protocol rules? Membership only; dose/timing limits are still the agent's to compare. |
| `drug_safety(name)` | read | the drug's FDA label: documented side effects. Never name a symptom it did not return. |
| `check_behaviour(code)` | read | this protocol's rule for alcohol, nicotine, grapefruit, contraception, … (`required` is breached by absence). |
| `verify_identity(dob, name?)` | read + session | name + DOB against the record; returns only verified/not-verified and attempts left. |
| `verify_caregiver(name?, relationship?)` | read + session | may this second person be spoken to? A stated relationship is not authorisation. |
| `patient_read(scope, limit?)` | read | scoped slices only: profile, enrollment, medications, protocol_rules, behaviour_rules, adherence, authorised_contacts, planner_state, transcript, advice |
| `patient_update(op, payload)` | controlled write | named ops only (see `to_save` above) |
| `set_call_outcome(outcome, …)` | write | how the call ended; required before every call finishes |
| `end_call()` | signal | ask the Talker to close and hang up |

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
Drug and class facts are not in these files: they come from `../../api/medical_data`
(real RxNorm / RxClass, cached locally; see its README).

## Run

```bash
node db/seed.js
node cli.js 0412                 # interactive; shows talker reply + planner state
node cli.js 0412 "hello"         # one turn
```

Server API (`voice/server.js`): see the endpoint table in
[`../README.md#endpoints`](../README.md#endpoints).

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

## License

Distributed under the MIT License. See [`../../LICENSE`](../../LICENSE).

## Contributors

Built at **HackMIT 2026** for the **Regeneron** track.

- **Samuel Orellana Mateo** — [@Samuel-O-M](https://github.com/Samuel-O-M)
- **Ayushi Mehrotra** — [@ayushimehrotra](https://github.com/ayushimehrotra)
- **Avighna Chhatrapati** — [@avighnac](https://github.com/avighnac)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[license-shield]: https://img.shields.io/github/license/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[license-url]: ../../LICENSE
[contributors-shield]: https://img.shields.io/github/contributors/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[contributors-url]: https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors
