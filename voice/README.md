<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# Voice Agent — local UI + brain

> A local harness for the whole voice pipeline: **mic → Deepgram STT → grounded
> Talker + Planner → Deepgram TTS → speakers.**

Part of **[ReconMed](../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. This module is the phone call and the
agent that runs it.

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#run">Run</a></li>
    <li><a href="#phone-access-cloudflare-tunnel">Phone access (Cloudflare Tunnel)</a></li>
    <li><a href="#follow-up-questions-is-it-working-any-side-effects">Follow-up questions</a></li>
    <li><a href="#the-agent-places-the-call">The agent places the call</a></li>
    <li><a href="#making-the-agent-sound-human">Making the agent sound human</a></li>
    <li><a href="#endpoints">Endpoints</a></li>
    <li><a href="#keys--config-repo-root-env-gitignored">Keys &amp; config</a></li>
    <li><a href="#documents">Documents</a></li>
    <li><a href="#notes">Notes</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

The UI is a **single call screen**:

- **The call** — pick a participant, start the call, and talk. Your words and
  the agent's words appear as bubbles; mute the mic or end the call at any time.
- **Grounding** — the participant's record (profile, study, current
  medications) that is preloaded into the agent every turn, plus what it
  looked up (`health_search`, `check_prohibited`) on the last turn.
- **Brain & planner** — goal, known/missing, next questions, flags, planner
  status and channel state.
- **Session log** — every event is kept offline for debugging: the browser
  keeps its own event log (downloadable), and the server appends a JSONL log
  per session to `voice/logs/<sessionId>.jsonl` (also served at
  `GET /api/brain/log?sessionId=…`). Logs are gitignored.
- **Phone mode** — the phone icon in the top bar (or a narrow/coarse-pointer
  screen) switches to an iOS-style call screen: same STT/TTS/brain pipeline,
  laid out for iPhone with safe-area insets, a call timer, and live captions.

See [`API_SETTINGS.md`](./API_SETTINGS.md) for every Deepgram + OpenAI setting,
and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design.

## Run

```bash
cd voice
npm install          # one dependency: `ws` (server-side live-STT proxy)
node brain/db/seed.js      # first time: create the two databases
node server.js       # → http://localhost:8787
```

Open **http://localhost:8787**. Mic access works on `localhost` (or HTTPS).

## Phone access (Cloudflare Tunnel)

A phone needs an HTTPS origin, because `getUserMedia` (the microphone) is only
available in a secure context — `http://<LAN-IP>:8787` will not work. Start a
tunnel to this server and open the printed URL on the phone:

```bash
cd api/cloudflare && ./tunnel.sh      # → https://<random>.trycloudflare.com
```

Then tap the phone icon in the top bar for phone mode. See
[`api/cloudflare/README.md`](../api/cloudflare/README.md). On networks that
block Cloudflare's edge port, use [`api/ngrok/`](../api/ngrok/README.md)
instead.

## Follow-up questions (is it working? any side effects?)

The agent also learns how a medicine is going for the participant, but a
question about every medicine sounds like a form, so it is selective
(`brain/prompts/policy.md` §2c):

| Situation | What it does |
|-----------|--------------|
| New medicine (basics recorded) | one open question: "how has that been going for you?" |
| Stopped or changed a medicine | asks why, at most twice |
| Unchanged medicine | nothing. "Same as before" is a complete answer |
| End of the call | one closing "has anything not agreed with you?" before it says goodbye |
| They raise a problem | one natural question about it, then leaves it |

Capped at three optional questions per call, never about two medicines back to
back, never repeating something they already said. The planner keeps the count
in its state (`followups`) and proposes the next question (`followup`); the cap
and "not before identity is verified" are enforced in code
(`Brain.stateForTalker`), and the planner cannot mark the closing question asked
unless an agent turn really asked it (`Brain.reconcileFollowups`).

Answers are stored on the staged change, in the participant's terms:
`effectiveness` (working / partly / not_working / unsure), `side_effects`
(none / reported / serious / unsure), `side_effects_note` and `stop_reason` (their
words). Empty means "never asked", not "no". Re-emitting a medication merges new
answers into the row already staged. Databases seeded before this get the columns
added automatically on next start.

**Serious symptoms.** For a fixed red-flag list (chest pain, trouble breathing,
fainting, swelling of face/lips/throat, severe rash, sudden severe headache,
bleeding that will not stop, confusion, severe allergic reaction) the agent
records `serious`, says calmly that it is flagging it for the study team to
follow up promptly, and gives no advice or reassurance. It is not judging
severity; it is making sure a person sees it. The review screen shows a banner
above the diff, a red edge on the row, and for a symptom tied to no medicine, a
session-level `safetyFlags` entry that the bridge carries from the planner.

## The agent places the call

