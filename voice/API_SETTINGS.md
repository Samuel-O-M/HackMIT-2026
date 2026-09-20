# API Settings Reference — Deepgram + OpenAI

Everything both providers expose, and what this UI actually wires up.
Legend: **[UI]** = exposed in the test area · **[brain]** = used by the two-agent product.

---

# Deepgram

## Auth
- Header: `Authorization: Token <API_KEY>` (all calls over HTTPS/WSS). Scheme is `Token`, not `Bearer`.
- Key check: `GET https://api.deepgram.com/v1/auth/token`.
- Temporary tokens: `POST https://api.deepgram.com/v1/auth/grant` (`{"ttl_seconds":30}`)
  → `{ access_token, expires_in }`. Default TTL 30 s; max 3600 s. Scope `usage::write`,
  works for `/listen`, `/speak`, `/read`, `/agent` — **not** the Manage APIs. Requires a
  Member+ key. Our key returns `403 FORBIDDEN: Insufficient permissions`, so this UI
  proxies the WebSocket **server-side** instead (`/ws/listen`).
- Browser alternative when headers are blocked: `Sec-WebSocket-Protocol: token, <KEY_OR_JWT>`.

## Endpoints

| Purpose | Method | Endpoint |
|---------|--------|----------|
| Pre-recorded STT | POST | `https://api.deepgram.com/v1/listen` |
| Streaming STT | WS | `wss://api.deepgram.com/v1/listen` |
| Conversational STT (Flux) | WS | `wss://api.deepgram.com/v2/listen` |
| TTS (one-shot, Aura) | POST | `https://api.deepgram.com/v1/speak` |
| TTS (streaming, Aura) | WS | `wss://api.deepgram.com/v1/speak` |
| Flux TTS (batch) | POST | `https://api.deepgram.com/v2/speak` |
| Flux TTS (streaming) | WS | `wss://api.deepgram.com/v2/speak` |
| Voice Agent | WS | `wss://agent.deepgram.com/v1/agent/converse` |
| Text Intelligence | POST | `https://api.deepgram.com/v1/read` |
| Models | GET | `https://api.deepgram.com/v1/models` · `/v1/models/{model_id}` |
| Temporary token | POST | `https://api.deepgram.com/v1/auth/grant` |

Regional: swap `api.deepgram.com` → `api.eu.deepgram.com` / `api.au.deepgram.com` /
`api.in.deepgram.com` (Voice Agent: `api.<region>.deepgram.com/v1/agent/converse`).
Whisper is unavailable in regional endpoints.

## Speech-to-text parameters

Sent as query string. Batch (`/v1/listen` POST) and streaming (`/v1/listen` WS) share
many, not all. "B" = batch, "S" = streaming.

| Param | Scope | Values / default | Notes |
|-------|-------|------------------|-------|
| `model` | B+S | `nova-3` (default here), `nova-3-general`, `nova-3-medical`, `nova-3-pharma`, `nova-2*`, `nova`, `enhanced`, `base`, `whisper-*` | **[UI]** model picker. Batch API default `base-general`; set explicitly |
| `language` | B+S | `en` (default), `multi`, BCP-47 codes | **[UI]** |
| `smart_format` | B+S | `true`/`false` (false) | formats dates, money, phone, etc. **[UI]** |
| `punctuate` | B+S | `true`/`false` (false) | punctuation + capitalization; auto-on with `paragraphs`/`detect_entities` **[UI]** |
| `diarize` | B+S | `true`/`false` (false) | **deprecated** — use `diarize_model` **[UI]** |
| `diarize_model` | B+S | `latest`, `v1`, `v2` (batch); streaming only `latest`/`v1` | enables diarization; `words[].speaker`, `speaker_confidence` (batch) |
| `numerals` | B+S | `true`/`false` (false) | numbers as digits **[UI]** |
| `filler_words` | B | `true`/`false` (false) | keep "uh", "um" |
| `profanity_filter` | B+S | `true`/`false` (false) | mask profanity |
| `redact` | B+S | `pci`, `pii`, `phi`, `numbers`, `aggressive_numbers`, `ssn`, entity types | redaction **[UI]**; Nova streaming 2-phase |
| `keyterm` | B+S | `term` (repeatable) | **Nova-3 + Flux only**; no weights; ≤500 tokens |
| `keywords` | B+S | `word:intensifier` (repeatable) | not Nova-3; ≤100; negative suppresses (Base) |
| `search` | B+S | `term` (repeatable) | hits in response; ≤50 |
| `replace` | B+S | `term:replacement` | find/replace; suggested ≤200 |
| `endpointing` | S | ms (10) | silence before a final result **[UI, live]** |
| `interim_results` | S | `true`/`false` (false) | partial transcripts **[UI, live]** |
| `vad_events` | S | `true`/`false` (false) | `SpeechStarted` events **[UI, live]** |
| `utterance_end_ms` | S | ms 1000–5000 | needs `interim_results=true` + `vad_events=true` |
| `encoding` | B+S | `linear16`, `linear32`, `flac`, `alaw`, `mulaw`, `amr-nb`, `amr-wb`, `opus`, `ogg-opus`, `speex`, `g729` | required for raw audio |
| `sample_rate` | S | e.g. `8000`…`48000` | required for raw audio |
| `channels` | S | int | channel count |
| `multichannel` | B+S | `true`/`false` | transcribe each channel separately |
| `dictation` | B+S | `true`/`false` | dictate mode |
| `paragraphs` | B+S | `true`/`false` | paragraph segmentation; auto-enables punctuation |
| `utterances` | B+S | `true`/`false` | semantic utterance units |
| `utt_split` | B | double (0.8) | pause seconds for a new utterance |
| `measurements` | B | `true`/`false` | spoken units → abbreviations |
| `detect_entities` | B+S | `true`/`false` | entity extraction (final results) |
| `detect_language` | B | `true`/`false`/list | dominant language |
| `sentiment`, `topics`, `intents`, `summarize` | B | bool / enum | Audio Intelligence (§ below) |
| `custom_topic`, `custom_intent` | B | repeatable (≤100) | with `_mode` `extended`/`strict` |
| `callback`, `callback_method` | B+S | URL / `POST`\|`PUT` | async delivery (S: http(s)/ws(s)) |
| `tag` | B+S | string (repeatable) | usage label; ≤128 chars, ≤500 unique/day |
| `extra` | B+S | string(s) | arbitrary metadata in response |
| `version` | B+S | `latest` | model version |
| `mip_opt_out` | B+S | `true`/`false` | opt out of model improvement |

