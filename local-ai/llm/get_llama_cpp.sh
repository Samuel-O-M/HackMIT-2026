#!/usr/bin/env bash
#
# Fetch a prebuilt llama.cpp (CPU, ubuntu-x64) into llm/runtime/.
# No compiler needed; the archive is ~17 MB and contains llama-server, which
# speaks the OpenAI /v1/chat/completions API including tool calls (--jinja).
#
#   ./get_llama_cpp.sh                 # pinned build
#   LLAMA_CPP_BUILD=b11060 ./get_llama_cpp.sh
#
set -euo pipefail
cd "$(dirname "$0")"

BUILD="${LLAMA_CPP_BUILD:-b11060}"
ARCHIVE="llama-${BUILD}-bin-ubuntu-x64.tar.gz"
DEST="runtime/llama-${BUILD}"
URL="https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}/${ARCHIVE}"

if find "$DEST" -name llama-server -type f 2>/dev/null | grep -q .; then
  echo "already have $(find "$DEST" -name llama-server -type f | head -1)"
  exit 0
fi

mkdir -p runtime
echo "↓ $URL"
curl -fL --retry 3 --retry-delay 2 -o "runtime/$ARCHIVE" "$URL"
mkdir -p "$DEST"
tar -xzf "runtime/$ARCHIVE" -C "$DEST" --strip-components=1 2>/dev/null || tar -xzf "runtime/$ARCHIVE" -C "$DEST"
rm -f "runtime/$ARCHIVE"

SERVER="$(find "$DEST" -name llama-server -type f | head -1)"
[[ -n "$SERVER" ]] || { echo "no llama-server in archive" >&2; exit 1; }
chmod +x "$SERVER"
echo "✓ $(basename "$SERVER") at $SERVER"
