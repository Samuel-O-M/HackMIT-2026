#!/usr/bin/env python3
"""HTTP server that speaks the same `/api/transcribe` contract as voice/server.js.

    POST /api/transcribe   <raw audio bytes>       -> {"transcript": "...", ...}
    POST /api/transcribe   {"url": "https://..."}  -> download + transcribe
    GET  /api/health                                -> JSON status
    GET  /                                            -> JSON blurb

It is a drop-in stand-in for the Deepgram STT call: point voice/server.js at
`http://127.0.0.1:5001` instead of `https://api.deepgram.com` and the browser
needs no changes.

Run:
    uv run python stt_server.py                 # port 5001, loads weights eagerly
    uv run python stt_server.py --port 5001 --lazy
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from local_stt import LocalSTT, decode_audio

_LOCK = threading.Lock()
_STT: LocalSTT | None = None

_EXT_BY_MIME = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
}


def transcribe_bytes(data: bytes, content_type: str) -> str:
    suffix = _EXT_BY_MIME.get(content_type, ".bin")
    wav = decode_audio(data, suffix=suffix)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        fh.write(wav)
        wav_path = fh.name
    try:
        with _LOCK:
            return _STT.transcribe(wav_path)
    finally:
        Path(wav_path).unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "local-stt/0.1"

    def log_message(self, fmt, *args):
        pass

    def _json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path in ("/api/health", "/health"):
            self._json(200, {
                "ok": True,
                "provider": "local-parakeet",
                "modelPath": str(_STT.model_path),
                "loaded": _STT.model_path.exists(),
                "device": _STT.device,
            })
            return
        self._json(200, {"provider": "local-parakeet", "endpoints": ["POST /api/transcribe", "GET /api/health"]})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/transcribe":
            self._json(404, {"error": f"no route {parsed.path}"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        data = self.rfile.read(length) if length else b""
        content_type = str(self.headers.get("Content-Type") or "").split(";")[0].strip()

        # Same body shapes the Deepgram handler accepts: JSON {url} or raw audio.
        if content_type == "application/json":
            try:
                payload = json.loads(data.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self._json(400, {"error": "Invalid JSON body."})
                return
            url = payload.get("url")
            if not url:
                self._json(400, {"error": 'Missing "url".'})
                return
            try:
                with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 - local dev tool
                    data = resp.read()
                    content_type = str(resp.headers.get("Content-Type") or "").split(";")[0].strip()
            except Exception as err:  # noqa: BLE001
                self._json(502, {"error": f"could not fetch url: {err}"})
                return

        if not data:
            self._json(400, {"error": "Empty audio body."})
            return

        t0 = time.time()
        try:
            transcript = transcribe_bytes(data, content_type or "audio/webm")
        except Exception as err:  # noqa: BLE001
            self._json(500, {"error": f"{type(err).__name__}: {err}"})
            return

        print(f"[local-stt] {len(data)} bytes -> {time.time() - t0:.1f}s -> {transcript[:80]!r}", flush=True)
        self._json(200, {
            "transcript": transcript,
            "params": {"model": "parakeet-unified-en-0.6b", "contentType": content_type},
            "raw": {"provider": "local-parakeet", "elapsedSec": round(time.time() - t0, 2)},
        })


def main() -> None:
    global _STT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default=os.environ.get("LOCAL_STT_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("LOCAL_STT_PORT", "5001")))
    ap.add_argument("--model-path", default=os.environ.get("LOCAL_STT_MODEL_PATH"))
    ap.add_argument("--lazy", action="store_true", help="load weights on first request instead of at startup")
    args = ap.parse_args()

    _STT = LocalSTT(args.model_path)
    if not args.lazy:
        _STT.load()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[local-stt] listening on http://{args.host}:{args.port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
