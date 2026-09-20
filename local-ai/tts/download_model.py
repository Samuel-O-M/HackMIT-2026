#!/usr/bin/env python3
"""Download the Qwen3-TTS 12Hz 0.6B weights into local-ai/models/.

Weights live in the repo (gitignored, so they are never committed) and are
loaded from disk by local_tts.py — nothing is fetched at inference time.

    uv run python download_model.py            # CustomVoice (default, agent voice)
    uv run python download_model.py --model base   # Base (voice cloning)
    uv run python download_model.py --model all

Sizes: CustomVoice ~2.5 GB, Base ~2.5 GB (each bundles the 12Hz speech tokenizer).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# mode -> (Hugging Face repo id, local folder under local-ai/models/)
REPOS = {
    "customvoice": ("Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", "qwen3-tts-12hz-0.6b-customvoice"),
    "base": ("Qwen/Qwen3-TTS-12Hz-0.6B-Base", "qwen3-tts-12hz-0.6b-base"),
}


def download(mode: str) -> Path:
    repo_id, folder = REPOS[mode]
    dest = MODELS_DIR / folder
    dest.mkdir(parents=True, exist_ok=True)
    print(f"↓ {repo_id}  →  {dest}")
    snapshot_download(
        repo_id=repo_id,
        local_dir=str(dest),
        # Ignore the git bookkeeping; the real weights are what we want.
        ignore_patterns=[".gitattributes", "*.md"],
    )
    size_gb = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file()) / 1e9
    print(f"✓ {mode}: {size_gb:.2f} GB in {dest}")
    return dest


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=[*REPOS, "all"], default="customvoice", help="which 0.6B 12Hz checkpoint to fetch")
    args = ap.parse_args()
    for mode in REPOS if args.model == "all" else [args.model]:
        download(mode)


if __name__ == "__main__":
    main()
