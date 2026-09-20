# 06-grounding — the guardrail

**One idea.** The model is not allowed to state a drug fact or a patient fact.
Drug facts come from RxNorm / RxClass; patient facts come from the record, both
reached through tools. Below, the resolution chain that results — every hop is a
lookup, not a guess.

**Spoken.** "We never let the model answer a drug question from memory. It has to
ask RxNorm. It has to ask the record. If neither has it, it says so — and the
chain on screen shows every hop it took."

**Visuals.** OpenAI mark on the model; database icons on the two permitted
sources (assets in `shared/marks/`).

**Status.** built — `figure.tex` present.
**Build.** `make figures` from `presentation/`.
