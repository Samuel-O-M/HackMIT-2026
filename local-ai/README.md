# `local-ai` — offline STT + TTS for the voice agent

Replacements for the two closed API calls in `voice/server.js` (Deepgram STT/TTS)
using open weights that live **in the repo**:

| Role | Model | Weights | Runtime |
|------|-------|---------|---------|
| **TTS** | [`Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) | ~2.5 GB safetensors | `qwen-tts` (PyTorch) |
| **STT** | [`nvidia/parakeet-unified-en-0.6b`](https://huggingface.co/nvidia/parakeet-unified-en-0.6b) | ~2.5 GB `.nemo` | NVIDIA NeMo |

Both are ~0.6 B parameters, English, and run on **CPU** — no API key, no network
at inference time, nothing leaves the machine. Weights are downloaded into
`local-ai/models/` (gitignored) so they sit inside the repo but are not committed.

> **This folder is standalone and deliberately not wired in.** The existing
> Deepgram/OpenAI path in `voice/server.js` is untouched. See
> [Use it from the voice app](#use-it-from-the-voice-app) for the two-line switch.

## TL;DR — make it work

The weights are ~5 GB and **cannot be committed to GitHub** (2.5 GB per file vs.
GitHub's 100 MB limit), so a clone downloads them once:

```bash
git clone git@github.com:Samuel-O-M/HackMIT-2026.git && cd HackMIT-2026/local-ai
./setup.sh --test     # uv envs + weights (~5 GB); --test also runs the round-trip
```

Then start the servers (`tts/` on `:5002`, `stt/` on `:5001`) and follow
[Use it from the voice app](#use-it-from-the-voice-app).

## Layout

```
local-ai/
  setup.sh   one-shot: create both envs + download weights (see TL;DR)
  tts/    Qwen3-TTS wrapper + HTTP server + tests      (own uv env)
  stt/    Parakeet wrapper + HTTP server + tests       (own uv env)
  scripts/roundtrip.py   TTS -> wav -> STT cross-check
  models/  downloaded weights (gitignored)
  out/     generated audio (gitignored)
```

TTS and STT get **separate virtualenvs** on purpose: `qwen-tts` pins
`transformers==4.57.3`, NeMo expects its own lightning/hydra stack, and letting
them share an env is how you lose an afternoon. `uv` manages both.

## Prerequisites

- [`uv`](https://docs.astral.sh/uv/) (fetches Python 3.12 automatically)
- `ffmpeg` on `PATH` (only STT needs it, to decode webm/ogg/mp4)
- ~9 GB free disk for weights (~5 GB) + environments (~3.5 GB)

## Quick start

```bash
cd local-ai

# 1) TTS — install env, download weights, synthesise a few lines
cd tts
uv sync
uv run python download_model.py          # Qwen3-TTS-12Hz-0.6B-CustomVoice
uv run python test_tts.py                # -> ../out/tts_01.wav ... (also plays nothing; just files)
uv run python tts_server.py              # http://127.0.0.1:5002

# 2) STT — in another shell
cd ../stt
uv sync
uv run python download_model.py          # parakeet-unified-en-0.6b.nemo
uv run python test_stt.py                # transcribes everything in ../out/*.wav
uv run python stt_server.py              # http://127.0.0.1:5001

# 3) Cross-check: speak with TTS, listen with STT, score the match
cd ..
python3 scripts/roundtrip.py
```

## HTTP contracts (identical to `voice/server.js`)

Both servers mimic the endpoints the browser already calls, so the switch is
purely server-side.

**TTS** — `POST /api/tts` with `{"text": "..."}` → `audio/wav` bytes.
Optional query params: `speaker=` (CustomVoice), `language=`, `instruct=`.
Deepgram-only params (`model`, `encoding`, `container`, …) are ignored, so the
existing request URLs keep working.

```
GET  /api/health   -> { ok, provider, mode, device, speakers, languages }
```

**STT** — `POST /api/transcribe` with raw audio bytes (webm/ogg/mp4/wav) **or**
`{"url": "..."}` → `{"transcript": "...", "raw": {...}, "params": {...}}`.

```
GET  /api/health   -> { ok, provider, modelPath, loaded, device }
```

## Use it from the voice app

The browser always talks to `voice/server.js`; only the upstream provider call
changes. Both handlers in `voice/server.js` already have a comment marking the
spot (`LOCAL-AI HOOK`).

**TTS** — in `handleTts` (~line 249), swap the Deepgram request for the local one:

```js
const url = `${process.env.LOCAL_TTS_URL || 'http://127.0.0.1:5002'}/api/tts?${params}`;
const dgRes = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text }),
});
```

**STT (batch)** — in `handleTranscribe` (~line 196), point both `fetch(...)` calls
inside `https://api.deepgram.com/v1/listen` at
`http://127.0.0.1:5001/api/transcribe` and drop the `Authorization` header.

