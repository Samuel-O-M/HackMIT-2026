# Deepgram Usage Notes

Concise reference for using Deepgram (STT, TTS, Voice Agents) in this project.
Sources are linked at the bottom. Deepgram does **not** store transcripts — save
whatever you need at request time.

---

## 1. Authentication

- Every request needs an API key in the `Authorization` header:
  ```
  Authorization: Token <DEEPGRAM_API_KEY>
  ```
- All calls must be over **HTTPS**; plain HTTP or missing auth will fail.
- Keys are managed in the [Console](https://console.deepgram.com).
- **Secret handling (this repo):** the key lives in the root `.env` as
  `DEEPGRAM_API_KEY`, which is gitignored. Use a placeholder in docs/code,
  never the real key.
- **Never** put the key in browser/client code (`NEXT_PUBLIC_*`). For frontend
  audio, proxy through a server route or issue short-lived tokens via the
  [Auth API](https://developers.deepgram.com/reference/auth/tokens/grant).
- Quick key check:
  ```bash
  curl https://api.deepgram.com/v1/auth/token \
    -H "Authorization: Token $DEEPGRAM_API_KEY"
  ```

---

## 2. Core APIs

| Need | API | Endpoint |
|------|-----|----------|
| Transcribe a file | Pre-recorded STT | `POST https://api.deepgram.com/v1/listen` |
| Transcribe live audio | Streaming STT | `wss://api.deepgram.com/v1/listen` |
| Conversational STT (turn detection) | Flux | `wss://api.deepgram.com/v2/listen` |
| Text → speech (one-shot) | TTS REST | `POST https://api.deepgram.com/v1/speak` |
| Text → speech (streamed) | TTS WebSocket | `wss://api.deepgram.com/v1/speak` |
| Full listen/think/speak pipeline | Voice Agent | WebSocket (see docs) |

> Flux **must** use `/v2/listen`; `/v1/listen` will not work with Flux models.

---

## 3. Pre-recorded speech-to-text

Remote file:
```bash
curl -X POST \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://dpgr.am/spacewalk.wav"}' \
  "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true"
```

Local file:
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
plus `.confidence` and a `.words[]` array with `start`/`end` timestamps.

Useful query params: `model`, `language`, `smart_format`, `punctuate`,
`diarize`, `utterances`, `paragraphs`, `keywords`, `redact`.

**Limits:** max 2 GB/file; ~100 concurrent requests; requests over 10 min
(Nova/Base/Enhanced) return `504`.

---

## 4. Streaming speech-to-text (real time)

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

Key response fields: `is_final` (interim vs final), `speech_final` (natural end
of speech), `channel.alternatives[0].transcript`.

Extras: send periodic **KeepAlive** messages to hold an idle socket open; use
**Endpointing** / **Interim Results** for turn-taking.

---

## 5. Flux (conversational STT for voice agents)

Built for turn-taking with model-native end-of-turn detection (~260 ms),
word-level timestamps, and Nova-3-level accuracy.

- Endpoint: `wss://api.deepgram.com/v2/listen`
- Models: `flux-general-en` (English) or `flux-general-multi`
  (en, es, fr, de, hi, ru, pt, ja, it, nl).
- Send **~80 ms audio chunks** (e.g. 2560 bytes of 16 kHz linear16) for best
  latency. For raw audio you **must** set `encoding` and `sample_rate`
  (`linear16`, `16000` recommended).

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

Turn-tuning params: `eot_threshold` (0.5–1.0, default 0.7),
`eager_eot_threshold` (0.3–0.9, optional, enables early LLM response),
`eot_timeout_ms` (500–60000, default 5000).

---

## 6. Text-to-speech

REST (one-shot), returns audio bytes (MP3 by default):
```bash
curl -X POST \
  -H "Authorization: Token $DEEPGRAM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, how can I help you today?"}' \
  --output out.mp3 \
  "https://api.deepgram.com/v1/speak?model=aura-2-thalia-en"
```

WebSocket (streamed), for low-latency/LLM output:
```jsonc
// send
{ "type": "Speak", "text": "Your text to speak" }
{ "type": "Flush" }   // triggers audio generation
{ "type": "Close" }
```
Audio arrives as a byte stream in the configured `encoding`.

Voices: Aura-2 family, e.g. `aura-2-thalia-en` (default `aura-asteria-en`).
See [Voices & Languages](https://developers.deepgram.com/docs/tts-models).

**Limits:** max 2000 chars per request (Aura); WS throughput 2400 chars/min;
WS session timeout 60 min; max 20 `Flush` per 60 s.

---

## 7. Voice Agent API

Handles the whole pipeline (listen → think → speak). Useful if we want a
low-latency conversational agent without wiring STT+LLM+TTS manually.

- WebSocket protocol; configurable STT model, LLM provider, TTS voice,
  endpointing, and audio format.
- Supports function calling, multi-agent handoff, telephony, and a Browser
  Agent SDK.
- Start here: [Build a Voice Agent](https://developers.deepgram.com/docs/build-a-voice-agent).

---

## 8. Models & languages

| Model | Use |
|-------|-----|
| `flux-general-en` / `flux-general-multi` | Real-time conversational agents with turn detection |
| `nova-3` (`nova-3-general`) | Highest-accuracy general ASR (batch or streaming); 30+ languages, `multi` code-switching |
| `nova-2` | Languages not yet on nova-3; filler words |
| `whisper-*` | Deepgram-hosted Whisper (lower scale, extra limits) |
| `aura-2-*` | TTS voices |

All models default to `language=en` unless specified.

---

## 9. SDKs

JavaScript `@deepgram/sdk` · Python `deepgram-sdk` · Go · .NET · Java.
See links below. Without an SDK, see the
[recipes repo](https://github.com/deepgram/recipes).

---

## 10. References

- Docs home / index: https://developers.deepgram.com/docs/introduction
- Full docs index for LLMs: https://developers.deepgram.com/llms.txt
- Authentication: https://developers.deepgram.com/docs/authenticating
- Pre-recorded audio: https://developers.deepgram.com/docs/pre-recorded-audio
- Live streaming audio: https://developers.deepgram.com/docs/live-streaming-audio
- Flux quickstart: https://developers.deepgram.com/docs/flux/quickstart
- Text-to-speech (REST): https://developers.deepgram.com/docs/text-to-speech
- Streaming TTS (WebSocket): https://developers.deepgram.com/docs/streaming-text-to-speech
- Voice Agent API: https://developers.deepgram.com/docs/voice-agent
- Models & languages: https://developers.deepgram.com/docs/models-languages-overview
- TTS voices: https://developers.deepgram.com/docs/tts-models
- API reference: https://developers.deepgram.com/reference/deepgram-api-overview
- Rate limits: https://developers.deepgram.com/reference/api-rate-limits
- JS SDK: https://github.com/deepgram/deepgram-js-sdk
- Python SDK: https://github.com/deepgram/deepgram-python-sdk
