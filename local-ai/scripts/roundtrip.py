#!/usr/bin/env python3
"""Cross-check the two local models: Qwen3-TTS speaks, Parakeet listens.

Runs each model in its own uv environment (they have conflicting pins, so they
are deliberately separate) and scores how much of what was spoken survives the
trip through the vocoder and back.

    python3 scripts/roundtrip.py            # from local-ai/
    python3 local-ai/scripts/roundtrip.py   # from the repo root

Needs no third-party packages itself; only `uv`, ffmpeg (for STT decode) and the
two project environments. Model weights must already be downloaded.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # local-ai/
OUT = ROOT / "out"

SENTENCES = [
    "Hello, this is a local text to speech test.",
    "How has the new medicine been going for you?",
    "Please take one tablet twice a day with food.",
    "Okay, thanks. I have made a note of that for the study team.",
]


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", text.lower()).strip()


def similarity(a: str, b: str) -> float:
    a, b = norm(a), norm(b)
    if not a and not b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def run(cmd: list[str]) -> str:
    print("$", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"command failed ({proc.returncode}): {' '.join(cmd)}")
    sys.stdout.write(proc.stdout)
    return proc.stdout


def parse_pairs(stdout: str) -> dict[str, str]:
    """Read `path<TAB>text` lines produced by local_tts.py / local_stt.py."""
    out: dict[str, str] = {}
    for line in stdout.splitlines():
        if "\t" not in line:
            continue
        left, text = line.split("\t", 1)
        token = left.split()[-1] if left.strip() else ""
        if token.startswith("/") or token.startswith("."):
            out[str(Path(token).resolve())] = text.strip()
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--threshold", type=float, default=0.75, help="minimum average word similarity to pass")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    texts_file = OUT / "_roundtrip_texts.txt"
    texts_file.write_text("\n".join(SENTENCES) + "\n")

    # 1) TTS: one process, one model load, one wav per sentence.
    tts_out = run([
        "uv", "run", "--project", str(ROOT / "tts"),
        "python", str(ROOT / "tts" / "local_tts.py"),
        "--texts-file", str(texts_file), "--out-dir", str(OUT),
    ])
    spoken = parse_pairs(tts_out)
    if not spoken:
        raise SystemExit("TTS produced no wav files")

    # 2) STT: one process, one model load, transcribe every wav.
    stt_out = run([
        "uv", "run", "--project", str(ROOT / "stt"),
        "python", str(ROOT / "stt" / "local_stt.py"), *spoken.keys(),
    ])
    heard = parse_pairs(stt_out)

    print("\n=== TTS -> STT round-trip ===")
    scores = []
    for wav, said in spoken.items():
        got = heard.get(str(Path(wav).resolve()), "<no transcript>")
        score = similarity(said, got)
        scores.append(score)
        print(f"\n  said:  {said}\n  heard: {got}\n  match: {score:.2f}")

    avg = sum(scores) / len(scores)
    print(f"\naverage similarity: {avg:.3f}  ({len(scores)} clips, threshold {args.threshold})")
    if avg < args.threshold:
        print("FAIL: average similarity below threshold")
        return 1
    print("PASS: local TTS audio is intelligible to local STT")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