Then set the env vars (optional) and restart:

```bash
# repo-root .env
LOCAL_TTS_URL=http://127.0.0.1:5002
LOCAL_STT_URL=http://127.0.0.1:5001
```

No browser code changes. To pick a voice, change the query in
`voice/public/app.js` (~line 534) from `?model=aura-2-helena-en` to
`?speaker=Aiden` (English voices: `Aiden`, `Ryan`).

### What is *not* wired: live streaming STT

The call screen uses `/ws/listen` — a WebSocket proxy to Deepgram's streaming
API (`voice/server.js` ~line 893). Parakeet-unified does support buffered
streaming in NeMo, but a faithful drop-in needs a WebSocket server and, on CPU,
is well behind real time. The batch `/api/transcribe` path works today; live
streaming is a follow-up.

## Test machine (full disclosure)

Everything below was measured on this laptop — deliberately not a server:

| | |
|---|---|
| Laptop | Lenovo ThinkPad X1 Yoga Gen 8 (model `21HRS06Q00`) |
| CPU | 13th Gen Intel Core i7-1355U — 10 cores / 12 threads (2 P-cores + 8 E-cores), 15 W U-series, up to 5.0 GHz |
| GPU | Intel Iris Xe (integrated) — **no NVIDIA/CUDA GPU at all** |
| RAM | 15 GiB total, and only ~3 GiB free during the runs (the rest was held by other apps) |
| OS | Fedora Linux 44 Workstation, kernel 7.2.5-200.fc44.x86_64, x86_64 |
| Storage | NVMe SSD |

In other words: a thin-and-light ultrabook, run under memory pressure — about as
weak a target as this code will ever see.

## Real-time expectation

The numbers below are the CPU-only **floor**, not the ceiling. Both models are
designed for real-time use:

- **Any even slightly more powerful laptop — and in particular any laptop with a
  discrete GPU or Apple Silicon — runs both of these in real time, with margin.**
  Qwen3-TTS-12Hz is built for streaming (~97 ms first-packet latency on a GPU),
  and Parakeet already runs at ~0.5× real time *on this GPU-less CPU alone*.
- A CPU-only laptop would need to be many times faster than this one to make TTS
  interactive; any accelerator clears the bar easily. Going to a GPU also unlocks
  NeMo's streaming pipeline and `flash-attn`, and drops TTS from ~25 s/clause to
  a few hundred ms.

## Measured performance (this laptop, worst case)

| Step | Load | Inference | Notes |
|------|------|-----------|-------|
| Parakeet STT | ~20–45 s | **~0.5× realtime** (RTF ≈ 0.5) | 13.7 s clip → ~7 s; 2–4 s clips → ~2–3 s |
| Qwen3-TTS TTS | ~35 s | **~25× realtime** (RTF ≈ 24–28) | 4 s of audio ≈ 100–125 s |

So on *this* box STT is already usable and TTS is not interactive — the round-trip
itself works and is accurate, it is just slow to synthesise without a GPU. On a
GPU machine, drop the CPU-only index in each `pyproject.toml` to get CUDA wheels.

## Verified

Ran in this repo on 2026-09-20 (CPU): `test_tts.py` produced 3 WAVs,
`test_stt.py` transcribed them back, and `scripts/roundtrip.py` scored the
matches. Example round-trip:

| spoken (Qwen3-TTS) | heard (Parakeet) |
|---|---|
| Hello, this is a local text to speech test. | Hello, this is a local text-to-speech test |
| How has the new medicine been going for you? | How has the new medicine been going for you |
| Okay, thanks. I've made a note of that for the study team. | Okay, thanks. I've made a note of that for the study team |

## Notes

- Weights are loaded from `local-ai/models/` when present, otherwise the HF id is
  used as a fallback (which downloads on first load).
- `LOCAL_AI_DEVICE`, `LOCAL_AI_THREADS` tune device/threads.
- `LOCAL_TTS_MODE=base` + a reference clip switches TTS to 3-second voice cloning
  (`generate_voice_clone`) instead of the built-in CustomVoice speakers.

### Benign warnings on CPU

- `SoX could not be found!` — the `sox` PyPI package prints this at import when
  the system binary is absent. We write WAV with `soundfile`, so it is harmless;
  `dnf install sox` silences it.
- `flash-attn is not installed` — expected; flash-attn is GPU-only and we pin
  `sdpa` on CPU.
- The Parakeet checkpoint ships `validation_ds: null`, which NeMo 3.0 reads
  unguarded during batch transcribe. `local_stt.py` patches this in `load()`
  (see the comment there) — no action needed.
