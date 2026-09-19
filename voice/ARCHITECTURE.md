# Voice Agent — Architecture

A local voice agent with a **fast realtime talker** and a **background
planner**. The UI has a **Test area** (raw APIs) and a **Product** tab (the
decoupled two-agent brain).

```
                        HEALTH KNOWLEDGE DB (read only, RxNorm/RxClass)
                                  |
                                  v
 User audio -> STT -> Conversational Agent (Talker) -> TTS -> User
                       |        ^
                       |        |  latest planner state (never blocks)
                       |        |
                       |   tools: health_search · patient_read · patient_update
                       v
                  Thinker / Planner  (async, between turns)
                       |-- extract facts · find gaps · choose next questions
                       |-- retrieve context · update memory
                       v
                    PATIENT DB (read + controlled write)
```

## Request flow

1. **Listen** — mic audio (`MediaRecorder` for batch, `AudioContext` PCM for live).
2. **STT** — batch → `POST /api/transcribe`; live → `/ws/listen` (server-side WS
   proxy to Deepgram, key never leaves the server).
3. **Talk** — `POST /api/brain/turn` runs **only the Talker** (`handleTurn`) and
   returns the spoken reply immediately.
4. **Plan (async)** — the same endpoint kicks off the **Planner**
   (`schedulePlan`) in the background. The UI polls `GET /api/brain/state` to
   show the updated planner state.
5. **Speak** — the reply goes to `POST /api/tts` → Deepgram `/v1/speak`.

## Why it's decoupled

- The Talker **never waits** for the Planner. Measured turn latency with the LLM
  call is ~1.4–3.8 s (Talker only); the Planner lands a few seconds later.
- The Talker uses the **latest available** planner state and can call tools when
  something is immediately needed.
- The Planner collapses bursts: one run at a time, a dirty flag triggers a
  single re-run.

## Project structure

```
HackMIT-2026/
└── voice/
    ├── server.js                # HTTP + WS proxy, brain routes
    ├── public/                  # two-tab UI (index.html, common/test/product.js)
    ├── data/                    # example documents
    ├── brain/                   # the two-agent brain (Talker + Planner)
    │   ├── brain.js             # orchestrator: handleTurn (fast) + schedulePlan (async)
    │   ├── agents/{talker,thinker}.js
    │   ├── prompts/{talker,thinker}.md
    │   ├── tools/{index,patient,health}.js   # health_search, patient_read/update
    │   ├── db/{seed,index}.js   # general_health.db (RO) + patient.db (RW)
    │   └── README.md
    └── API_SETTINGS.md / DEEPGRAM.md / ARCHITECTURE.md / README.md
```

## Design decisions

- **Fast path / slow path.** Conversation latency and deeper reasoning are
  separated so the patient never waits for the planner.
- **Keys never reach the client.** All vendor calls are proxied; live STT uses a
  server-side WebSocket proxy (`/ws/listen`).
- **Grounded, not generative.** Medical facts may only come from the health
  knowledge DB (RxNorm/RxClass) or the patient DB. Tools return scoped slices —
  never dumps — and writes go through named operations.
- **Read-only vs controlled write.** `general_health.db` is read-only at the
  engine level; patient writes use a fixed set of operations.
- **Two reasoning passes for the planner** because Chat Completions forbids
  `reasoning_effort` with function tools (see `brain/README.md`).
- **Stateful.** Planner state, transcript, advice and medication changes persist
  so a future session starts smarter.

## Running

```bash
cd voice
npm install
node brain/db/seed.js
node server.js      # → http://localhost:8787
```