When a call connects, the browser immediately asks for an *opening turn*
(`POST /api/brain/turn/stream` with `opening: true`), so the agent speaks first
— who is calling, why, and a request for name + date of birth, exactly as the
identity rule in `brain/prompts/policy.md` allows and nothing more. No
participant message is recorded for it, and a repeated opening request is
ignored. Anything the participant says before the greeting starts is dropped.

## Making the agent sound human

Two small touches, and deliberately no more (longer clips like "let me check"
sounded scripted):

- **Backchannel.** On some turns (~45%, and rarely twice in a row) the agent
  says a quick "Mm-hm", "Uh-huh" or "Okay" the instant the participant stops
  talking. These are pre-recorded clips, so there is no synthesis delay. Never
  on the greeting.
- **Lookup waits.** If the model calls a tool (verify identity, look up a drug)
  before saying anything, one "Okay." or "Uh-huh." plays straight away, so the
  line is never dead while it works. Once per turn, never the same sound the
  opener just used.
- **Breaths.** Replies are spoken sentence by sentence with a 130–300 ms pause
  between them. The model is also told to use contractions and the occasional
  "So," / "Ah," lead-in (`brain/prompts/talker.md`).

The clips live in `public/fillers/` (committed, small). Each sound is generated
three times, since the voice reads it a little differently every time.

```bash
node scripts/build-fillers.js                 # regenerate; needs ffmpeg for trimming
node scripts/build-fillers.js --experimental  # bare "hmm"/"um"/"uh" clips to audition
```

Aura-2 cannot voice a bare "um" / "uh" / "hmm" — every spelling came back as
silence — so the bank sticks to what it can say ("Uh-huh" works, "uh" does not).
`--experimental` uses OpenAI TTS for true hesitation sounds into
`public/fillers/experimental/`; that is a different voice, so listen first. The
tunables (`OPENER_CHANCE`, `BREATH_MS`) are at the top of the TTS section of
`public/app.js`.

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET  /api/health` | which keys/models are configured (no secrets) |
| `POST /api/transcribe` | raw audio body **or** `{url}` → `{transcript, raw}` |
| `WS   /ws/listen` | server-side proxy to Deepgram streaming STT (key stays server-side) |
| `POST /api/tts` | `{text}` → audio bytes |
| `POST /api/chat` | `{messages, model?, reasoningEffort?}` → `{reply}` |
| `GET  /api/patients` | participants from the patient DB |
| `POST /api/brain/session` | `{subjectId}` → `{sessionId}` |
| `POST /api/brain/turn` | `{sessionId, subjectId, text}` → `{say, thinking}` |
| `POST /api/brain/channel` | `{sessionId, state}` — call channel state |
| `GET  /api/brain/debug` | `?sessionId=` → full brain/planner debug snapshot |
| `GET  /api/brain/log` | `?sessionId=` → the session's offline JSONL log |

STT/TTS allow-listed settings can be passed as query params
(e.g. `?model=nova-2-medical&diarize=true`, `?model=aura-2-helena-en&encoding=linear16&container=wav`).

## Keys & config (repo-root `.env`, gitignored)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEEPGRAM_API_KEY` | — | STT + TTS |
| `OPENAI_API_KEY` | — | reasoning/chat |
| `DEEPGRAM_STT_MODEL` | `nova-3` | transcription model |
| `DEEPGRAM_TTS_MODEL` | `aura-2-thalia-en` | voice |
| `SYSTEM_PROMPT` | built-in | plain-chat instructions |
| `PORT` | `8787` | server port |

Model + reasoning-effort choices for the brain live in code
(`brain/config.js`), not `.env`.

## Documents

`data/` holds example knowledge sources (not yet wired into the agent).

## Notes

- API keys never reach the browser: every call is proxied by `server.js`, and
  live STT runs through the `/ws/listen` WebSocket proxy.
- `node:sqlite` rows are **null-prototype** — never interpolate one directly
  into a template string (see `brain/lib/format.js`).
- For the agent's internals, see [`brain/README.md`](./brain/README.md); for
  outbound calling, see [`telephony/README.md`](./telephony/README.md).

## License

Distributed under the MIT License. See [`../LICENSE`](../LICENSE).

## Contributors

Built at **HackMIT 2026** for the **Regeneron** track.

- **Samuel Orellana Mateo** — [@Samuel-O-M](https://github.com/Samuel-O-M)
- **Ayushi Mehrotra** — [@ayushimehrotra](https://github.com/ayushimehrotra)
- **Avighna Chhatrapati** — [@avighnac](https://github.com/avighnac)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[license-shield]: https://img.shields.io/github/license/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[license-url]: ../LICENSE
[contributors-shield]: https://img.shields.io/github/contributors/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[contributors-url]: https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors
