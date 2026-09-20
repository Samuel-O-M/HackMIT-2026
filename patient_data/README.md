<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# Patient data

> All fixture data for the app, kept out of the frontend so the backend, agent
> and voice branches can read the same files.

Part of **[ReconMed](../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. This directory is the **source of
truth** for anything clinical.

```
patient_data/
  trials/
    trials.json          the trials this site is running
    protocols.json       each trial's protocol document and its prohibited rules
    <PROTOCOL-NUMBER>/   the protocol document itself
  participants/
    visits.json          scheduled visits, one row per participant per visit
    sessions.json        reconciliation sessions — what each call proposed
    transcripts.json     what was said on each call
    audit.json           seeded call history per session
```

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#what-is-real-and-what-is-not">What is real and what is not</a></li>
    <li><a href="#dates">Dates</a></li>
    <li><a href="#regenerating">Regenerating</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

## What is real and what is not

**Real:** every trial. Protocol numbers, NCT identifiers, phases, indications
and investigational products come from each study's ClinicalTrials.gov record.
Four of the five have their actual published Clinical Study Protocol checked in,
and the prohibited rules cite the section of that document they were read from.

**Synthetic:** everything at site level — investigator names, enrollment counts,
the participants, their medications, and everything said on the calls. No real
participant data is in this repository, and none should be.

## Dates

Scheduling times — when a call happened, when a visit is due — are stored as an
offset from today:

```json
"visitAt": { "dayOffset": 0, "time": "10:30" }
```

so the demo never looks stale. `frontend/src/mocks/schedule.ts` turns these back
into ISO strings at load. Clinical dates (a medication start date, a protocol
effective date) are real calendar dates and are stored literally as `YYYY-MM-DD`.

## Regenerating

The JSON was exported from the typed fixtures and is now the source of truth —
edit it directly. `frontend/src/mocks/*.ts` are thin loaders that read these
files and assert the shapes in `frontend/src/types/`.

The broader rebuild path is `npm run build:data`
([`scripts/build-data.mjs`](../scripts/build-data.mjs)), which composes the
fixture workload from the ClinicalTrials.gov catalog and the curated medication
list, preserving hand-written sessions verbatim.

See [`trials/README.md`](./trials/README.md) and
[`participants/README.md`](./participants/README.md) for the two halves.

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
