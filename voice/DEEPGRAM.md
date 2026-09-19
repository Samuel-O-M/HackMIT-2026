# Deepgram Usage Notes

Reference for Deepgram's APIs (STT, TTS, Voice Agents, Intelligence, models,
management). Sources are linked at the bottom.

Two things up front:
- Deepgram does **not** hand you stored transcripts later — if you need to keep a
  transcript, store it yourself at request time (see §17).
- Everything is HTTPS/WSS and carries either an API key or a short-lived token.

_Last reviewed 2026-09-19 against `developers.deepgram.com` (`.md` docs)._

---

## 1. Authentication

- Primary header, all endpoints:
  ```
  Authorization: Token <DEEPGRAM_API_KEY>
  ```
  The scheme literal is `Token`, **not** `Bearer`.
- All calls must be HTTPS/WSS. Plain HTTP or missing auth fails.
- Keys live in the [Console](https://console.deepgram.com).
- **Secret handling (this repo):** the key is in the repo-root `.env` as
  `DEEPGRAM_API_KEY`, gitignored. Use a placeholder in docs/code, never the real
  key. Never ship it to the browser — proxy through a server route or use a
  temporary token.
- Quick key check:
  ```bash
  curl https://api.deepgram.com/v1/auth/token \
    -H "Authorization: Token $DEEPGRAM_API_KEY"
  ```

### Temporary tokens (for browser/client use)

```
POST https://api.deepgram.com/v1/auth/grant
Authorization: Token <DEEPGRAM_API_KEY>
{ "ttl_seconds": 30 }
```

- Returns `{ access_token, expires_in }`. Default TTL **30 s**; `ttl_seconds`
  can raise it, **max 3600 s**. `expires_in` is the returned lifetime in seconds.
- Use the token as `Authorization: Bearer <JWT>` on `/listen`, `/speak`, `/read`,
  and `/agent`.
- Scope is `usage::write` only and it does **not** work with the Manage APIs.
- The grant key must be **Member** role or higher, otherwise you get
  `403 FORBIDDEN / Insufficient permissions`. (This repo's key hits exactly that
  — see API_SETTINGS.md — which is why the live socket is proxied server-side.)
- An existing WebSocket outlives token expiry; the token is only checked at the
  handshake.

### Sec-WebSocket-Protocol (browser alternative)

When a browser can't set an `Authorization` header, pass the subprotocol on the
`/listen` or `/speak` handshake:

```
Sec-WebSocket-Protocol: token, <DEEPGRAM_API_KEY_OR_JWT>
```

---

## 2. API surface (endpoints at a glance)

| Need | API | Endpoint |
|------|-----|----------|
| Transcribe a file | Pre-recorded STT | `POST https://api.deepgram.com/v1/listen` |
| Transcribe live audio | Streaming STT | `wss://api.deepgram.com/v1/listen` |
| Turn-based STT (agents) | Flux STT | `wss://api.deepgram.com/v2/listen` |
| Text → speech (one-shot) | TTS REST (Aura) | `POST https://api.deepgram.com/v1/speak` |
| Text → speech (streamed) | TTS WebSocket (Aura) | `wss://api.deepgram.com/v1/speak` |
| Text → speech (batch) | Flux TTS REST | `POST https://api.deepgram.com/v2/speak` |
| Text → speech (streamed) | Flux TTS WebSocket | `wss://api.deepgram.com/v2/speak` |
| Listen + think + speak | Voice Agent | `wss://agent.deepgram.com/v1/agent/converse` |
| Analyze text | Text Intelligence | `POST https://api.deepgram.com/v1/read` |
| List / inspect models | Models API | `GET https://api.deepgram.com/v1/models` · `/{model_id}` |
| Temporary token | Auth API | `POST https://api.deepgram.com/v1/auth/grant` |
| Projects, keys, usage | Manage API | `https://api.deepgram.com/v1/projects/...` (§12) |

Notes:
- **Flux STT must use `/v2/listen`**; `/v1/listen` will not work with Flux models.
- **Flux TTS is `/v2/speak`** and `model` is required; Aura model strings are
  rejected there. Aura stays on `/v1/speak`.
- Voice Agent lives on a separate host (`agent.deepgram.com`), not `api.`.

---

## 3. Pre-recorded speech-to-text

`POST https://api.deepgram.com/v1/listen`

Remote file (JSON body):
```bash
curl -X POST \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://dpgr.am/spacewalk.wav"}' \
  "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true"
```

Local file (raw body):
```bash
curl -X POST \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: audio/wav" \
  --data-binary @youraudio.wav \
  "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true"
```

JavaScript SDK:
```js
import { DeepgramClient } from "@deepgram/sdk";
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

const result = await deepgram.listen.v1.media.transcribeUrl({
  url: "https://dpgr.am/spacewalk.wav",
  model: "nova-3",
  smart_format: true,
});
```

Response shape (trimmed): `results.channels[0].alternatives[0].transcript`,
`.confidence`, `.words[]` with `start`/`end` timestamps (and `.speaker` when
diarized). Batch-only extras include `results.utterances[]`, `paragraphs`,
`summary`, `sentiments`, `topics`, `intents`, and `channels[].detected_language`.

### Pre-recorded query parameters

`callback`, `callback_method` (POST/PUT), `extra`, `sentiment`, `summarize`
(`true`/`v2`), `tag`, `topics`, `custom_topic` (≤100), `custom_topic_mode`
(`extended`|`strict`), `intents`, `custom_intent` (≤100), `custom_intent_mode`
(`extended`|`strict`), `detect_entities`, `detect_language`, `diarize`
(**deprecated**), `diarize_model` (`latest`|`v1`|`v2`), `dictation`, `encoding`,
`filler_words`, `keyterm`, `keywords`, `language`, `measurements`, `model`,
`multichannel`, `numerals`, `paragraphs`, `profanity_filter`, `punctuate`,
`redact`, `replace`, `search`, `smart_format`, `utterances`, `utt_split`
(default 0.8), `version`, `mip_opt_out`.

- `diarize` is deprecated: use `diarize_model` (specifying it enables
  diarization on its own). Batch supports `latest` (v2), `v1`, `v2`.
- `encoding` values (when sending raw audio): `linear16`, `flac`, `mulaw`,
  `amr-nb`, `amr-wb`, `opus`, `speex`, `g729`.
- `keyterm` is Nova-3 only; `keywords` is everything **except** Nova-3.

**Limits:** max ~2 GB/file; concurrency per project (see §16); a request whose
processing exceeds 10 min (Nova/Base/Enhanced) returns `504`.

---

## 4. Streaming speech-to-text (real time)

`wss://api.deepgram.com/v1/listen`

JavaScript SDK:
```js
const connection = await deepgram.listen.v1.connect({
  model: "nova-3",
  language: "en-US",
  smart_format: "true",
});

connection.on("open", () => { /* connection.connect(); connection.sendMedia(chunk) */ });
connection.on("message", (data) => {
  if (data.type === "Results") console.log(data.channel.alternatives[0].transcript);
});
connection.on("error", console.error);
```

### Streaming query parameters

`callback`, `callback_method`, `channels`, `detect_entities`, `diarize`
(deprecated), `diarize_model` (streaming supports only `latest`/`v1`; `v2` is a
validation error), `dictation`, `encoding`, `endpointing` (default 10 ms),
`extra`, `interim_results` (default false), `keyterm`, `keywords`, `language`,
`mip_opt_out`, `model`, `multichannel`, `numerals`, `profanity_filter`,
`punctuate`, `redact`, `replace`, `sample_rate`, `search`, `smart_format`, `tag`,
`utterance_end_ms` (min 1000, max 5000; needs `interim_results`+`vad_events`),
`vad_events` (default false), `version`.

Raw audio **must** set `encoding` + `sample_rate` (e.g. `linear16`, `16000`).

### Client → server

- **Binary audio frames**
- `{"type":"Finalize"}` — flush pending audio into a final result
- `{"type":"CloseStream"}` — close the stream
- `{"type":"KeepAlive"}` — hold an idle socket open

### Server → client

- `Results` — `is_final`, `speech_final`, `channel.alternatives[0].transcript`
  and `.words[]`; `entities[]` present on final results when
  `detect_entities=true`
- `Metadata` — request/model info
- `UtteranceEnd` — end of an utterance (`last_word_end`)
- `SpeechStarted` — speech onset (`timestamp`), when `vad_events=true`

Send periodic **KeepAlive** to keep an idle socket alive; use **Endpointing** /
**Interim Results** for turn-taking.

---

## 5. Flux (conversational STT for voice agents)

Built for turn-taking: model-native end-of-turn detection, word-level timestamps,
Nova-3-level accuracy. Endpoint: `wss://api.deepgram.com/v2/listen`.

- Models: `flux-general-en`, or `flux-general-multi` (en, es, fr, de, hi, ru,
  pt, ja, it, nl).
- Send ~80 ms chunks (e.g. 2560 bytes of 16 kHz linear16). For raw audio set
  `encoding` + `sample_rate` (`linear16`, `16000` recommended).

```js
const connection = await client.listen.v2.connect({
  model: "flux-general-en",
  encoding: "linear16",
  sample_rate: 16000,
});
connection.on("message", (m) => {
  if (m.type === "TurnInfo" && m.transcript) console.log(m.transcript);
});
connection.connect();
await connection.waitForOpen();
```

### Query parameters

`model`, `encoding` (`linear16`|`linear32`|`mulaw`|`alaw`|`opus`|`ogg-opus`),
`sample_rate`, `eot_threshold` (0.5–1.0, default 0.7), `eager_eot_threshold`
(0.3–0.9, optional; enables early LLM prep), `eot_timeout_ms` (500–60000, default
5000), `keyterm`, `language_hint` (only with `flux-general-multi`),
`profanity_filter` (default false), `numerals` (default false), `redact`
(**only** `numbers`|`aggressive_numbers`), `mip_opt_out`, `tag`.

### Client → server

- binary audio; `{"type":"CloseStream"}`;
  `{"type":"ForceEndTurn"}` (end turn from an external signal);
  `{"type":"Configure"}` (update thresholds/keyterms/language hints/numerals
  mid-stream).

### Server → client

- `Connected` (`request_id`, `sequence_id`)
- `TurnInfo` — the core event. Fields: `event`, `turn_index`,
  `audio_window_start/end`, `transcript`, `words[]`,
  `end_of_turn_confidence`, `trigger` (on EndOfTurn only: `model`|`manual`|
  `timeout`), and `languages`/`languages_hinted` for multi.
- `ConfigureSuccess` / `ConfigureFailure`
- `Error`

`TurnInfo.event` values:
- `Update` — more audio transcribed, turn state unchanged
- `StartOfTurn` — user began speaking
- `EagerEndOfTurn` — moderate confidence the turn is done; prep a reply
- `TurnResumed` — speech continued after an eager end
- `EndOfTurn` — user finished the turn

---

## 6. Text-to-speech — Aura (`/v1/speak`)

### REST (one-shot), returns audio bytes (MP3 by default)

```bash
curl -X POST \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, how can I help you today?"}' \
  --output out.mp3 \
  "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en"
```

### WebSocket (streamed), for low-latency/LLM output

```jsonc
// send
{ "type": "Speak", "text": "Your text to speak" }
{ "type": "Flush" }   // triggers audio generation
{ "type": "Close" }   // flush and close gracefully
{ "type": "Clear" }   // discard buffered text (destructive)
```

Server events: `Metadata`, `Flushed`, `Cleared`, `Warning`, plus binary `Audio`.

### Parameters

| Param | Values / default | Notes |
|-------|------------------|-------|
| `model` | default `aura-asteria-en` | voice (see §8) |
| `encoding` | REST default `mp3`; WS default `linear16` | REST: `mp3`,`opus`,`flac`,`aac`,`linear16`,`mulaw`,`alaw`; WS: `linear16`,`mulaw`,`alaw` |
| `container` | REST default `wav` | REST only; pair `linear16`+`wav` for playable PCM |
| `sample_rate` | default 24000 | e.g. 8000/16000/24000/32000/48000 |
| `bit_rate` | default 48000 | REST only, for compressed formats |
| `speed` | 0.7–1.5, default 1.0 | speaking-rate multiplier |
| `callback`, `callback_method` | URL / `POST` | async audio delivery |
| `tag`, `mip_opt_out` | | usage label / MIP opt-out |

**Aura-2 controls:** `speed` 0.7–1.5 (Spanish recommended ≥0.9); inline IPA
pronunciation overrides in the text as escaped JSON
(`\{"word":"dupilumab","pronounce":"duːˈpɪljuːmæb"\}`), ≤500 per request, ≤128
chars IPA. English/Spanish only. Response headers report
`dg-pronunciations-applied`, `dg-speed-used`, `dg-pronunciation-warnings`.

**Limits:** max 2000 chars/request (Aura); WS throughput 2400 chars/min; WS
session timeout 60 min; max 20 `Flush` per 60 s.

> `expressivity` is **not** available on Aura-2 — it is Flux-only (§7).

---

## 7. Flux TTS (`/v2/speak`) — streaming-first, interruptible

A different, newer voice family from Aura, served on `/v2/speak` over two
transports. Built for agent pipelines: server-managed flush, `Interrupt` that
reports exactly what the user heard, and cross-turn voice consistency.

| Transport | Endpoint | Best for |
|-----------|----------|----------|
| WebSocket | `wss://api.deepgram.com/v2/speak` | live agents; stream tokens in, audio back, interrupt/resume |
| REST | `POST https://api.deepgram.com/v2/speak` | pre-rendering fixed audio (IVR, notifications, audiobooks) |

`model` is **required** on every connection (`flux-{voice}-en`).

### Parameters

- Streaming: `model` (required), `encoding` (`linear16` default, `mulaw`,
  `alaw`), `sample_rate`, `speed` (0.5–1.5 in 0.05 steps), `expressivity`
  (−2 calm … 2 animated, default 0, **beta**), `mip_opt_out`, `tag`.
- Batch adds: `bit_rate` (mp3: 8000–48000), `container`, `callback`,
  `callback_method`, `priority` (`Low` only, for async).
- Batch request body is `{ "text": "..." }`.

### Client → server (WS)

- `{"type":"Speak","text":"..."}`
- `{"type":"Flush"}` — end the active turn
- `{"type":"Interrupt","playback_offset":{"type":"time_ms","value":N}}` —
  cancel the turn; offset is from session start and must advance each time
- `{"type":"Configure","speed":N}` — change speed at the next boundary
- `{"type":"Close"}` — drain, emit `SessionMetadata`, close

### Server → client (WS)

`Connected`, binary audio, `SpeechStarted` (`speech_id`), `SpeechMetadata`
(duration + character counts), `SpeechInterrupted` (`audio_played_ms`,
`text_spoken`, `text_remaining`), `Flushed`, `SessionMetadata`,
`ConfigureSuccess`/`ConfigureFailure`, `Warning`, `Error` (fatal, socket closes).

On barge-in: stop local playback immediately, send `Interrupt` (the round-trip
is for context reconciliation, not for stopping audio), drop in-flight frames
until `SpeechInterrupted`, then append `text_spoken` to your LLM context.

**Limits:** WS session 1 h; idle socket closes after 60 s; `speed` 0.5–1.5
(0.05 steps); `expressivity` whole numbers −2…2; one `Interrupt` at a time.

---

## 8. Models & voices

### STT models

| Model | Use |
|-------|-----|
| `flux-general-en` / `flux-general-multi` | Real-time conversational agents with turn detection |
| `nova-3` / `nova-3-general` | Highest-accuracy general ASR (batch or streaming); 30+ languages, `multi` code-switching |
| `nova-3-medical` | English medical vocabulary |
| `nova-3-pharma` | English pharma vocabulary |
| `nova-2` (+ `-meeting`, `-phonecall`, `-finance`, `-conversationalai`, `-voicemail`, `-video`, `-medical`, `-drivethru`, `-automotive`) | Languages not yet on nova-3; filler words |
| `nova` (+ `-general`, `-phonecall`, `-medical`) | Legacy Nova 1 |
| `enhanced` / `base` (+ variants, `-custom`) | Cheaper/legacy; keyword boosting |
| `whisper` / `whisper-tiny…large` | Deepgram-hosted Whisper (NA only, low scale) |

All models default to `language=en` unless specified. `nova-3` supports `multi`.

### TTS voices

Format `[modelname]-[voice]-[language]`. Aura-2 languages: **en, es, de, fr,
nl, it, ja**. Examples: `aura-2-thalia-en` (default here), `aura-2-helena-en`
(caring), `aura-2-harmonia-en` (empathetic), `aura-2-draco-en` (British),
`aura-2-hyperion-en` (Australian), `aura-2-estrella-es`, `aura-2-uzume-ja`.
Aura 1 also exists (`aura-asteria-en`, …).

**Flux TTS voices are a separate family**: `flux-{voice}-en` (e.g.
`flux-haley-en`, `flux-kit-en`, `flux-hannah-en`, `flux-bruce-en`), same
catalog on both transports, English-only today. Do not pass Flux voices to
`/v1/speak` or Aura voices to `/v2/speak`.

Full voice catalog: https://developers.deepgram.com/docs/tts-models and
https://developers.deepgram.com/docs/flux-tts/voices.

---

## 9. Voice Agent API

One WebSocket runs listen → think → speak, with turn detection, barge-in,
function calling, and per-turn latency. Useful when you don't want to wire
STT + LLM + TTS yourself.

- **Endpoint:** `wss://agent.deepgram.com/v1/agent/converse` (regional:
  `wss://api.eu|au|in.deepgram.com/v1/agent/converse`).
- **Transport:** JSON control messages + raw binary audio frames. Auth header on
  the handshake.
- **Settings message schema:** `{ type:"Settings", tags?, experimental?,
  mip_opt_out?, flags?, audio, agent }`. `agent` can be a stored agent UUID.

`audio.input`: `encoding` (default `linear16`), `sample_rate` (required).
`audio.output`: `encoding` (default `linear16`), `sample_rate`, `bitrate`,
`container` (`none`|`wav`|`ogg`).

`agent`:
- `listen.provider`: `type:"deepgram"` (only provider); `version` (v1|v2);
  v1/Nova: `model`, `language`, `keyterms[]`, `smart_format`; v2/Flux: `model`,
  `language_hints[]`, `keyterms[]`, `eot_threshold`, `eager_eot_threshold`,
  `eot_timeout_ms`.
- `think`: `provider` (object or fallback **array**), `endpoint {url,headers}`,
  `functions[]`, `prompt`, `context_length`.
- `speak`: `provider` (object or fallback **array**), `endpoint {url,headers}`.
  Deepgram TTS, ElevenLabs, Cartesia, OpenAI, AWS Polly supported.
- Top level: `greeting`, `context.messages[]` (conversation/function-call
  history), `flags.history`.

**Client messages:** `Settings`, `UpdateListen`, `UpdateThink`, `UpdateSpeak`,
`UpdatePrompt`, `InjectUserMessage`, `InjectAgentMessage`, `FunctionCallResponse`,
`ForceEndTurn`, `KeepAlive`, binary `Media`.

**Server events:** `Welcome`, `SettingsApplied`, `ConversationText`,
`UserStartedSpeaking`, `AgentThinking`, `AgentStartedSpeaking`, `AgentAudioDone`,
`FunctionCallRequest`, `FunctionCallResponse`, `FunctionCallCancelled`,
`LatencyReport`, `History`, `ListenUpdated`, `ThinkUpdated`, `SpeakUpdated`,
`PromptUpdated`, `InjectionRefused`, `Error`, `Warning`, binary `Audio`.

**Function calling:** declare `functions[]` on `think` with `name`,
`description`, `parameters` (JSON Schema), optional `defer_until_eot`, optional
`endpoint {url,method,headers}`. No endpoint → client-side (`FunctionCallRequest`
/ `FunctionCallResponse`); endpoint present → server-side. `defer_until_eot`
holds irreversible calls until the turn is confirmed and discards them if the
user resumes.

**Providers:** LLM — `open_ai`, `anthropic`, `google`, `groq`, `nvidia`,
`aws_bedrock`. STT — Deepgram Nova/Flux. TTS — Deepgram Aura, ElevenLabs,
Cartesia, OpenAI, AWS Polly. Exact model lists vary; see docs.

**Limits:** sessions auto-close after **2 hours** (warning 5 min prior).
Barge-in/interruption supported. Start here:
https://developers.deepgram.com/docs/build-a-voice-agent.

---

## 10. Audio Intelligence

Features on `/v1/listen` (batch and streaming: Entity Detection, Sentiment,
Intent Recognition, Summarization, Topic Detection).

| Feature | Param(s) | Values / notes |
|---------|----------|----------------|
| Entity Detection | `detect_entities` | bool, default false. Nova/Nova-2/Nova-3/Enhanced streaming; all models batch. Enables Punctuation. |
| Sentiment | `sentiment` | bool, default false. English only. Adds `sentiments.segments[]` + `.average`. |
| Intent Recognition | `intents`, `custom_intent` (≤100), `custom_intent_mode` (`extended`\|`strict`) | bool. English only. |
| Summarization | `summarize` | `true`/`v2`; one summary per request; needs >50 words. |
| Topic Detection | `topics`, `custom_topic` (≤100), `custom_topic_mode` (`extended`\|`strict`) | bool. English only. |

Audio Intelligence is **English-only**; input token limit **150K** (else
`400 TOKEN_LIMIT_EXCEEDED`).

---

## 11. Text Intelligence

`POST https://api.deepgram.com/v1/read`

Body is exactly one of `{ "text": "..." }` or `{ "url": "..." }`.

Params: `language` (en only), `sentiment`, `summarize` (boolean only here),
`topics`, `custom_topic` (≤100), `custom_topic_mode`, `intents`,
`custom_intent`, `custom_intent_mode`, `tag`, `callback`, `callback_method`.
Results: `summary.text`, `topics.segments[]`, `intents.segments[]`,
`sentiments.segments[]`+`.average`. Same English-only + 150K-token rules.

---

## 12. Models & Manage APIs

- `GET /v1/models` — all latest public models (`?include_outdated=true` for
  more). Returns `{ stt:[...], tts:[...] }` with architecture, languages,
  version, uuid, `batch`/`streaming` flags; TTS adds voice metadata.
- `GET /v1/models/{model_id}` — one model by **UUID**.
- Management (needs a suitably scoped key; **not** callable with a temp token):
  - Projects: `GET/PATCH/DELETE /v1/projects[/{id}]`, `/leave`, `/members`, `/invites`, `/scopes`
  - Keys: `GET/POST/DELETE /v1/projects/{id}/keys[/{key_id}]`
  - Billing/usage: `/v1/projects/{id}/balances`, `/usage`, `/usage/breakdown`, `/usage/fields`, `/requests[/{request_id}]`
  - Models per project: `/v1/projects/{id}/models`
  - Self-hosted credentials: `/v1/projects/{id}/self-hosted/distribution/credentials`

---

## 13. Deployments & regional endpoints

- **Global (default):** `api.deepgram.com`; Voice Agent `agent.deepgram.com`.
- **Regional:** `api.eu.deepgram.com`, `api.au.deepgram.com`,
  `api.in.deepgram.com` (Voice Agent at `api.<region>.deepgram.com/v1/agent/converse`).
  Same keys/SDKs — just change the base URL. **Whisper is not available** in
  regional endpoints, and there is no cross-region fallback (requests fail rather
  than reroute).
- **Dedicated:** `{uid}.{region}.api.deepgram.com`.
- **Self-hosted:** your own domain/ports, distribution credentials, you own
  backups/updates/monitoring.

---

## 14. Errors

Auth:
- `401 INVALID_AUTH` — bad key.
- `401 INSUFFICIENT_PERMISSIONS` — key lacks the permission.
- `403 INSUFFICIENT_PERMISSIONS` — no access to the requested model.

STT:
- `400 INVALID_JSON` / `400` unknown body format (often: URL sent without
  `Content-Type: application/json`).
- `402 ASR_PAYMENT_REQUIRED` — out of credits, no overage.
- `422 ASR_UNPROCESSABLE_ENTITY` — upload interrupted/incomplete.
- `429 TOO_MANY_REQUESTS` — rate limit; use exponential backoff.

TTS:
- `400` unknown model/voice, unparsable params, empty text, unsupported audio
  format combo.
- `413` body >2 MB or text over the character limit.

General: `504` timeout. Handle `408`, `411`, `413`, `414`, `429`, `499`, `500`,
`502`, `503`, `504` gracefully.

---

## 15. SDKs, CLI, MCP

- Official SDKs: **JS/TS** `@deepgram/sdk`, **Python** `deepgram-sdk`,
  **Go** `deepgram-go-sdk`, **.NET** `Deepgram`, **Java** `deepgram-java-sdk`,
  **Rust** `deepgram-rust-sdk`. Rust lacks Voice Agent, TTS streaming, and Text
  Intelligence. See the SDK feature matrix for detail.
- **CLI** (`dg`, pip package `deepctl`): `dg listen`, `dg speak`, `dg read`,
  projects/keys/usage, `-o json|yaml|table|csv`, agent-friendly non-interactive
  mode. Also ships a **built-in MCP server** (`dg mcp`).
- Docs MCP server: `https://api.dx.deepgram.com/kapa/mcp`.
- Without an SDK, see the [recipes repo](https://github.com/deepgram/recipes).

---

## 16. Rate limits & concurrency

Limits apply **per project**, not per key — extra keys/projects don't add
concurrency. Pay-as-you-go (North America):

- Voice Agent: 45 concurrent connections.
- STT: Nova/Flux/Nova-2/etc. — 50 concurrent pre-recorded, 150 concurrent
  streaming. Diarization reduces streaming concurrency (50 NA, 25 elsewhere).
- Whisper: 3 concurrent, NA only.
- TTS REST: 15 concurrent (Aura/Aura-2/Flux TTS).
- TTS streaming: 45 concurrent (Aura/Aura-2).
- Audio Intelligence: Entity Detection 5; Sentiment/Intent 10; Summarization/
  Topics 10. Text Intelligence similar.
- `429` → exponential backoff. Growth/Enterprise tiers are higher.
  See https://developers.deepgram.com/reference/api-rate-limits.

---

## 17. Data handling

- By default, Deepgram retains audio/text/transcripts and may use them to
  improve models; request metadata/usage logs are retrievable for ~90 days
  (metadata only — no audio/text).
- `mip_opt_out=true` (query param, or `"mip_opt_out": true` in the Voice Agent
  Settings message) opts out; opted-out data is kept only as long as needed to
  process.
- For data residency, use a regional endpoint **and** `mip_opt_out=true`.
- Async callback results are deleted once delivered (or retries exhausted).

---

## 18. References

- Docs home / index: https://developers.deepgram.com/docs/introduction
- Full docs index for LLMs: https://developers.deepgram.com/llms.txt
- Authentication: https://developers.deepgram.com/guides/fundamentals/authenticating
- Token auth: https://developers.deepgram.com/guides/fundamentals/token-based-authentication
- Pre-recorded audio: https://developers.deepgram.com/docs/pre-recorded-audio
- Live streaming audio: https://developers.deepgram.com/docs/live-streaming-audio
- Flux STT quickstart: https://developers.deepgram.com/docs/flux/quickstart
- Flux STT configuration: https://developers.deepgram.com/docs/flux/configuration
- Text-to-speech (REST): https://developers.deepgram.com/docs/text-to-speech
- Streaming TTS (WebSocket): https://developers.deepgram.com/docs/streaming-text-to-speech
- Flux TTS overview: https://developers.deepgram.com/docs/flux-tts/overview
- Flux TTS client messages: https://developers.deepgram.com/docs/flux-tts/client-messages
- Voice Agent: https://developers.deepgram.com/docs/voice-agent
- Voice Agent settings: https://developers.deepgram.com/docs/voice-agent-settings
- Models & languages: https://developers.deepgram.com/docs/models-languages-overview
- TTS voices (Aura): https://developers.deepgram.com/docs/tts-models
- Flux TTS voices: https://developers.deepgram.com/docs/flux-tts/voices
- Audio Intelligence: https://developers.deepgram.com/docs/audio-intelligence
- Text Intelligence: https://developers.deepgram.com/docs/text-intelligence
- Models API: https://developers.deepgram.com/reference/manage/models/list
- API reference: https://developers.deepgram.com/reference/deepgram-api-overview
- Errors: https://developers.deepgram.com/docs/errors
- Rate limits: https://developers.deepgram.com/reference/api-rate-limits
- Regional endpoints: https://developers.deepgram.com/reference/regional-endpoints
- Your data / retention: https://developers.deepgram.com/trust-security/your-data
- SDK feature matrix: https://developers.deepgram.com/sdks/sdk-features
- JS SDK: https://github.com/deepgram/deepgram-js-sdk
- Python SDK: https://github.com/deepgram/deepgram-python-sdk
