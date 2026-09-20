#!/usr/bin/env bash
#
# Install cloudflared into ./bin without modifying the system.
# Safe to run repeatedly; skips work if cloudflared is already available.
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$DIR/bin"
mkdir -p "$BIN"

if command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared already on PATH: $(command -v cloudflared)"
  exit 0
fi
if [[ -x "$BIN/cloudflared" ]]; then
  echo "cloudflared already installed at $BIN/cloudflared"
  exit 0
fi

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  armv7l | armv7) arch=arm ;;
  *)
    echo "Unsupported architecture: $arch" >&2
    echo "Download a release manually: https://github.com/cloudflare/cloudflared/releases" >&2
    exit 1
    ;;
esac
case "$os" in
  linux | darwin) ;;
  *)
    echo "Unsupported OS: $os" >&2
    echo "Download a release manually: https://github.com/cloudflare/cloudflared/releases" >&2
    exit 1
    ;;
esac

url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${os}-${arch}"
echo "Downloading $url"

if command -v curl >/dev/null 2>&1; then
  curl -fL --retry 3 -o "$BIN/cloudflared" "$url"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$BIN/cloudflared" "$url"
else
  echo "Need curl or wget to download cloudflared." >&2
  exit 1
fi

chmod +x "$BIN/cloudflared"
echo "Installed: $BIN/cloudflared"
"$BIN/cloudflared" --version
