#!/usr/bin/env bash
#
# Tunnel the voice call UI (default http://localhost:8787) through ngrok.
#
#   ./tunnel.sh
#   ./tunnel.sh --domain modest-exactly-asp.ngrok-free.app
#   NGROK_DOMAIN=my-name.ngrok-free.app ./tunnel.sh
#
# The static domain must be reserved on your ngrok account. Open the printed
# https URL on the phone (tap "Visit" once on ngrok's free-tier warning page).
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN="${NGROK_DOMAIN:-modest-exactly-asp.ngrok-free.app}"
PORT=8787

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    -h | --help)
      echo "Usage: ./tunnel.sh [--domain <name.ngrok-free.app>] [--port N]"
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

echo "Tunneling http://localhost:${PORT}  ->  https://${DOMAIN}"
echo "Open https://${DOMAIN} on the phone (tap 'Visit' once on ngrok's warning page)."
echo

exec "$NGROK" http --url="$DOMAIN" "$PORT"
