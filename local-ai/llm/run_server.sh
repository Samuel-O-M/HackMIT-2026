#!/usr/bin/env bash
#
# Serve Gemma 4 E4B Q4 with llama.cpp's OpenAI-compatible server.
#
#   POST http://127.0.0.1:5003/v1/chat/completions   (chat + tools)
#   GET  http://127.0.0.1:5003/v1/models
#
# --jinja makes llama.cpp apply the model's own chat template, which is what
# turns Gemini-style function calls into OpenAI `tool_calls` objects.
#
set -euo pipefail
cd "$(dirname "$0")"

MODEL="${GEMMA_GGUF:-../models/gemma-4-e4b-it-q4_0/gemma-4-E4B_q4_0-it.gguf}"
PORT="${LOCAL_LLM_PORT:-5003}"
CTX="${LOCAL_LLM_CTX:-8192}"
ALIAS="${LOCAL_LLM_ALIAS:-gemma-4-e4b}"
THREADS="${LOCAL_LLM_THREADS:-$(nproc)}"

if [[ ! -f "$MODEL" ]]; then
  echo "model not found: $MODEL" >&2
  echo "get it first:  uv sync && uv run python download_model.py" >&2
  exit 1
fi

SERVER="$(find runtime -name llama-server -type f 2>/dev/null | head -1 || true)"
if [[ -z "$SERVER" ]]; then
  ./get_llama_cpp.sh
  SERVER="$(find runtime -name llama-server -type f | head -1)"
fi
export LD_LIBRARY_PATH="$(dirname "$SERVER"):${LD_LIBRARY_PATH:-}"

echo "[local-llm] $ALIAS  http://127.0.0.1:$PORT  (ctx=$CTX threads=$THREADS)"
exec "$SERVER" \
  -m "$MODEL" \
  --host 127.0.0.1 --port "$PORT" \
  -c "$CTX" -t "$THREADS" \
  --jinja \
  --alias "$ALIAS" \
  "$@"