**Streaming client → server messages:** binary audio frames, plus JSON
`{"type":"Finalize"}`, `{"type":"CloseStream"}`, `{"type":"KeepAlive"}`.
**Streaming server → client:** `Results` (`is_final`, `speech_final`, `channel.alternatives[0]`),
`Metadata`, `UtteranceEnd`, `SpeechStarted`.

## Flux (conversational STT) parameters

`wss://api.deepgram.com/v2/listen`, models `flux-general-en` / `flux-general-multi`.
Use `/v2/listen` — never `/v1/listen`.

| Param | Values / default | Notes |
|-------|------------------|-------|
| `model` | `flux-general-en`, `flux-general-multi` | multi covers en/es/fr/de/hi/ru/pt/ja/it/nl |
| `encoding` | `linear16`, `linear32`, `mulaw`, `alaw`, `opus`, `ogg-opus` | required for raw audio |
| `sample_rate` | e.g. `16000` | required for raw audio |
| `eot_threshold` | 0.5–1.0 (0.7) | confidence needed to end a turn |
| `eager_eot_threshold` | 0.3–0.9 (optional) | enables early `EagerEndOfTurn` prep |
| `eot_timeout_ms` | 500–60000 (5000) | force end-of-turn after silence |
| `keyterm` | repeatable | Nova-3-style boosting; updatable via `Configure` |
| `language_hint` | repeatable | flux-general-multi only; empty values rejected |
| `redact` | `numbers`, `aggressive_numbers` | **only these two** on Flux |
| `numerals`, `profanity_filter` | bool (false) | |
| `tag`, `mip_opt_out` | | |

**Client → server:** binary audio, `{"type":"CloseStream"}`,
`{"type":"ForceEndTurn"}`, `{"type":"Configure"}`.
**Server → client:** `Connected`, `TurnInfo`, `ConfigureSuccess`,
`ConfigureFailure`, `Error`. `TurnInfo.event` ∈
`Update` / `StartOfTurn` / `EagerEndOfTurn` / `TurnResumed` / `EndOfTurn`;
`trigger` on EndOfTurn ∈ `model` / `manual` / `timeout`.

## Text-to-speech parameters (Aura, `/v1/speak`)

| Param | Values / default | Notes |
|-------|------------------|-------|
| `model` | `aura-asteria-en` (API default); we default to `aura-2-thalia-en` | voice picker **[UI]** |
| `encoding` | REST `mp3` (default), `linear16`, `mulaw`, `alaw`, `flac`, `opus`, `aac`; WS `linear16` (default), `mulaw`, `alaw` | **[UI]** |
| `container` | REST only: default `wav` | pair `linear16`+`wav` for playable PCM **[UI]** |
| `sample_rate` | REST default `24000`; e.g. 8000–48000 | |
| `bit_rate` | REST, default `48000` | compressed formats |
| `speed` | `0.7`–`1.5` (1.0) | speaking rate |
| `callback`, `callback_method` | URL / `POST` | async audio delivery |
| `tag`, `mip_opt_out` | | |

