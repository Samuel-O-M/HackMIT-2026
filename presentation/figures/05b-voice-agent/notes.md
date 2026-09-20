# 05b-voice-agent — the realtime agent

**One idea.** The call is a continuous interaction, not a request/response. Two
Deepgram models handle the voice; GPT-5.6 Luna runs both reasoning roles — the
realtime Talker and the async Planner — and every one of those parts is
swappable because the prompts are plain Markdown files.

**Spoken.** "Deepgram hears and speaks; GPT-5.6 Luna thinks. The Talker answers
immediately, the Planner works between turns, and the whole thing is open
source — the model is one line in `brain/config.js` and the prompts are three
files you can read, `policy.md`, `talker.md`, `thinker.md`."

**Status.** built — `figure.tex` present.
**Build.** `make figures` from `presentation/`.
