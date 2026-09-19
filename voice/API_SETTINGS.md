# API Settings Reference — Deepgram + OpenAI

Everything both providers expose, and what this UI actually wires up.
Legend: **[UI]** = exposed in the test area · **[brain]** = used by the two-agent product.

---

# Deepgram

## Auth
- Header: `Authorization: Token <API_KEY>` (all calls over HTTPS).
- Key check: `GET https://api.deepgram.com/v1/auth/token`.
- Temporary tokens: `POST https://api.deepgram.com/v1/auth/grant` (`{"ttl_seconds":30}`)
  → `{ access_token, expires_in }`. Requires a Member+ key. Our key returns
  `403 FORBIDDEN: Insufficient permissions`, so this UI proxies the WebSocket
  **server-side** instead (`/ws/listen`).

## Endpoints

| Purpose | Method | Endpoint |
|---------|--------|----------|
| Pre-recorded STT | POST | `https://api.deepgram.com/v1/listen` |
| Streaming STT | WS | `wss://api.deepgram.com/v1/listen` |
| Conversational STT (Flux) | WS | `wss://api.deepgram.com/v2/listen` |
| TTS (one-shot) | POST | `https://api.deepgram.com/v1/speak` |
| TTS (streaming) | WS | `wss://api.deepgram.com/v1/speak` |
| Voice Agent | WS | see `/docs/voice-agent` |

## Speech-to-text parameters

Sent as query string. Streaming (`v1`) and Flux (`v2`) share many, not all.

| Param | Values / default | Notes |
|-------|------------------|-------|
| `model` | `nova-3` (default here), `nova-3-general`, `nova-3-medical`, `nova-2*`, `nova`, `enhanced`, `base`, `whisper-*` | **[UI]** model picker |
| `language` | `en` (default), `multi`, BCP-47 codes | **[UI]** |
| `smart_format` | `true`/`false` (false) | formats dates, money, phone, etc. **[UI]** |
| `punctuate` | `true`/`false` (false) | punctuation + capitalization **[UI]** |
| `diarize` | `true`/`false` (false) | speaker labels; `diarize_model=latest|v1` **[UI]** |
| `numerals` | `true`/`false` (false) | numbers as digits **[UI]** |
| `profanity_filter` | `true`/`false` (false) | mask profanity |
| `redact` | `pci`, `numbers`, `aggressive_numbers`, `ssn` | redaction **[UI]** |
| `keywords` | `word:boost` (repeatable) | keyword boosting |
| `keyterm` | `term` (repeatable) | nova-3 preferred boosting |
| `search` | `term` (repeatable) | include hits in response |
| `replace` | `term:replacement` | find/replace |
| `endpointing` | ms (10) | silence before a final result **[UI, live]** |
| `interim_results` | `true`/`false` (false) | partial transcripts **[UI, live]** |
| `vad_events` | `true`/`false` (false) | `SpeechStarted` events **[UI, live]** |
| `utterance_end_ms` | ms (1000) | needs `interim_results=true` + `vad_events=true` |
| `encoding` | `linear16`, `linear32`, `flac`, `alaw`, `mulaw`, `amr-nb`, `amr-wb`, `opus`, `ogg-opus`, `speex`, `g729` | required for raw audio |
| `sample_rate` | e.g. `8000`…`48000` | required for raw audio |
| `channels` | int | channel count |
| `multichannel` | `true`/`false` | transcribe each channel separately |
| `dictation` | `true`/`false` | dictate mode |
| `detect_entities` | `true`/`false` | entity extraction in final results |
| `callback`, `callback_method` | URL / `POST` | async delivery (batch) |
| `tag` | string (repeatable) | tag requests |
| `version` | `latest` | model version |
| `mip_opt_out` | `true`/`false` | opt out of model improvement |

**Streaming client → server messages:** binary audio frames, plus JSON control
messages `{"type":"Finalize"}`, `{"type":"CloseStream"}`, `{"type":"KeepAlive"}`.
**Server → client:** `Results` (`is_final`, `speech_final`, `channel.alternatives[0]`),
`Metadata`, `UtteranceEnd`, `SpeechStarted`.

## Text-to-speech parameters

| Param | Values / default | Notes |
|-------|------------------|-------|
| `model` | `aura-asteria-en` (API default); we default to `aura-2-thalia-en` | voice picker **[UI]** |
| `encoding` | `mp3` (default), `linear16`, `mulaw`, `alaw`, `flac`, `opus`, `aac` | **[UI]** |
| `container` | none/mp3, `wav`, `ogg` | pair `linear16`+`wav` for playable PCM **[UI]** |
| `sample_rate` | e.g. `8000`…`48000` | |
| `bit_rate` | e.g. `32000`…`128000` | for compressed formats |
| `speed` | e.g. `0.7`–`1.5` | speaking rate |
| `callback` | URL | async audio delivery |
| `mip_opt_out` | `true`/`false` | |

**Limits:** 2000 chars/request (Aura); WS throughput 2400 chars/min; WS session
60 min; max 20 `Flush`/60 s.

## Voices (Aura-2, `[modelname]-[voice]-[lang]`)
Languages: **en, es, de, fr, nl, it, ja**. Examples —
`aura-2-thalia-en`, `aura-2-helena-en` (caring), `aura-2-harmonia-en` (empathetic),
`aura-2-andromeda-en`, `aura-2-apollo-en`, `aura-2-zeus-en`,
`aura-2-estrella-es`, `aura-2-celeste-es`, `aura-2-draco-en` (British),
`aura-2-hyperion-en` (Australian). Aura-1 also exists (`aura-asteria-en`, …).

## Flux (conversational STT)
`wss://api.deepgram.com/v2/listen`, models `flux-general-en` / `flux-general-multi`.
~~Use `/v2/listen`, never `/v1/listen` for Flux.~~ Tuning: `eot_threshold`
(0.5–1.0, 0.7), `eager_eot_threshold` (0.3–0.9), `eot_timeout_ms`
(500–60000, 5000). Send ~80 ms chunks.

## Deepgram limits
Pre-recorded: max 2 GB/file, ~100 concurrent, >10 min (Nova) → `504`.
Rate limit hits → `429`. See `/reference/api-rate-limits`.

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

| Setting | Where |
|---------|-------|
| STT model / language / smart_format / punctuate / diarize / numerals / redact | **[UI]** STT settings card (batch **and** live) |
| `interim_results`, `vad_events`, `endpointing` | **[UI]** live STT card |
| TTS voice / encoding / container | **[UI]** Text→Speech card |
| OpenAI model + reasoning effort | **[UI]** Chat card (test area) |
| Thinker/Planner + Talker model & effort | chosen in code: `voice/brain/config.js` |
| Live STT | proxied via `/ws/listen` (key never leaves the server) |

## Try these quick experiments
1. **Batch vs live**: record on the batch card, then read the same sentence on
   the live card — compare interim vs final output and latency.
2. **`nova-3-medical`** vs `nova-3` on a sentence full of drug names.
3. **`redact=ssn`** on "my social security number is…".
4. **Diarize** a two-person clip and inspect `words[].speaker`.
5. **TTS**: same text across voices; `linear16`+`wav` vs default `mp3`.
6. **Chat**: same prompt at `reasoning_effort` low → max; watch quality/latency.

## References
- Deepgram: https://developers.deepgram.com/reference/speech-to-text/listen-streaming
- Deepgram TTS: https://developers.deepgram.com/docs/tts-models
- Deepgram voices: https://developers.deepgram.com/docs/tts-models
- OpenAI Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- OpenAI Responses: https://developers.openai.com/api/docs/api-reference/responses