**WS client messages:** `Speak`, `Flush`, `Clear`, `Close`.
**WS server events:** `Metadata`, `Flushed`, `Cleared`, `Warning`, binary audio.
**Aura-2 extras:** inline IPA pronunciation overrides (≤500/request, ≤128 chars IPA, en/es);
response headers `dg-pronunciations-applied`, `dg-speed-used`, `dg-pronunciation-warnings`.
`expressivity` is Flux-only.

**Limits:** 2000 chars/request (Aura); WS throughput 2400 chars/min; WS session
60 min; max 20 `Flush`/60 s.

## Flux TTS parameters (`/v2/speak`)

Newer, streaming-first, interruptible voice family. `model` is **required**
(`flux-{voice}-en`). Same voices on REST and WS.

| Param | Scope | Values / default | Notes |
|-------|-------|------------------|-------|
| `model` | REST+WS | `flux-{voice}-en` (required) | do not use Aura strings here |
| `encoding` | WS: `linear16` (default), `mulaw`, `alaw`; REST adds `mp3` (default), `opus`, `flac`, `aac` | |
| `sample_rate` | WS/REST | linear16 8000/16000/24000/32000/44100/48000; mulaw/alaw 8000/16000 | |
| `speed` | REST+WS | 0.5–1.5 in 0.05 steps | mid-session via WS `Configure` |
| `expressivity` | REST+WS | −2…2 whole numbers (0), **beta** | calm → animated |
| `bit_rate` | REST | e.g. mp3 8000–48000 | |
| `container` | REST | e.g. `wav`/`ogg` | |
| `callback`, `callback_method`, `priority` | REST | URL / `POST` / `Low` | async |
| `tag`, `mip_opt_out` | REST+WS | | |

**WS client messages:** `Speak`, `Flush`, `Interrupt`, `Configure`, `Close`.
**WS server events:** `Connected`, audio, `SpeechStarted`, `SpeechMetadata`,
`SpeechInterrupted` (`text_spoken`, `text_remaining`), `Flushed`,
`SessionMetadata`, `ConfigureSuccess`/`Failure`, `Warning`, `Error`.
**Limits:** WS session 1 h; idle 60 s; one `Interrupt` at a time.

## Voices (Aura-2, `[modelname]-[voice]-[language]`)
Languages: **en, es, de, fr, nl, it, ja**. Examples —
`aura-2-thalia-en`, `aura-2-helena-en` (caring), `aura-2-harmonia-en` (empathetic),
`aura-2-andromeda-en`, `aura-2-apollo-en`, `aura-2-zeus-en`,
`aura-2-estrella-es`, `aura-2-celeste-es`, `aura-2-draco-en` (British),
`aura-2-hyperion-en` (Australian). Aura-1 also exists (`aura-asteria-en`, …).
Flux voices are a **separate family** (`flux-haley-en`, `flux-kit-en`, …),
English-only today.

## Voice Agent
`wss://agent.deepgram.com/v1/agent/converse` — one socket for listen → think → speak.
`Settings` message: `{ audio, agent, ... }`; `agent.listen` (Deepgram Nova/Flux,
keyterms, EOT thresholds), `agent.think` (LLM provider/model/prompt/functions, object
or fallback array), `agent.speak` (Deepgram Aura, ElevenLabs, Cartesia, OpenAI, Polly).
Client control messages: `UpdateListen`/`UpdateThink`/`UpdateSpeak`/`UpdatePrompt`,
`InjectUserMessage`, `InjectAgentMessage`, `FunctionCallResponse`, `ForceEndTurn`,
`KeepAlive`. Server events include `ConversationText`, `UserStartedSpeaking`,
`AgentThinking`, `FunctionCallRequest`, `LatencyReport`, `Error`/`Warning`.
Sessions auto-close after 2 h. Function calls run client-side (no `endpoint`) or
server-side (with `endpoint`).

## Deepgram limits
Pre-recorded: max ~2 GB/file, 50 concurrent (Nova-3, PAYG), >10 min processing →
`504`. Streaming: 150 concurrent (Nova-3) / 50 with diarization. Whisper: 3 concurrent,
NA only. TTS REST: 15 concurrent; TTS WS: 45. Voice Agent: 45 concurrent.
Audio Intelligence: entities 5, sentiment/intent 10, summarization/topics 10.
Rate limit hits → `429` (exponential backoff). Limits are **per project**, not per key.
See `/reference/api-rate-limits`.

