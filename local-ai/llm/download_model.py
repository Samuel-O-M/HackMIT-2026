#!/usr/bin/env python3
"""Download Gemma 4 E4B (QAT q4_0) into local-ai/models/.

The upstream artifact is a single ~5 GB GGUF, served by llama.cpp (see
run_server.sh). It lives in the repo folder (gitignored) — nothing is fetched at
inference time.

    uv run python download_model.py                 # Gemma 4 E4B Q4 (default)
    uv run python download_model.py --model gemma3-4b   # lighter fallback (no native tools)

Gemma 4 E4B is the 4B-class checkpoint, and it has native function calling —
which is why it is the one that can realistically stand in for Luna.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# key -> (HF repo, file, destination folder)
REPOS = {
    "gemma4-e4b": ("google/gemma-4-E4B-it-qat-q4_0-gguf", "gemma-4-E4B_q4_0-it.gguf", "gemma-4-e4b-it-q4_0"),
    # Fallback: the classic Gemma 3 4B. Smaller, but no native tool-calling
    # template, so the brain's function calls will be unreliable.
    "gemma3-4b": ("google/gemma-3-4b-it-qat-q4_0-gguf", "gemma-3-4b-it-q4_0.gguf", "gemma-3-4b-it-q4_0"),
}


def download(key: str) -> Path:
    repo_id, filename, folder = REPOS[key]
    dest = MODELS_DIR / folder
    dest.mkdir(parents=True, exist_ok=True)
    print(f"↓ {repo_id}/{filename}  →  {dest}")
    snapshot_download(
        repo_id=repo_id,
        local_dir=str(dest),
        allow_patterns=[filename],  # skip the vision/audio mmproj files
    )
    path = dest / filename
    print(f"✓ {key}: {path.stat().st_size / 1e9:.2f} GB in {path}")
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=sorted(REPOS), default="gemma4-e4b")
    args = ap.parse_args()
    download(args.model)


if __name__ == "__main__":
    main()
