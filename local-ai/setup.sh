#!/usr/bin/env bash
#
# One-shot setup for local-ai: create the uv environments and download the model
# weights into ./models (they can't live on GitHub — 2.5–5 GB per file).
#
#   ./setup.sh                # TTS + STT envs and weights (~5 GB)
#   ./setup.sh --with-llm     # also Gemma 4 E4B Q4 for the brain (~5 GB more)
#   ./setup.sh --test         # then run the TTS -> STT round-trip (slow on CPU)
#
set -euo pipefail
cd "$(dirname "$0")"

WITH_LLM=0
RUN_TEST=0
for arg in "$@"; do
  case "$arg" in
    --with-llm) WITH_LLM=1 ;;
    --test) RUN_TEST=1 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if ! command -v uv >/dev/null 2>&1; then
  echo "error: 'uv' not found. Install it: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi
command -v ffmpeg >/dev/null 2>&1 || echo "warning: ffmpeg not found — STT needs it to decode webm/ogg/mp4" >&2

echo "==> [1/3] TTS: Qwen3-TTS-12Hz-0.6B-CustomVoice (~2.5 GB)"
( cd tts && uv sync && uv run python download_model.py )

echo "==> [2/3] STT: nvidia/parakeet-unified-en-0.6b (~2.5 GB)"
( cd stt && uv sync && uv run python download_model.py )

if [[ "$WITH_LLM" == 1 ]]; then
  echo "==> [3/3] LLM: Gemma 4 E4B Q4 (~5 GB)"
  ( cd llm && uv sync && uv run python download_model.py )
else
  echo "==> [3/3] LLM: skipped (pass --with-llm for Gemma 4 E4B Q4, ~5 GB)"
fi

echo
echo "==> weights ready in $(pwd)/models"
echo "Serve them:"
echo "  (cd tts && uv run python tts_server.py)   # TTS  http://127.0.0.1:5002  POST /api/tts"
echo "  (cd stt && uv run python stt_server.py)   # STT  http://127.0.0.1:5001  POST /api/transcribe"
[[ "$WITH_LLM" == 1 ]] && echo "  (cd llm && ./run_server.sh)               # LLM  http://127.0.0.1:5003  /v1/chat/completions"

if [[ "$RUN_TEST" == 1 ]]; then
  echo
  echo "==> round-trip test (TTS -> wav -> STT); expect several minutes on CPU"
  python3 scripts/roundtrip.py
fi
