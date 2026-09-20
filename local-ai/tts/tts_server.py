#!/usr/bin/env python3
"""HTTP server that speaks the same `/api/tts` contract as voice/server.js.

    POST /api/tts      {"text": "..."}       -> audio/wav bytes
    GET  /api/health                          -> JSON status
    GET  /                                    -> JSON blurb

It is a *drop-in stand-in for the Deepgram TTS call*: point voice/server.js at
`http://127.0.0.1:5002` instead of `https://api.deepgram.com` and the browser
needs no changes at all (it already plays whatever blob comes back).

Run:
    uv run python tts_server.py                 # port 5002, loads weights eagerly
    uv run python tts_server.py --port 5002 --lazy
"""

from __future__ import annotations

import argparse
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from local_tts import DEFAULT_LANGUAGE, DEFAULT_MODE, DEFAULT_SPEAKER, LocalTTS

# Qwen3-TTS generation is CPU-heavy and the model is shared, so serialise
# requests. A real-time agent would use one worker per stream instead.
_LOCK = threading.Lock()
_TTS: LocalTTS | None = None


def synth_wav(text: str, *, speaker: str, language: str, instruct: str) -> bytes:
    import soundfile as sf

    with _LOCK:
        t0 = time.time()
        wav, sr = _TTS.synthesize(text, speaker=speaker, language=language, instruct=instruct)
        buf = io.BytesIO()
        sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
        audio = buf.getvalue()
    dur = len(wav) / sr
    print(f"[local-tts] {dur:.2f}s audio in {time.time() - t0:.1f}s  ({len(text)} chars, {speaker})", flush=True)
    return audio


class Handler(BaseHTTPRequestHandler):
    server_version = "local-tts/0.1"

    def log_message(self, fmt, *args):  # keep stdout tidy; the pipeline logs elsewhere
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
                "provider": "local-qwen3-tts",
                "mode": _TTS.mode,
                "modelPath": _TTS.model_path,
                "device": _TTS.device,
                "defaultSpeaker": DEFAULT_SPEAKER,
                "defaultLanguage": DEFAULT_LANGUAGE,
                "speakers": _TTS.speakers(),
                "languages": _TTS.languages(),
            })
            return
        self._json(200, {"provider": "local-qwen3-tts", "endpoints": ["POST /api/tts", "GET /api/health"]})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/tts":
            self._json(404, {"error": f"no route {parsed.path}"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._json(400, {"error": "Invalid JSON body."})
            return
        text = str(payload.get("text") or "").strip()
        if not text:
            self._json(400, {"error": 'Missing "text".'})
            return

        # Query params override the defaults; Deepgram-only params are ignored.
        q = parse_qs(parsed.query)
        speaker = (q.get("speaker") or [DEFAULT_SPEAKER])[0]
        language = (q.get("language") or [DEFAULT_LANGUAGE])[0]
        instruct = (q.get("instruct") or [""])[0]

        try:
            audio = synth_wav(text, speaker=speaker, language=language, instruct=instruct)
        except Exception as err:  # noqa: BLE001 - surface the message to the caller
            self._json(500, {"error": f"{type(err).__name__}: {err}"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    global _TTS
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default=os.environ.get("LOCAL_TTS_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("LOCAL_TTS_PORT", "5002")))
    ap.add_argument("--mode", choices=["customvoice", "base"], default=DEFAULT_MODE)
    ap.add_argument("--model-dir", default=os.environ.get("LOCAL_TTS_MODEL_DIR"))
    ap.add_argument("--lazy", action="store_true", help="load weights on first request instead of at startup")
    args = ap.parse_args()

    _TTS = LocalTTS(args.mode, model_dir=args.model_dir)
    if not args.lazy:
        _TTS.load()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[local-tts] listening on http://{args.host}:{args.port}  (mode={args.mode})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
