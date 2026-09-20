#!/usr/bin/env python3
"""Download the NVIDIA Parakeet-unified-en-0.6B weights into local-ai/models/.

The upstream artifact is a single ~2.5 GB `.nemo` archive. It is stored in the
repo (gitignored) and loaded by local_stt.py — nothing is fetched at inference
time.

    uv run python download_model.py
"""

from __future__ import annotations

from pathlib import Path

from huggingface_hub import hf_hub_download

REPO_ID = "nvidia/parakeet-unified-en-0.6b"
FILENAME = "parakeet-unified-en-0.6b.nemo"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
DEST_DIR = MODELS_DIR / "parakeet-unified-en-0.6b"


def main() -> None:
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    print(f"↓ {REPO_ID}/{FILENAME}  →  {DEST_DIR}")
    path = hf_hub_download(repo_id=REPO_ID, filename=FILENAME, local_dir=str(DEST_DIR))
    size_gb = Path(path).stat().st_size / 1e9
    print(f"✓ {size_gb:.2f} GB in {path}")


if __name__ == "__main__":
    main()