---

# OpenAI

## Models (GPT-5.6 family)

| Model | Tier | Input $/1M | Output $/1M |
|-------|------|-----------:|------------:|
| `gpt-5.6-sol` | flagship | 5.00 | 30.00 |
| `gpt-5.6-terra` | balanced | 2.00 | 12.00 |
| `gpt-5.6-luna` | cheapest/fastest (default here) | 0.20 | 1.20 |

Luna: 1.05M context (922K max input), 128K max output, text+image in, text out.
Knowledge cutoff Feb 16 2026. `gpt-5.6` alias → **Sol**, not Luna.

## Reasoning effort
`reasoning_effort`: `none`, `low`, `medium` (default), `high`, `xhigh`, `max`.
On the **Responses API** it's `reasoning: { effort: "medium" }`.

## Chat Completions parameters
`POST https://api.openai.com/v1/chat/completions`

| Param | Notes |
|-------|-------|
| `model` | **[UI]** Sol/Terra/Luna picker |
| `messages` | `[{role: system|user|assistant|tool, content}]` |
| `reasoning_effort` | **[UI]** |
| `max_completion_tokens` | cap on output |
| `response_format` | `{ "type": "json_object" }` or `json_schema` (structured outputs) — used by the Thinker |
| `tools` / `tool_choice` | function calling |
| `stream` / `stream_options` | SSE streaming |
| `seed` | best-effort determinism |
| `stop` | stop sequences |
| `logprobs` / `top_logprobs` | reasoning models may not support |
| `n` | number of choices |
| `presence_penalty` / `frequency_penalty` | may be unsupported on reasoning models |
| `temperature` / `top_p` | often unsupported on reasoning models — prefer `reasoning_effort` |
| `parallel_tool_calls` | |
| `store` / `metadata` / `user` | |
| `modalities` / `audio` | not for Luna |

## Responses API
`POST https://api.openai.com/v1/responses` — preferred for tools/agents
(`web_search`, `file_search`, `code_interpreter`, `mcp`, `computer_use`, …).

## Luna support matrix
✅ streaming, structured_outputs, function_calling, file_search, image_input,
web_search, prompt_caching.
❌ realtime, audio/speech, transcription, translation, embeddings, fine-tuning,
image generation, moderation.

> This is why the pipeline is split: **Deepgram does audio, Luna does reasoning.**

---

# What this UI wires up

The UI is a single call screen (`voice/public/`: `index.html`, `styles.css`,
`app.js`). Fixed in code there: STT model `nova-3` (streaming via `/ws/listen`,
interim results + VAD, endpointing 800 ms, silence-to-reply 1500 ms) and the
TTS voice `aura-2-helena-en`.

| Setting | Where |
|---------|-------|
| Participant picker → `/api/patients` | **[UI]** call screen |
| Streaming STT (nova-3, linear16, interims + VAD) | **[UI]** `/ws/listen` |
| TTS voice | **[UI]** `app.js` (`aura-2-helena-en`) |
| Mic mute / start / end call | **[UI]** call controls |
| Transcript (you + agent, incl. interims) | **[UI]** conversation pane |
| Grounding (patient record + tool lookups) | **[UI]** right pane, from `/api/brain/debug` |
| Brain/planner state + channel | **[UI]** right pane, from `/api/brain/debug` |
| Offline session log | browser event log + `GET /api/brain/log` → `voice/logs/<sessionId>.jsonl` |
| Talker patient-record preload | `voice/brain/agents/talker.js` (reloaded every turn) |
| Thinker/Planner + Talker model & effort | chosen in code: `voice/brain/config.js` |

## Try these quick experiments
1. **Diarize / redact / medical model** — these are server allow-listed params;
   try them with `curl` on `POST /api/transcribe` (e.g. `?redact=ssn` on
   "my social security number is…").
2. **`nova-3-medical`** vs `nova-3` on a sentence full of drug names (set
   `DEEPGRAM_STT_MODEL` or pass `?model=`).
3. **TTS voices** — swap the voice in `app.js` and compare.
4. **Grounding** — during a call, mention a drug; watch the right pane show the
   `health_search` result and any `check_prohibited` hit.
5. **Offline log** — run a call, then `GET /api/brain/log?sessionId=…` and
   inspect every turn including full tool-call results.

## References
- Deepgram: https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- Deepgram TTS: https://developers.deepgram.com/docs/tts-models
- Deepgram voices: https://developers.deepgram.com/docs/tts-models
- OpenAI Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- OpenAI Responses: https://developers.openai.com/api/docs/api-reference/responses
