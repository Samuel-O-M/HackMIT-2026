<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]
[![HackMIT 2026][hackmit-shield]][hackmit-url]

<br />
<div align="center">

# ReconMed

**Automated pre-visit patient reconciliation for clinical trial sites.**

<img src="presentation/thumbnail.png" alt="ReconMed" width="720" />

A voice agent calls the participant before a visit, walks through their
medications, checks what they say against the trial protocol's prohibited list,
and hands the coordinator a diff to confirm. A protocol deviation is caught on
the phone — not in monitoring, weeks later.

[The problem](#the-problem) &middot;
[How it works](#how-it-works) &middot;
[Quick start](#quick-start) &middot;
[Repository map](#repository-map)

</div>

---

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#about-the-project">About the project</a></li>
    <li><a href="#the-problem">The problem</a></li>
    <li><a href="#how-it-works">How it works</a></li>
    <li><a href="#technical-details">Technical details</a></li>
    <li><a href="#how-we-built-it">How we built it</a></li>
    <li><a href="#challenges-we-ran-into">Challenges we ran into</a></li>
    <li><a href="#accomplishments-were-proud-of">Accomplishments we're proud of</a></li>
    <li><a href="#what-we-learned">What we learned</a></li>
    <li><a href="#whats-next-for-our-project">What's next for our project</a></li>
    <li><a href="#hackmit-2026-sponsor-challenges">HackMIT 2026 sponsor challenges</a></li>
    <li><a href="#built-with">Built with</a></li>
    <li><a href="#quick-start">Quick start</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#configuration">Configuration</a></li>
        <li><a href="#seed-the-databases">Seed the databases</a></li>
        <li><a href="#run">Run</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#repository-map">Repository map</a></li>
    <li><a href="#status-and-known-issues">Status and known issues</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

---

## About the project

ReconMed is a full-stack system for **pre-visit concomitant medication
reconciliation** in clinical trials. It has three moving parts:

1. **A voice agent** calls the participant at the number on file, before a
   scheduled visit. It reads back the medication log, asks what has changed,
   and probes the vague answers ("the little white pill for my blood
   pressure").
2. **A resolution and grounding layer** turns what was said into canonical
   drug concepts (RxNorm), classifies them (RxClass), and checks them against
   *this* trial's protocol rules — flagging any prohibited medication before
   the participant arrives.
3. **A coordinator review screen** shows the reconciliation diff: what the log
   says on the left, what the call produced on the right, one row per proposed
   change. Nothing reaches the medication log until a coordinator confirms it
   under an electronic signature.

The person who uses this is not a physician and not the participant. It is the
**clinical research coordinator**: a busy person with a visit starting in
twenty minutes who needs to know what changed and what needs attention.

**This is not an ambient scribe.** Tools like Abridge and Nuance DAX listen to
an encounter and produce a narrative note. They hold no state between
encounters and they do not know the protocol. ReconMed maintains a longitudinal
medication record, reconciled at every visit and checked against trial-specific
rules. Different artifact, different failure mode, different user.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## The problem

A **concomitant medication** ("conmed") is anything a trial participant takes
besides the study drug — including over-the-counter drugs, vitamins,
supplements, and herbals. The conmed log has to stay accurate for the whole
study, because it feeds safety analysis and because the protocol restricts what
participants may take.

Three things break it:

- **Participants are unreliable reporters.** They describe drugs by appearance
  and purpose, forget they stopped something, and omit supplements because
  those do not feel like medication. Dates come back partial: "a few weeks
  ago".
- **Reconciliation happens under time pressure.** The coordinator has a visit
  to run; medication review is one item among many and gets compressed.
- **Prohibited medications surface too late.** A participant taking a
  prohibited drug is a protocol deviation and can be excluded from the
  per-protocol analysis population — caught today during monitoring, weeks
  after the exposure.

A pilot study of 95 patient visits in a dedicated research unit found that only
**20.6%** of investigational drugs were listed in the EHR after study visits,
and it identified **20 potential protocol-prohibited medications** under current
practice. Today's alternative — a pharmacist reconciling from three sources and
reading the protocol — is thorough, expensive, and does not scale to every
visit.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## How it works

```
 Coordinator clicks "Start pre-visit reconciliation"
        │
        ▼
  [ Telephony ]  ──►  outbound call to the number on file
        │
        ▼
  [ Streaming STT ]  ──►  transcript + confidence
        │
        ▼
  [ Conversation agent ]  ◄── current medication log
        │                 ◄── protocol rules for this study
        │  tools:
        │    health_search(text)      → RxNorm RxCUI + canonical name
        │    check_prohibited(rxcui)  → rule hit + protocol section
        │    patient_read(scope)      → scoped slices of the record
        │    patient_update(op)       → staged, named writes only
        ▼
  proposed changes  (staged, unpromoted)
        │
        ▼
  [ Reconciliation diff ]  ──►  coordinator confirms / rejects / edits
        │
        ▼
  [ Audit trail ]  ──►  signed promotions land in the medication log
```

The agent **never writes to the medication log.** It stages proposals. A
proposal becomes a log entry only when a coordinator promotes it under an
electronic signature (21 CFR 11.50), and every action is written to an
append-only audit trail (21 CFR 11.10(e)).

**Two stores, split on PHI.** The boundary that matters is identifying
information versus clinical record, linked by a pseudonymous subject ID.
`patient_data/` holds the clinical side and references participants by subject
id only — no names, ever. The contact layer the voice agent needs to verify who
it is speaking to is synthesised separately and never touches the clinical
store.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Technical details

Three APIs do the heavy lifting, all proxied server-side, so no key ever reaches
the browser.

**Speech in — Deepgram streaming STT.** The browser captures linear16 mono PCM
and streams it over a WebSocket to `/ws/listen`, which proxies Deepgram's
streaming endpoint (`nova-3`, interim results on). We keep `smart_format` and
`numerals` **off** so a spoken date stays words — "January first" must not come
back as `01/01` before the identity check compares it. Turn end is decided on the
client: ~1 s of silence after a finished sentence (1.6 s when the answer trails
off), with a half-duplex gate that mutes the mic while the agent is speaking.

**Speech out — Deepgram Aura-2 TTS.** `/api/tts` returns raw PCM (`linear16`,
24 kHz, `container=none`), which the client schedules on an `AudioContext` as it
arrives. Replies are split on `.` and synthesised sentence by sentence, so
playback starts on the first sentence while the rest are still being generated.
Voice: `aura-2-helena-en`.

**Reasoning — OpenAI GPT-5.6 Luna (Chat Completions).** Two agents share one model
with different settings. The **Talker** is realtime and always has function tools
attached, so it runs at `reasoning_effort: none`; the **Planner** has no tools and
runs at `reasoning_effort: medium` across two passes (decide retrievals, then
synthesise state). Tool calls arrive as streamed `tool_call` deltas, are executed
against the local databases, and go back as `tool` messages. Every request has a
hard timeout and retries with backoff.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## How we built it

- **Two-model architecture.** The voice pipeline is split in two. One fast model
  handles the live conversation with no lag in the turn-taking; a second runs
  asynchronously between turns to read drug data, plan the conversation, and
  stage proposed updates.
- **Drug normalization and local caching.** We downloaded and cached NLM RxNorm
  and RxClass into local SQLite. A described drug is mapped to canonical
  ingredient concepts and drug classes instantly, with no external request on the
  critical path.
- **Protocol extraction.** An extraction pipeline parses trial protocol documents
  (PDF/DOCX) with structured LLM outputs to pull out the trial details and the
  exact list of prohibited medications and their rules.
- **Strict safety and regulatory separation.** The agent cannot write to the trial
  record; it only stages proposals. Identifying details (name, phone) never mix
  with clinical data, which uses subject IDs only. Promotion to the official log
  needs coordinator review and an e-signature.
- **Offline privacy fallback.** Open-source models (NVIDIA Parakeet for
  speech-to-text, Qwen3-TTS for speech, and a local quantized Gemma) let a site
  run the whole system locally, with no patient audio leaving their network.

## Challenges we ran into

- **Audio latency.** A voice agent only sounds natural with very low response
  times. We buffered the audio streams carefully and split the fast speaking model
  from the slower medical reasoning so the patient is never waiting on a computer.
- **Messy patient descriptions.** People rarely know the brand or generic name of
  their drugs. Getting the agent to ask the right clarifying questions (dose,
  bottle label, what symptom it treats) and to map that to RxNorm without
  hallucinating took a lot of prompt and tool tuning.
- **Protocol parsing.** Protocols are dense 80+ page PDFs with complex tables and
  footnotes. Pulling out clean, machine-readable rules for banned drugs meant
  chunking carefully and enforcing strict JSON schemas.

## Accomplishments we're proud of

- A full end-to-end demo: talk to the agent on the phone, describe a drug vaguely,
  and watch an accurate diff with a prohibited-medication alert appear on the
  dashboard.
- A drug lookup layer that runs entirely against local SQLite, so it is fast,
  reliable, and free of rate limits.
- A working local/offline mode with open-source speech and language models,
  showing this can run in high-privacy clinical settings without cloud
  dependencies.

## What we learned

- How concomitant medication reporting actually works in trials, the regulatory
  requirements around changing data (21 CFR Part 11 audit trails), and why an
  unnoticed protocol deviation ruins study data.
- How to structure multi-agent audio systems: latency-critical conversation
  decoupled from heavier background lookups.
- Navigating federal drug ontologies — RxNorm, ATC classes, and FDA Established
  Pharmacologic Classes.

## What's next for our project

- Connect the coordinator dashboard to real EDC systems (Veeva, Medidata Rave) so
  approved logs sync automatically.
- Support inbound Twilio media streams, so a participant can call the site back
  whenever it suits them.
- Cross-reference adverse events: when a participant reports severe unexpected
  symptoms, automatically flag a safety alert for the site physician.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## HackMIT 2026 sponsor challenges

- **Regeneron — Help Patients: Make Clinical Trials and Biostatistics Better.**
  ReconMed targets a real bottleneck: pre-visit concomitant medication
  reconciliation. It is open source under the MIT license, runs from a clean
  clone, and exists to keep the trial record accurate so a protocol deviation is
  caught on the phone, not in monitoring weeks later.
- **Deepgram — Build Something Worth Talking To.** The project is a full
  end-to-end voice agent on Deepgram: streaming **Nova-3** for speech in and
  **Aura-2** for speech out, behind a server-side WebSocket proxy.
- **OpenAI — 5th Teammate.** **GPT-5.6 Luna** powers both agents through the Chat
  Completions API with function calling, and **Codex** was the development
  teammate for building and iterating on the codebase.
- **Cognition — Best Use of Devin.** Devin was used as an AI software engineer on
  the project, planning, writing, and testing parts of the code alongside us.
- **The Token Company — LLM cost saving.** Cost was a design constraint, not an
  afterthought: NLM RxNorm/RxClass are cached in local SQLite so drug lookups cost
  zero tokens; a fast, no-reasoning model handles the live turn and the deeper
  reasoning runs only in the background; and the whole pipeline can run on
  open-source models (NVIDIA Parakeet, Qwen3-TTS, quantised Gemma) to bring the
  LLM bill to **zero** for sites that need it.
- **Ramp — Save Time. Save Money.** The product exists to save a coordinator time
  (a pre-visit med review becomes a call that runs itself, and the coordinator
  only reviews a diff) and money (it replaces a pharmacist manually reconciling
  three sources against the protocol, and catches deviations before they cost a
  per-protocol exclusion).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Built with

| Layer | Stack |
|---|---|
| Coordinator UI | React 18, TypeScript 5.6, Vite 6 |
| Voice agent | Node.js, `ws`, Deepgram (Nova-3 STT / Aura-2 TTS), OpenAI GPT-5.6 Luna |
| Drug knowledge | NLM RxNorm + RxClass, behind a local SQLite cache |
| Data | SQLite (`node:sqlite`) — no server to stand up for the demo |
| Protocol extraction | Node.js, `unpdf` / `mammoth`, OpenAI structured outputs |
| Offline AI (optional) | Qwen3-TTS 0.6B + NVIDIA Parakeet 0.6B, CPU, via `uv` |
| Deck | LuaLaTeX, Beamer, TikZ |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Quick start

### Prerequisites

- **Node.js 24+** (the databases use the built-in `node:sqlite`).
- **npm**.
- An **OpenAI API key** and a **Deepgram API key** for a live call.
- Optional: [`uv`](https://docs.astral.sh/uv/) + `ffmpeg` for the offline
  models in [`local-ai/`](local-ai/README.md); TeX Live for the deck in
  [`presentation/`](presentation/README.md).

### Installation

```bash
git clone git@github.com:Samuel-O-M/HackMIT-2026.git
cd HackMIT-2026
npm run install:all          # frontend/ + voice/ dependencies
```

### Configuration

Keys live in a gitignored **repo-root `.env`**:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | reasoning / chat |
| `DEEPGRAM_API_KEY` | STT + TTS |
| `TELEPHONY_PROVIDER` | `simulated` (default) or `twilio` |

See [`.env.example`](.env.example) for the telephony options. Model and
reasoning-effort choices are made **in code**
([`voice/brain/config.js`](voice/brain/config.js)), not `.env`.

### Seed the databases

Every database is a derived artifact — delete and rebuild any time.

```bash
npm run seedDb                               # call_sessions + health_guidance
node databases/trial_records/seed.mjs        # conmed.db, from patient_data/
node api/medical_data/build.js               # drugs.db, from NLM RxNav
```

### Run

Start whatever you need — each is independent.

```bash
npm run voice          # voice agent + call UI  → http://localhost:8787
npm run frontend:dev   # coordinator dashboard  → http://localhost:5173
node api/server.mjs    # protocol extraction    → http://localhost:5174
```

For a phone demo, expose port 8787 over HTTPS — `getUserMedia` (the
microphone) only works in a secure context. See
[`api/ngrok/`](api/ngrok/README.md) or [`api/cloudflare/`](api/cloudflare/README.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

**The demo flow** — one participant, one protocol, one call:

1. Open the coordinator dashboard, pick a scheduled participant, and click
   **Start pre-visit reconciliation**.
2. The agent calls the handset (the browser by default) and opens the
   conversation. It reads back the current log and walks the deltas.
3. Say something vague — "something white for my knee" — and watch the diff
   fill in: reported text → RxNorm → ibuprofen → classified NSAID → matched a
   prohibited rule at a protocol section.
4. The prohibited finding fires as a banner above the diff, citing the protocol
   section. Nothing has entered the medication log.
5. Confirm or reject each row, then **Promote to log** under a signature. The
   audit trail records who, when, and why.

More detail lives in each module's README (see the map below); the API-level
walkthrough is in [`voice/README.md`](voice/README.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Repository map

| Path | What it is | README |
|---|---|---|
| [`frontend/`](frontend/) | Coordinator dashboard: reconciliation diff, session list, live call, audit | — |
| [`voice/`](voice/) | Voice agent UI + brain proxy (STT / TTS / orchestrator) | [`voice/README.md`](voice/README.md) |
| [`voice/brain/`](voice/brain/) | The Talker + Planner orchestrator and its tools | [`voice/brain/README.md`](voice/brain/README.md) |
| [`voice/telephony/`](voice/telephony/) | Outbound calling, `simulated` / `twilio` providers | [`voice/telephony/README.md`](voice/telephony/README.md) |
| [`api/`](api/) | Protocol extraction service + shared drug knowledge | [`api/medical_data/README.md`](api/medical_data/README.md) |
| [`api/ngrok/`](api/ngrok/) | HTTPS tunnel for phone access (works on blocked networks) | [`api/ngrok/README.md`](api/ngrok/README.md) |
| [`api/cloudflare/`](api/cloudflare/) | HTTPS tunnel for phone access (Cloudflare) | [`api/cloudflare/README.md`](api/cloudflare/README.md) |
| [`databases/`](databases/) | Every SQLite database, one folder each | [`databases/README.md`](databases/README.md) |
| [`databases/trial_records/`](databases/trial_records/) | The clinical record: trials, rules, proposed changes, audit | [`databases/trial_records/README.md`](databases/trial_records/README.md) |
| [`patient_data/`](patient_data/) | Source-of-truth fixture data (synthetic at site level) | [`patient_data/README.md`](patient_data/README.md) |
| [`patient_data/trials/`](patient_data/trials/) | Trial catalog and real published protocols | [`patient_data/trials/README.md`](patient_data/trials/README.md) |
| [`patient_data/participants/`](patient_data/participants/) | Synthetic participants, visits, sessions, transcripts | [`patient_data/participants/README.md`](patient_data/participants/README.md) |
| [`recognize/`](recognize/) | Experiment: extract protocol rules from a PDF/DOCX with an LLM | — |
| [`local-ai/`](local-ai/) | Offline STT + TTS replacement for the closed APIs | [`local-ai/README.md`](local-ai/README.md) |
| [`presentation/`](presentation/) | The Regeneron track deck, built in LaTeX | [`presentation/README.md`](presentation/README.md) |
| [`scripts/`](scripts/) | Data build and transcript tooling | — |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Status and known issues

The demo path is complete and runs from a clean clone. What is deliberately
unfinished is written down rather than guessed at:

- **Postgres driver** — `databases/connection.mjs` resolves every database from
  the environment but raises a clear error instead of pretending. Implementing
  it is `npm i pg` plus one function against the same surface SQLite exposes.
- **Twilio inbound audio** — the `twilio` provider is written, but the
  `/ws/twilio` socket handler needs an 8 kHz mu-law ↔ 16-bit PCM codec shim.
- **Offline live streaming STT** — [`local-ai/`](local-ai/README.md) serves the
  batch transcription path; buffered Parakeet streaming is a follow-up.
- **Adverse-event reporting** — serious symptoms are surfaced to the
  coordinator, but the sponsor's AE reporting path is not built.
- **Public tunnels** — the ngrok / Cloudflare tunnels are unauthenticated.
  Share the URL privately and stop the tunnel when done.
- **Dashboard is mock-driven** in places; "Start call" does not yet drive the
  voice agent end to end.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Voice agent with grounded tool use and staged proposals
- [x] Coordinator reconciliation diff with prohibited-medication alert
- [x] RxNorm / RxClass resolution behind a local cache
- [x] Real published protocols with cited prohibited sections
- [ ] Postgres driver behind `connection.mjs`
- [ ] Twilio media-stream codec (`/ws/twilio`)
- [ ] Buffered streaming STT in `local-ai/`
- [ ] AE reporting cross-link
- [ ] EDC export

See the [open issues](https://github.com/Samuel-O-M/HackMIT-2026/issues) for a
full list of proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are welcome. This began as a HackMIT 2026 project, and the same
hygiene still applies:

1. Fork the project.
2. Create a feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a pull request.

Keep commits focused; do not commit `.env`, database files, model weights, or
generated transcripts. See [`frontend/CLAUDE.md`](frontend/CLAUDE.md) for the
frontend branch's working conventions.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for the full
text.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributors

Built at **HackMIT 2026** for the **Regeneron** track.

- **Samuel Orellana Mateo** — [@Samuel-O-M](https://github.com/Samuel-O-M)
- **Ayushi Mehrotra** — [@ayushimehrotra](https://github.com/ayushimehrotra)
- **Avighna Chhatrapati** — [@avighnac](https://github.com/avighnac)

<a href="https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Samuel-O-M/HackMIT-2026" alt="Contributors" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- **HackMIT 2026** and the **Regeneron** track, and the Regeneron starter kit
  in [`regeneron-starter-kit/`](regeneron-starter-kit/).
- [NLM RxNav / RxClass](https://rxnav.nlm.nih.gov/) — free, no-key drug
  normalization and classification.
- [Deepgram](https://deepgram.com/) (Nova-3, Aura-2) and
  [OpenAI](https://openai.com/) (GPT-5.6 Luna) for the voice pipeline.
- [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) and
  [NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-unified-en-0.6b) for
  the offline path.
- [Lucide](https://lucide.dev/) icons and the open-source LaTeX ecosystem.
- [othneildrew/Best-README-Template](https://github.com/othneildrew/Best-README-Template),
  [matiassingers/awesome-readme](https://github.com/matiassingers/awesome-readme),
  and [readme.so](https://readme.so/) for this README's structure.

## Links

- **Code:** [github.com/Samuel-O-M/HackMIT-2026](https://github.com/Samuel-O-M/HackMIT-2026)

## Contact

Project link:
[github.com/Samuel-O-M/HackMIT-2026](https://github.com/Samuel-O-M/HackMIT-2026)

**All data in this repository is synthetic and for demonstration only. Nothing
here is medical advice.**

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[license-shield]: https://img.shields.io/github/license/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[license-url]: https://github.com/Samuel-O-M/HackMIT-2026/blob/main/LICENSE
[contributors-shield]: https://img.shields.io/github/contributors/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[contributors-url]: https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors
[hackmit-shield]: https://img.shields.io/badge/HackMIT-2026-1f6feb?style=for-the-badge
[hackmit-url]: https://hackmit.org/
