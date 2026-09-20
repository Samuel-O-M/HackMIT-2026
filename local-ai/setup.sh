#!/usr/bin/env bash
#
# One-shot setup for local-ai: create both uv environments and download the
# model weights into ./models (they can't live on GitHub — 2.5 GB each).
#
#   ./setup.sh          # install envs + download weights (~5 GB, needs network)
#   ./setup.sh --test   # ...then run the TTS -> STT round-trip (slow on CPU)
#
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: 'uv' not found. Install it: https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi
command -v ffmpeg >/dev/null 2>&1 || echo "warning: ffmpeg not found — STT needs it to decode webm/ogg/mp4" >&2

echo "==> [1/2] TTS: Qwen3-TTS-12Hz-0.6B-CustomVoice (~2.5 GB)"
( cd tts && uv sync && uv run python download_model.py )

echo "==> [2/2] STT: nvidia/parakeet-unified-en-0.6b (~2.5 GB)"
( cd stt && uv sync && uv run python download_model.py )

echo "==> weights ready in $(pwd)/models"
echo
echo "Serve them:"
echo "  (cd tts && uv run python tts_server.py)   # http://127.0.0.1:5002  POST /api/tts"
echo "  (cd stt && uv run python stt_server.py)   # http://127.0.0.1:5001  POST /api/transcribe"

if [[ "${1:-}" == "--test" ]]; then
  echo
  echo "==> round-trip test (TTS -> wav -> STT); expect several minutes on CPU"
  python3 scripts/roundtrip.py
fi
