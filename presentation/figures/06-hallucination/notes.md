# 06-hallucination — the model is not the source of truth

**One idea.** This is documented, not hypothetical: transcription models invent
drugs that do not exist, and a medical AI recommended treatments that could
kill. So the agent is never allowed to answer from memory.

**Sources (real reporting):**
- AP News, 26 Oct 2024 — Whisper invented "hyperactivated antibiotics" in a
  patient's notes.
- STAT, 25 Jul 2018 — Watson for Oncology gave "unsafe and incorrect"
  recommendations, including a bleeding risk for a patient already bleeding.
- Science, 26 Apr 2024 — transcription models fabricated sentences in ~1.4% of
  recordings.

**Note.** The clippings are set in type and sourced, not page screenshots (no
desktop browser was connected when this was built). Swap in real screenshots if
wanted.

**Status.** built — `figure.tex` present.
**Build.** `make figures` from `presentation/`.
