# Voice Agent — local UI + brain

A local harness for the whole voice pipeline:

**mic → Deepgram STT → (Test chat · or · Brain: Thinker → Talker) → Deepgram TTS → speakers**

The UI has **two tabs**:

- **🧪 Test area** — exercise the APIs directly: batch STT, **live streaming
  STT**, transcribe-a-URL, plain OpenAI chat, TTS, and STT/TTS settings.
- **🧠 Product — Thinker → Talker** — the real product: pick a participant,
  start a session, and talk to the two-agent brain (`../brain`).

See [`API_SETTINGS.md`](./API_SETTINGS.md) for every Deepgram + OpenAI setting,
and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design.

## Run

```bash
cd voice
npm install          # one dependency: `ws` (server-side live-STT proxy)
node ../brain/db/seed.js   # first time: create the two databases
node server.js       # → http://localhost:8787
```

Open **http://localhost:8787**. Mic access works on `localhost` (or HTTPS).

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET  /api/health` | which keys/models are configured (no secrets) |
| `POST /api/transcribe` | raw audio body **or** `{url}` → `{transcript, raw}` |
| `WS   /ws/listen` | server-side proxy to Deepgram streaming STT (key stays server-side) |
| `POST /api/tts` | `{text}` → audio bytes |
| `POST /api/chat` | `{messages, model?, reasoningEffort?}` → `{reply}` |
| `GET  /api/patients` | participants from the patient DB |
| `POST /api/brain/session` | `{subjectId}` → `{sessionId}` |
| `POST /api/brain/turn` | `{sessionId, subjectId, text}` → `{say, thinking}` |

STT/TTS allow-listed settings can be passed as query params
(e.g. `?model=nova-2-medical&diarize=true`, `?model=aura-2-helena-en&encoding=linear16&container=wav`).

## Keys & config (repo-root `.env`, gitignored)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEEPGRAM_API_KEY` | — | STT + TTS |
| `OPENAI_API_KEY` | — | reasoning/chat |
| `DEEPGRAM_STT_MODEL` | `nova-3` | transcription model |
| `DEEPGRAM_TTS_MODEL` | `aura-2-thalia-en` | voice |
| `SYSTEM_PROMPT` | built-in | plain-chat instructions |
| `PORT` | `8787` | server port |

Model + reasoning-effort choices for the brain live in code
(`brain/config.js`), not `.env`. The plain-chat model in the Test tab is set in
`voice/server.js` (and can be overridden per-request by the UI pickers).

## Documents

`data/` holds example knowledge sources (not yet wired into the agent).

## Notes

- API keys never reach the browser: every call is proxied by `server.js`, and
  live STT runs through the `/ws/listen` WebSocket proxy.
- `node:sqlite` rows are **null-prototype** — never interpolate one directly
  into a template string (see `brain/lib/format.js`).
