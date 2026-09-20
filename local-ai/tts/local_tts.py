#!/usr/bin/env python3
"""Local text-to-speech with Qwen3-TTS-12Hz-0.6B.

Thin wrapper around the `qwen-tts` package that:
  * loads weights from local-ai/models/ (never the network), and
  * exposes one function, `synthesize()`, returning (float32 waveform, sample_rate).

Two checkpoints are supported, both 0.6B / 12Hz:
  * "customvoice" (default) — 9 built-in speakers, no reference audio needed.
  * "base"                  — 3-second voice cloning from a reference clip.

CPU-only boxes work; see README for expected latency. Import is side-effect free
so the server can start fast and load weights on demand.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# mode -> (local folder, HF repo id as a fallback if the local copy is missing)
MODELS = {
    "customvoice": ("qwen3-tts-12hz-0.6b-customvoice", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"),
    "base": ("qwen3-tts-12hz-0.6b-base", "Qwen/Qwen3-TTS-12Hz-0.6B-Base"),
}

# Sensible defaults for the voice agent. Aiden/Ryan are the two native-English
# CustomVoice speakers; Aiden is a clear midrange US male that reads clinical
# prose well. Override per request with speaker=/language=.
DEFAULT_MODE = os.environ.get("LOCAL_TTS_MODE", "customvoice")
DEFAULT_SPEAKER = os.environ.get("LOCAL_TTS_SPEAKER", "Aiden")
DEFAULT_LANGUAGE = os.environ.get("LOCAL_TTS_LANGUAGE", "English")


def _resolve(model_dir: str | Path | None, mode: str) -> str:
    """Prefer a locally downloaded checkpoint; fall back to the HF id."""
    if model_dir:
        p = Path(model_dir)
        if p.exists():
            return str(p)
    folder, repo_id = MODELS[mode]
    local = MODELS_DIR / folder
    return str(local) if local.exists() else repo_id


class LocalTTS:
    """Loads one Qwen3-TTS checkpoint and holds it in memory."""

    def __init__(self, mode: str = DEFAULT_MODE, model_dir: str | Path | None = None, device: str | None = None):
        if mode not in MODELS:
            raise ValueError(f"mode must be one of {sorted(MODELS)}, got {mode!r}")
        self.mode = mode
        self.model_path = _resolve(model_dir, mode)
        self.device = device or os.environ.get("LOCAL_AI_DEVICE", "cpu")
        # CPU inference is compute-bound; give torch every core we have.
        if self.device == "cpu":
            threads = int(os.environ.get("LOCAL_AI_THREADS", "0"))
            import torch

            torch.set_num_threads(threads if threads > 0 else os.cpu_count() or 4)
        self._model = None

    def load(self):
        if self._model is not None:
            return self._model
        import torch
        from qwen_tts import Qwen3TTSModel

        print(f"[local-tts] loading {self.mode} from {self.model_path} on {self.device}", flush=True)
        kwargs: dict[str, Any] = dict(device_map=self.device)
        if self.device == "cpu":
            # float32 is the safe CPU path; bf16/fp16 kernels are GPU-oriented.
            # Pin sdpa so we never ask for flash-attn (GPU-only) on a CPU box.
            kwargs["dtype"] = torch.float32
            kwargs["attn_implementation"] = "sdpa"
        else:
            kwargs["dtype"] = torch.bfloat16
            kwargs["attn_implementation"] = "flash_attention_2"
        self._model = Qwen3TTSModel.from_pretrained(self.model_path, **kwargs)
        print("[local-tts] ready", flush=True)
        return self._model

    # -- introspection -----------------------------------------------------
    def speakers(self) -> list[str]:
        if self.mode != "customvoice":
            return []
        try:
            return list(self.load().get_supported_speakers())
        except Exception:
            return []

    def languages(self) -> list[str]:
        try:
            return list(self.load().get_supported_languages())
        except Exception:
            return []

    # -- synthesis ---------------------------------------------------------
    def synthesize(
        self,
        text: str,
        *,
        speaker: str = DEFAULT_SPEAKER,
        language: str = DEFAULT_LANGUAGE,
        instruct: str = "",
        ref_audio: str | None = None,
        ref_text: str = "",
        **gen_kwargs: Any,
    ):
        """Return (waveform: np.ndarray[float32], sample_rate: int)."""
        model = self.load()
        text = (text or "").strip()
        if not text:
            raise ValueError("text is empty")

        if self.mode == "base":
            if not ref_audio:
                raise ValueError("mode='base' needs ref_audio (a reference clip to clone)")
            # A reference transcript improves cloning; x_vector_only_mode skips it.
            kwargs: dict[str, Any] = dict(text=text, language=language, ref_audio=ref_audio)
            if ref_text:
                kwargs["ref_text"] = ref_text
            else:
                kwargs["x_vector_only_mode"] = True
            wavs, sr = model.generate_voice_clone(**kwargs, **gen_kwargs)
        else:
            kwargs = dict(text=text, language=language, speaker=speaker)
            if instruct:
                kwargs["instruct"] = instruct
            wavs, sr = model.generate_custom_voice(**kwargs, **gen_kwargs)
        return wavs[0], int(sr)


def main() -> None:
    import argparse
    import time

    import soundfile as sf

    out_dir = Path(__file__).resolve().parent.parent / "out"
    ap = argparse.ArgumentParser(description="Synthesise lines to WAV files.")
    ap.add_argument("text", nargs="*", help="one or more lines to speak")
    ap.add_argument("-o", "--out", help="output path for a single line (default ../out/tts.wav)")
    ap.add_argument("--texts-file", help="file with one line per sentence; writes ../out/tts_<n>.wav")
    ap.add_argument("--out-dir", default=str(out_dir), help="directory for batch output")
    ap.add_argument("--mode", choices=sorted(MODELS), default=DEFAULT_MODE)
    ap.add_argument("--speaker", default=DEFAULT_SPEAKER)
    ap.add_argument("--language", default=DEFAULT_LANGUAGE)
    ap.add_argument("--instruct", default="")
    args = ap.parse_args()

    if args.texts_file:
        texts = [ln.strip() for ln in Path(args.texts_file).read_text().splitlines() if ln.strip()]
    elif args.text:
        texts = [" ".join(args.text)]
    else:
        texts = ["Hello, this is a local text to speech test."]

    tts = LocalTTS(args.mode)
    batch = len(texts) > 1 or bool(args.texts_file)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, text in enumerate(texts, 1):
        out = Path(args.out) if (args.out and not batch) else out_dir / f"tts_{i:02d}.wav"
        t0 = time.time()
        wav, sr = tts.synthesize(text, speaker=args.speaker, language=args.language, instruct=args.instruct)
        elapsed = time.time() - t0
        sf.write(str(out), wav, sr)
        dur = len(wav) / sr
        tag = f"[{i}/{len(texts)}] " if batch else ""
        # `<path>\t<text>` in batch mode so roundtrip.py can read it back.
        print(f"{tag}wrote {out}\t{text}" if batch
              else f"wrote {out}  ({dur:.2f}s audio, {sr} Hz, {elapsed:.1f}s wall, RTF {elapsed / max(dur, 1e-9):.2f})")


if __name__ == "__main__":
    main()
