#!/usr/bin/env bash
#
# Start a Cloudflare Quick Tunnel to the voice server.
#
#   ./tunnel.sh                      # -> http://localhost:8787
#   ./tunnel.sh --port 8787
#   ./tunnel.sh --url http://localhost:8787
#
# Prints an https://<random>.trycloudflare.com URL. Open that on the phone so
# the browser is a secure context (required for the microphone). The URL changes
# every run and the tunnel is public — stop it with Ctrl-C when you're done.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'EOF'
Start a Cloudflare Quick Tunnel to the voice server.

Usage: ./tunnel.sh [--port N] [--url http://host:port]

Defaults to http://localhost:8787.
Open the printed https://*.trycloudflare.com URL on the phone.
EOF
}

TARGET_URL=""
PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --url) TARGET_URL="${2:-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$TARGET_URL" ]]; then
  TARGET_URL="http://localhost:${PORT:-8787}"
fi

CF=""
if command -v cloudflared >/dev/null 2>&1; then
  CF="$(command -v cloudflared)"
elif [[ -x "$DIR/bin/cloudflared" ]]; then
  CF="$DIR/bin/cloudflared"
else
  echo "cloudflared not found — installing into ./bin ..."
  "$DIR/install-cloudflared.sh"
  CF="$DIR/bin/cloudflared"
fi

echo "Tunneling $TARGET_URL via Cloudflare Quick Tunnel"
echo "Look for the https://*.trycloudflare.com URL below, then open it on the phone."
echo

exec "$CF" tunnel --url "$TARGET_URL"
