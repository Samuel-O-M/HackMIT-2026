#!/usr/bin/env python3
"""Smoke-test Qwen3-TTS: load the 0.6B 12Hz checkpoint and voice a few lines.

    uv run python test_tts.py                 # 3 short lines, writes to ../out/
    uv run python test_tts.py --speaker Ryan
    uv run python test_tts.py --long          # one ~2-sentence clinical line

Exits non-zero if no audio is produced.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import soundfile as sf

from local_tts import DEFAULT_LANGUAGE, DEFAULT_MODE, DEFAULT_SPEAKER, LocalTTS

OUT = Path(__file__).resolve().parent.parent / "out"

LINES = [
    "Hello, this is a local text to speech test.",
    "How has the new medicine been going for you?",
    "Okay, thanks. I've made a note of that for the study team.",
]

CLINICAL = (
    "Hi, my name is Ava and I'm calling from the study team. "
    "I wanted to check in on how you've been feeling since you started the new medicine."
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["customvoice", "base"], default=DEFAULT_MODE)
    ap.add_argument("--speaker", default=DEFAULT_SPEAKER)
    ap.add_argument("--language", default=DEFAULT_LANGUAGE)
    ap.add_argument("--long", action="store_true", help="synthesise one longer clinical sentence instead")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    tts = LocalTTS(args.mode)
    t0 = time.time()
    tts.load()
    print(f"loaded in {time.time() - t0:.1f}s")

    lines = [CLINICAL] if args.long else LINES
    total_audio = 0.0
    for i, line in enumerate(lines, 1):
        t = time.time()
        wav, sr = tts.synthesize(line, speaker=args.speaker, language=args.language)
        wall = time.time() - t
        dur = len(wav) / sr
        total_audio += dur
        name = OUT / f"tts_{i:02d}_{args.speaker.lower()}.wav"
        sf.write(str(name), wav, sr)
        print(f"  [{i}/{len(lines)}] {dur:5.2f}s audio  {wall:5.1f}s wall  RTF {wall / max(dur, 1e-9):4.2f}  -> {name.name}")

    print(f"OK: {len(lines)} clip(s), {total_audio:.2f}s audio -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
