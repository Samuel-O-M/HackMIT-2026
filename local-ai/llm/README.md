<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# llm — local Gemma 4 E4B Q4 for the brain

> Serves **Gemma 4 E4B Q4** behind an OpenAI-compatible endpoint, so the brain
> can run without OpenAI and without the network.

Part of **[ReconMed](../../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. This folder is a drop-in, fully offline
alternative to the OpenAI path in [`voice/brain/`](../../voice/brain/). It is
**not wired in**: the brain still runs GPT-5.6 Luna by default, and switching is
three small edits (below).

| | |
|---|---|
| Model | [`google/gemma-4-E4B-it-qat-q4_0-gguf`](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf) — QAT **Q4_0**, 5.15 GB |
| Size | 4.5 B effective (8 B with embeddings), 128K context, 262K vocab |
| Why this one | **native function calling** and a native `system` role — the brain is tool-driven |
| Runtime | llama.cpp `llama-server` (CPU, prebuilt), OpenAI `/v1/chat/completions` |

## Quick start

```bash
cd local-ai/llm
uv sync && uv run python download_model.py   # ~5 GB GGUF; no network after this
./run_server.sh                              # -> http://127.0.0.1:5003
python3 test_llm.py                          # tool-calling smoke test
```

Or from the parent folder, `./setup.sh --with-llm` also fetches this model
alongside the speech models. `run_server.sh` downloads a pinned llama.cpp build
(`b11060`) into `runtime/` on first run — no compiler needed — and serves with
`--jinja`, which applies Gemma 4's own chat template. That flag is what turns its
function calls into OpenAI `tool_calls`; without it the model still talks, but
the tool calls come back as plain text.

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#endpoints">Endpoints</a></li>
    <li><a href="#switch-the-brain-to-gemma">Switch the brain to Gemma</a></li>
    <li><a href="#differences-from-luna">Differences from Luna</a></li>
    <li><a href="#measured">Measured</a></li>
    <li><a href="#files">Files</a></li>
    <li><a href="#notes">Notes</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

## Endpoints

llama.cpp's OpenAI-compatible API, and nothing else:

```
POST /v1/chat/completions   chat, with `tools` (function calling) and streaming
GET  /v1/models
```

The request and response shapes are exactly OpenAI's, so the brain's existing
client — tools, `tool_choice`, streamed `tool_calls` deltas, the tool loop —
needs no changes. That is the whole reason this is a viable swap.

## Switch the brain to Gemma

Three edits, each marked `LOCAL-LLM HOOK` in the source:

1. **`voice/brain/config.js`** — point both models at the local alias and drop
   the reasoning effort (llama.cpp has no `reasoning_effort`):

   ```js
   const MODEL = 'gemma-4-e4b';
   const talkerEffort = null;
   const plannerEffort = null;
   ```

2. **`voice/brain/lib/openai.js`** — send requests to the local base URL and drop
   the `Authorization` header:

   ```js
   const base = process.env.OPENAI_BASE_URL || 'http://127.0.0.1:5003/v1';
   return fetchWithRetry(`${base}/chat/completions`, { ... });
   ```

   The key guard at the top of `chat()` / `chatWithTools*()` only checks that a
   key is *present*, so set `OPENAI_API_KEY=local` in the repo-root `.env`.

3. Restart `npm run voice`.

For the plain chat proxy (`POST /api/chat`) there is a matching hook in
`voice/server.js`. Nothing else changes.

## Differences from Luna

- **No `reasoning_effort`**, and `response_format: json_object` is only partly
  supported — the brain already has a `parseJson` fallback, so this is fine.
- A 4.5 B model is **not Luna**. Expect rougher tool selection and phrasing and
  more retries. This answers "does it fit at all", not "is it as good".
- **CPU-only is slow** (numbers below). On any GPU the rounds drop well under a
  second.

## Measured

This laptop: **i7-1355U (10 cores), integrated Iris Xe — no CUDA, no GPU**.

| Step | Result |
|---|---|
| Model load (mmap, 5.15 GB) | **< 7 s** |
| Prompt processing | ~24 tok/s |
| Generation | ~5–6 tok/s (~175–195 ms/token) |
| `test_llm.py` end-to-end | **84.6 s, 2 tool calls, PASS** |

The 84.6 s is three rounds — `health_search` → `check_prohibited` → final
sentence — so a complete tool-then-answer turn is roughly 20–40 s per round
here. That is fine for the async **Planner** and too slow for the realtime
**Talker**, which is precisely why this is a "can it stand in at all"
experiment rather than the default.

The smoke test drives the brain's real tool loop, so a pass means the model
chose the right tool, then used its result, then answered — not that it merely
returned valid JSON.

## Files

| File | Purpose |
|------|---------|
| `download_model.py` | Fetches the GGUF into `local-ai/models/` (resumable, ~5 GB) |
| `get_llama_cpp.sh` | Downloads a prebuilt `llama-server` into `runtime/` (pinned build) |
| `run_server.sh` | Serves the model on `:5003` with `--jinja`; fetches the runtime if missing |
| `test_llm.py` | Tool-calling smoke test; standard library only |
| `pyproject.toml` | The (tiny) uv env — `huggingface_hub` for the downloader |

## Notes

- Weights land in `local-ai/models/` and llama.cpp binaries in
  `local-ai/llm/runtime/`; both are gitignored, so a clone downloads them once.
- **Env knobs:** `LOCAL_LLM_PORT` (5003), `LOCAL_LLM_CTX` (8192),
  `LOCAL_LLM_ALIAS` (`gemma-4-e4b`), `LOCAL_LLM_THREADS`, `GEMMA_GGUF`,
  `LLAMA_CPP_BUILD`.
- **Fallback model** (smaller, ~3.2 GB, but **no native tool calling** — the
  brain's tools will be unreliable): `uv run python download_model.py --model
  gemma3-4b`, then
  `GEMMA_GGUF=../models/gemma-3-4b-it-q4_0/gemma-3-4b-it-q4_0.gguf ./run_server.sh`.

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
