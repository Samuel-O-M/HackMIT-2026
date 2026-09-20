#!/usr/bin/env python3
"""Local speech-to-text with NVIDIA Parakeet-unified-en-0.6B.

Wraps NVIDIA NeMo so the rest of the repo only needs two calls:
`decode_audio()` (any browser/telephony format -> 16 kHz mono wav) and
`LocalSTT.transcribe()` (wav -> text).

The model is a single `.nemo` checkpoint under local-ai/models/ and runs on CPU
(slow but functional). No network access happens at inference time.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
NEMO_DIR = MODELS_DIR / "parakeet-unified-en-0.6b"
NEMO_FILE = NEMO_DIR / "parakeet-unified-en-0.6b.nemo"
REPO_ID = "nvidia/parakeet-unified-en-0.6b"

# Parakeet expects 16 kHz mono audio.
TARGET_SR = 16000


def _ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg not found on PATH; needed to decode webm/ogg/mp4 audio")
    return exe


def decode_audio(data: bytes, *, suffix: str = ".bin", sample_rate: int = TARGET_SR) -> bytes:
    """Decode arbitrary audio bytes to 16-bit PCM WAV bytes at `sample_rate`.

    The browser sends webm/opus and telephony may hand us other containers, so we
    let ffmpeg normalise. PCM WAV passes through untouched.
    """
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return data

    with tempfile.TemporaryDirectory(prefix="local-stt-") as tmp:
        src = Path(tmp) / f"in{suffix}"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(data)
        cmd = [
            _ffmpeg(), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(src),
            "-ac", "1", "-ar", str(sample_rate), "-c:a", "pcm_s16le",
            str(dst),
        ]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg decode failed: {proc.stderr.decode('utf-8', 'replace').strip()}")
        return dst.read_bytes()


class LocalSTT:
    """Loads the Parakeet `.nemo` checkpoint once and keeps it in memory."""

    def __init__(self, model_path: str | Path | None = None, device: str | None = None):
        self.model_path = Path(model_path) if model_path else NEMO_FILE
        self.device = device or os.environ.get("LOCAL_AI_DEVICE", "cpu")
        if self.device == "cpu":
            threads = int(os.environ.get("LOCAL_AI_THREADS", "0"))
            import torch

            torch.set_num_threads(threads if threads > 0 else os.cpu_count() or 4)
        self._model = None

    def load(self):
        if self._model is not None:
            return self._model
        import nemo.collections.asr as nemo_asr  # heavy; import only when needed

        source = str(self.model_path) if self.model_path.exists() else REPO_ID
        print(f"[local-stt] loading {source} on {self.device}", flush=True)
        if self.model_path.exists():
            model = nemo_asr.models.ASRModel.restore_from(restore_path=source, map_location=self.device)
        else:
            model = nemo_asr.models.ASRModel.from_pretrained(model_name=source, map_location=self.device)
        model.eval()
        if self.device == "cpu":
            model = model.to("cpu")

        # NeMo-3.0 quirk: the Parakeet-unified checkpoint ships `validation_ds: null`,
        # but EncDecRNNTBPEModel._setup_transcribe_dataloader does
        #   self.cfg.validation_ds.get('use_start_end_token', False)
        # which raises on None. Give it an empty node so batch transcribe works.
        from omegaconf import OmegaConf

        if model.cfg.get("validation_ds") is None:
            model.cfg.validation_ds = OmegaConf.create({"use_start_end_token": False})

        self._model = model
        print("[local-stt] ready", flush=True)
        return model

    def transcribe(self, wav_path: str | Path, **kwargs) -> str:
        """Transcribe one WAV file (16 kHz mono recommended) and return text."""
        model = self.load()
        results = model.transcribe([str(wav_path)], batch_size=1, verbose=False, **kwargs)
        first = results[0] if isinstance(results, (list, tuple)) else results
        text = getattr(first, "text", None)
        if text is None:
            text = str(first)
        return text.strip()


def main() -> None:
    import argparse
    import time

    ap = argparse.ArgumentParser(description="Transcribe audio files with Parakeet-unified-en-0.6B.")
    ap.add_argument("audio", nargs="+", help="one or more ffmpeg-decodable audio files")
    args = ap.parse_args()

    stt = LocalSTT()
    for path in args.audio:
        src = Path(path)
        t0 = time.time()
        audio = decode_audio(src.read_bytes(), suffix=src.suffix)
        tmp = Path(tempfile.gettempdir()) / "local-stt-cli.wav"
        tmp.write_bytes(audio)
        text = stt.transcribe(tmp)
        # `<path>\t<text>` so roundtrip.py can read it back.
        print(f"{src}\t{text}")


if __name__ == "__main__":
    main()
