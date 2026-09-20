<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# Voice Agent — local UI + brain

> The whole voice pipeline in one process: **mic → Deepgram STT → grounded
> Talker + Planner → Deepgram TTS → speakers.**

Part of **[ReconMed](../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. This module is the phone call and the
agent that runs it.

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#run">Run</a></li>
    <li><a href="#phone-access-cloudflare-tunnel">Phone access (Cloudflare Tunnel)</a></li>
    <li><a href="#the-agent-places-the-call">The agent places the call</a></li>
    <li><a href="#how-the-agent-speaks">How the agent speaks</a></li>
    <li><a href="#ending-the-call">Ending the call</a></li>
    <li><a href="#endpoints">Endpoints</a></li>
    <li><a href="#keys--config-repo-root-env-gitignored">Keys &amp; config</a></li>
    <li><a href="#notes">Notes</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

The UI is a **single call screen** (the handset waits to be rung):

- **The call** — the dashboard places a call and the phone rings; answer and talk.
  Your words and the agent's appear as bubbles; mute or end the call any time.
- **Grounding** — the participant's record (profile, study, current medications)
  preloaded into the agent every turn, plus what it looked up on the last turn.
- **Brain & planner** — goal, known/missing, next questions, flags, planner
  status and channel state (developer panel).
- **Session log** — the browser keeps a downloadable event log, and the server
  appends a JSONL log per session to `voice/logs/<sessionId>.jsonl` (served at
  `GET /api/brain/log?sessionId=…`). Logs are gitignored.
- **Phone mode** — the phone icon (or a narrow/coarse-pointer screen) switches to
  an iOS-style call screen: same pipeline, laid out for iPhone.

See [`API_SETTINGS.md`](./API_SETTINGS.md) for every Deepgram + OpenAI setting.

## Run

```bash
cd voice
npm install                 # one dependency: `ws` (server-side live-STT proxy)
node brain/db/seed.js       # first time: create the two databases
node server.js              # → http://localhost:8787
```

Open **http://localhost:8787**. Mic access works on `localhost` or HTTPS.

## Phone access (Cloudflare Tunnel)

`getUserMedia` needs a secure context, so `http://<LAN-IP>:8787` will not work on
a phone. Tunnel to the server and open the printed URL:

```bash
cd api/cloudflare && ./tunnel.sh      # → https://<random>.trycloudflare.com
```

Then tap the phone icon for phone mode. See
[`api/cloudflare/README.md`](../api/cloudflare/README.md); if Cloudflare's edge
port is blocked, use [`api/ngrok/`](../api/ngrok/README.md).

## The agent places the call

When a call connects the browser asks for an *opening turn*
(`POST /api/brain/turn/stream` with `opening: true`), so the agent speaks first —
"Hello." plus who is calling, why, and a request for name + date of birth, exactly
as the identity rule in `brain/prompts/policy.md` allows and nothing more. No
participant message is recorded for it, and a repeated opening request is ignored.

## How the agent speaks

Speech is deliberately simple: once the model has finished its reply (tool rounds
included) the text is **split on `.`** and each sentence is sent to TTS in order,
played back to back. There is no incremental parsing of the token stream — that
produced clipped and duplicated speech.

- **Voice:** `aura-2-helena-en` (`public/app.js`); the server default for
  `/api/tts` is `aura-2-thalia-en`, used only when the caller omits `model`.
- **Duplication guard:** `cleanSpoken()` drops any sentence the model repeats, even
  when the copies are glued together with stray tokens, so nothing is spoken twice.
- **Turn-taking:** nova-3 with interims; roughly **1 s** of silence after a
  finished sentence (1.6 s when the answer trails off) ends the participant's turn.
  `?stt=flux` opts into Flux whole-turn detection instead.

## Ending the call

When the sweep is done the agent says a short goodbye and calls `end_call`; the
browser waits **1 second** after the last words, then hangs up. The planner can ask
to wrap up too: it emits an `end_call` item in `to_save`, the Talker is told its
next message is the goodbye, and the call ends right after.

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET  /api/health` | which keys/models are configured (no secrets) |
| `POST /api/deepgram/token` | short-lived Deepgram token |
| `POST /api/transcribe` | raw audio body **or** `{url}` → `{transcript, raw}` |
| `WS   /ws/listen` | server-side proxy to Deepgram streaming STT |
| `POST /api/tts` | `{text}` → audio bytes |
| `POST /api/chat` | `{messages, model?, reasoningEffort?}` → `{reply}` |
| `GET  /api/patients` | participants from the patient DB |
| `POST /api/brain/session` | `{subjectId}` → `{sessionId}` |
| `POST /api/brain/turn/stream` | NDJSON turn: `say` / `wait` / `done` / `error` |
| `POST /api/brain/turn` | non-streaming turn → `{say, …}` |
| `POST /api/brain/end` | end the call; publish staged changes to the reviewer |
| `POST /api/brain/channel` | `{sessionId, state}` — call channel state |
| `GET  /api/brain/state` | planner state for a session |
| `GET  /api/brain/debug` | full brain/planner debug snapshot |
| `GET  /api/brain/live` | SSE: live call transcript + staged changes |
| `GET  /api/brain/log` | the session's offline JSONL log |
| `GET  /api/calls` | recent calls |
| `POST /api/calls` | place a call (`{subjectId \| to}`) |
| `GET  /api/calls/stream` | SSE: ring / hangup events for the handset |
| `POST /api/calls/:id/{answer,decline,end}` | handset call actions |
| `GET  /api/telephony` | active telephony provider |

STT/TTS allow-listed settings can be passed as query params (e.g.
`?diarize=true`, `?encoding=linear16&container=wav`).

## Keys & config (repo-root `.env`, gitignored)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEEPGRAM_API_KEY` | — | STT + TTS |
| `OPENAI_API_KEY` | — | reasoning/chat |
| `DEEPGRAM_STT_MODEL` | `nova-3` | transcription model |
| `DEEPGRAM_TTS_MODEL` | `aura-2-thalia-en` | server-side TTS default |
| `PORT` | `8787` | server port |
| `TELEPHONY_PROVIDER` | `simulated` | `simulated` or `twilio` |

Model + reasoning-effort choices for the brain live in code (`brain/config.js`),
not `.env`.

## Notes

- API keys never reach the browser: every call is proxied by `server.js`, and live
  STT runs through the `/ws/listen` WebSocket proxy.
- `node:sqlite` rows are **null-prototype** — never interpolate one into a
  template string (see `brain/lib/format.js`).
- For the agent internals see [`brain/README.md`](./brain/README.md); for outbound
  calling see [`telephony/README.md`](./telephony/README.md).

## License

Distributed under the MIT License. See [`../LICENSE`](../LICENSE).

## Contributors

Built at **HackMIT 2026** for the **Regeneron** track.

- **Samuel Orellana Mateo** — [@Samuel-O-M](https://github.com/Samuel-O-M)
- **Ayushi Mehrotra** — [@ayushimehrotra](https://github.com/ayushimehrotra)
- **Avighna Chhatrapati** — [@avighnac](https://github.com/avighnac)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[license-shield]: https://img.shields.io/github/license/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[license-url]: ../LICENSE
[contributors-shield]: https://img.shields.io/github/contributors/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[contributors-url]: https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors
