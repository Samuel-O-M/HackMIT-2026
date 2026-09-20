#!/usr/bin/env python3
"""Smoke-test Parakeet-unified-en-0.6B.

Transcribes every .wav in local-ai/out/ (drop Qwen3-TTS output there first), or
an explicit file. Use scripts/roundtrip.py to check TTS -> STT intelligibility
in one shot.

    uv run python test_stt.py                       # all of ../out/*.wav
    uv run python test_stt.py path/to/clip.wav
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

from local_stt import LocalSTT, decode_audio

OUT = Path(__file__).resolve().parent.parent / "out"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio", nargs="*", help="audio files; defaults to ../out/*.wav")
    args = ap.parse_args()

    files = [Path(p) for p in args.audio] or sorted(OUT.glob("*.wav"))
    if not files:
        print(f"no audio found (looked in {OUT}). Run tts/test_tts.py first, or pass a file.")
        return 1

    stt = LocalSTT()
    t0 = time.time()
    stt.load()
    print(f"loaded in {time.time() - t0:.1f}s")
    for f in files:
        if not f.exists():
            print(f"  skip (missing): {f}")
            continue
        t = time.time()
        text = stt.transcribe(_write_temp(f))
        print(f"  [{time.time() - t:.1f}s] {f.name}: {text}")
    return 0


def _write_temp(f: Path) -> str:
    import tempfile

    wav = decode_audio(f.read_bytes(), suffix=f.suffix)
    tmp = Path(tempfile.gettempdir()) / "local-stt-test.wav"
    tmp.write_bytes(wav)
    return str(tmp)


if __name__ == "__main__":
    raise SystemExit(main())
