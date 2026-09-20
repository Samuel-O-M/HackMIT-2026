#!/usr/bin/env bash
#
# Install the ngrok agent into ./bin without modifying the system.
# Safe to run repeatedly; skips work if ngrok is already available.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin"
mkdir -p "$BIN"

if command -v ngrok >/dev/null 2>&1; then
  echo "ngrok already on PATH: $(command -v ngrok)"
  exit 0
fi
if [[ -x "$BIN/ngrok" ]]; then
  echo "ngrok already installed at $BIN/ngrok"
  exit 0
fi

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    echo "Download manually: https://ngrok.com/download" >&2
    exit 1
    ;;
esac
case "$os" in
  linux | darwin) ;;
  *)
    echo "Unsupported OS: $os" >&2
    echo "Download manually: https://ngrok.com/download" >&2
    exit 1
    ;;
esac

url="https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-${os}-${arch}.tgz"
echo "Downloading $url"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fL --retry 3 -o "$tmp/ngrok.tgz" "$url"
tar xzf "$tmp/ngrok.tgz" -C "$tmp"
mv "$tmp/ngrok" "$BIN/ngrok"
chmod +x "$BIN/ngrok"

echo "Installed: $BIN/ngrok"
"$BIN/ngrok" --version
echo
echo "Next, authenticate once:"
echo "  $BIN/ngrok config add-authtoken <your-token>"
