#!/usr/bin/env bash
#
# Tunnel the coordinator dashboard (default http://localhost:5173) through ngrok
# on a random URL.
#
#   cd frontend && npm run dev      # start the dashboard first
#   ./dashboard.sh
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=5173

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    -h | --help)
      echo "Usage: ./dashboard.sh [--port N]"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

NGROK=""
if command -v ngrok >/dev/null 2>&1; then
  NGROK="$(command -v ngrok)"
elif [[ -x "$DIR/bin/ngrok" ]]; then
  NGROK="$DIR/bin/ngrok"
else
  "$DIR/install-ngrok.sh"
  NGROK="$DIR/bin/ngrok"
fi

if [[ ! -f "$HOME/.config/ngrok/ngrok.yml" && -z "${NGROK_AUTHTOKEN:-}" ]]; then
  echo "No ngrok authtoken configured. Run once:" >&2
  echo "  $NGROK config add-authtoken <your-token>" >&2
  exit 1
fi

echo "Make sure the dashboard dev server is running:  cd frontend && npm run dev"
echo "Tunneling http://localhost:${PORT} on a random ngrok URL ..."
echo

exec "$NGROK" http "$PORT"
