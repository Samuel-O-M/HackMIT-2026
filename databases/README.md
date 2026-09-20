<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# Databases

> Every database in the project, one folder each, named for what it holds.

Part of **[ReconMed](../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites.

| Folder | Database | What it is | Written by |
|---|---|---|---|
| `trial_records/` | `conmed.db` | The clinical record: trials, protocols and their prohibited rules, participants, visits, sessions, **proposed changes**, dispositions, audit trail. | `seed.mjs`, from `patient_data/` |
| `call_sessions/` | `patient.db` | A call in progress: utterances, planner state, identity checks, and **staged changes** the agent has proposed but nobody has reviewed. | the voice brain, live |
| `drug_reference/` | `drugs.db` | RxNorm / RxClass cache — resolve a drug, classify it, check it against a rule. | `api/medical_data/build.js` |
| `health_guidance/` | `general_health.db` | Read-only plain-language guidance the agent may quote. Never patient-specific. | `voice/brain/db/seed.js` |

All four are **derived artifacts**. Delete any of them and rebuild:

```bash
node databases/trial_records/seed.mjs     # from patient_data/
node voice/brain/db/seed.js               # call_sessions + health_guidance
node scripts/seed-voice-db.mjs            # grounds the voice agent in patient_data
node api/medical_data/build.js            # drug_reference, from RxNav
```

They are gitignored. `patient_data/` is the source of truth for anything clinical.

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#local-for-the-demo-external-when-you-need-it">Local for the demo, external when you need it</a></li>
    <li><a href="#where-staged-data-lives-and-why-there-are-two-places">Where staged data lives</a></li>
    <li><a href="#where-transcripts-live">Where transcripts live</a></li>
    <li><a href="#known-issues">Known issues</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

## Local for the demo, external when you need it

Everything above is local SQLite on purpose: the demo has to run on conference
wifi with nothing to stand up. But nothing opens a database by path — it goes
through `connection.mjs`, which resolves each one from the environment and
falls back to the local file:

```bash
TRIAL_RECORDS_URL=postgres://user:pass@host:5432/trials   # one database
DATABASE_URL=postgres://user:pass@host:5432/app           # or all of them
```

Set nothing and you get the demo. Set a URL and that database points at a
server, with no other change in the codebase.

**What is not done:** an actual Postgres driver. `connection.mjs` raises a clear
error rather than pretending, and documents exactly what implementing it takes —
`npm i pg` plus one function, against the same three-method surface SQLite
exposes. `schema.sql` is close to portable; the four SQLite-isms that would need
changing are listed at the bottom of `connection.mjs`.

```
node -e "import('./databases/connection.mjs').then(m=>console.table(m.describe()))"
```

shows where each database currently resolves to, with credentials redacted.

## Where staged data lives, and why there are two places

A change the voice agent proposes exists in two forms, on purpose:

1. **`call_sessions/patient.db` → `staged_changes`** — transient. The agent
   accumulates proposals here *during* a live call.
2. **`trial_records/conmed.db` → `proposed_changes`** — durable. What the
   coordinator actually reviews, confirms, rejects, queries and finally promotes.

Neither is the medication log. **The agent never writes to the log.** A
proposal becomes a medication-log entry only when a coordinator promotes it,
under an electronic signature. If the agent wrote directly, rejecting a
proposal would mean deleting a row, and the audit trail would no longer show
what was proposed and declined — which is the thing a monitor comes to check.

## Where transcripts live

Three places, for three different reasons:

| Location | Purpose | Kept? |
|---|---|---|
| `call_sessions/patient.db` → `utterances` | the live call, written turn by turn | until the call ends |
| `voice/logs/<sessionId>.jsonl` | full debug record — every tool call, planner pass and latency | gitignored, local only |
| `patient_data/participants/transcripts.json` | what the app replays on the Transcript screen | committed |

The first is the working copy, the second is for debugging, and the third is
the one that belongs to the clinical record.

## Known issues

- No Postgres driver yet — see above; the interface is defined, the
  implementation is not.
- Every `.db` is gitignored and must be rebuilt after a clone.

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
