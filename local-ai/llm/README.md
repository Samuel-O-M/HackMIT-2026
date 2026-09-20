# `local-ai/llm` — local Gemma 4 E4B Q4 for the brain

A drop-in, **OpenAI-compatible** chat model to stand in for **GPT-5.6 Luna**
(the `MODEL` in `voice/brain/config.js`). Standalone and **not wired in** — the
brain still runs Luna by default; switching is two lines (below).

| | |
|---|---|
| Model | [`google/gemma-4-E4B-it-qat-q4_0-gguf`](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf) (~5.2 GB, QAT Q4_0) |
| Size | 4.5 B effective (8 B with embeddings), 128K context |
| Why this one | **native function calling** + native `system` role — the brain is tool-driven |
| Runtime | llama.cpp `llama-server` (CPU, prebuilt), OpenAI `/v1/chat/completions` |

## Quick start

```bash
cd local-ai/llm
uv sync && uv run python download_model.py   # ~5 GB GGUF
./run_server.sh                              # -> http://127.0.0.1:5003
python3 test_llm.py                          # tool-calling smoke test
```

`run_server.sh` fetches the pinned llama.cpp build (b11060) into `runtime/` on
first run (no compiler needed) and serves with `--jinja`, which applies Gemma 4's
own chat template — the part that turns its function calls into OpenAI
`tool_calls`.

## Endpoints

llama.cpp's OpenAI-compatible API:

```
POST /v1/chat/completions   chat, with `tools` (function calling) and streaming
GET  /v1/models
```

## Switch the brain to Gemma

Three small edits, all marked `LOCAL-LLM HOOK` in the source:

1. **`voice/brain/config.js`** — `const MODEL = 'gemma-4-e4b';` and set
   `talkerEffort` / `plannerEffort` to `null` (llama.cpp has no `reasoning_effort`).
2. **`voice/brain/lib/openai.js`** — point the URL at
   `${process.env.OPENAI_BASE_URL || 'http://127.0.0.1:5003/v1'}/chat/completions`
   and drop the `Authorization` header. Then set `OPENAI_API_KEY=local` in the
   repo-root `.env`, because the guard only checks that a key is *present*.
3. Restart `npm run voice`.

For the plain chat proxy (`POST /api/chat`) there is a matching hook in
`voice/server.js`. Nothing else changes: tools, `tool_choice`, the streaming
tool-call deltas and the tool loop are already OpenAI-shaped.

## Differences from Luna

- **No `reasoning_effort`**, and `response_format: json_object` is only partly
  supported (the brain already has a `parseJson` fallback).
- A 4.5 B model is **not** Luna: expect rougher tool selection and phrasing,
  and more retries. This is a "does it fit at all", not a quality match.
- **CPU-only is slow.** Measured below; on any GPU it is dramatically faster.

## Measured (this laptop: i7-1355U, no GPU, ~6 GiB RAM free)

| Step | Result |
|---|---|
| Model load (mmap, 5.15 GB) | **< 7 s** |
| Prompt processing | ~24 tok/s |
| Generation | ~5–6 tok/s (~175–195 ms/token) |
| `test_llm.py` end-to-end | **84.6 s, 2 tool calls, PASS** |

The 84.6 s is three rounds — `health_search` → `check_prohibited` → final
sentence — so a full tool-then-answer turn is roughly 20–40 s per round on this
CPU. That is fine for the async **Planner**; it is too slow for the realtime
**Talker**, which is why this is a "can it stand in at all" experiment. On any
GPU these rounds drop to well under a second.

## Notes

- Weights download into `local-ai/models/` and the llama.cpp binaries into
  `local-ai/llm/runtime/`; both are gitignored.
- `--jinja` is required for function calling. Without it the model still runs,
  but tool calls come back as plain text.
- Env knobs: `LOCAL_LLM_PORT` (5003), `LOCAL_LLM_CTX` (8192), `LOCAL_LLM_ALIAS`
  (`gemma-4-e4b`), `LOCAL_LLM_THREADS`, `GEMMA_GGUF`, `LLAMA_CPP_BUILD`.
- Fallback model (smaller, **no native tools**): `uv run python download_model.py
  --model gemma3-4b` and `GEMMA_GGUF=../models/gemma-3-4b-it-q4_0/gemma-3-4b-it-q4_0.gguf ./run_server.sh`.
