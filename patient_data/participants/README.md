<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# Participants

> Synthetic participants, their scheduled visits, and the calls the voice agent
> made to them. No real participant data is here.

Part of **[ReconMed](../../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. See also the
[`patient_data/` overview](../README.md).

| File | What it holds |
|---|---|
| `visits.json` | One row per participant per visit: when it is due, and the state of that visit's reconciliation. Drives the visits table. |
| `sessions.json` | One reconciliation session per call, holding the proposed changes: what the log says now, what the call produced, the agent's confidence and reasoning, its tool trace, and any prohibited finding. |
| `transcripts.json` | What was said on each call, keyed by session. `atMs` is the offset from call start; `yields` names the change ids a turn produced, so the capture panel fills in step with the words that caused it. |
| `audit.json` | Seeded call history per session. Everything the coordinator does during a browser session is appended on top of this. |

Participants are identified by subject ID only. The clinical store holds no
names by design — a reconciliation tool has no business touching the PHI store,
and the UI never renders a name.

Every session in `sessions.json` has a transcript, and every change id a
transcript yields exists in that session.

Calls made after the build are not written here. The api service saves them to
`patient_data/published/` (gitignored) and the app loads them at runtime, so
these files stay as committed.

## License

Distributed under the MIT License. See [`../../LICENSE`](../../LICENSE).

## Contributors

Built at **HackMIT 2026** for the **Regeneron** track.

- **Samuel Orellana Mateo** — [@Samuel-O-M](https://github.com/Samuel-O-M)
- **Ayushi Mehrotra** — [@ayushimehrotra](https://github.com/ayushimehrotra)
- **Avighna Chhatrapati** — [@avighnac](https://github.com/avighnac)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[license-shield]: https://img.shields.io/github/license/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[license-url]: ../../LICENSE
[contributors-shield]: https://img.shields.io/github/contributors/Samuel-O-M/HackMIT-2026.svg?style=for-the-badge
[contributors-url]: https://github.com/Samuel-O-M/HackMIT-2026/graphs/contributors
