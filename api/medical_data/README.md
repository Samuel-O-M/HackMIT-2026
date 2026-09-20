<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# medical_data

> One place to ask "what is this drug, and what is it part of?".

Part of **[ReconMed](../../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. This module lives in the backend layer
and is shared by [`voice/`](../../voice/README.md) (the call agent) and
[`recognize/`](../../recognize/) (protocol extraction).

```js
const meds = require('../../api/medical_data');

await meds.resolveDrug('Advil');            // -> { rxcui: '5640', name: 'ibuprofen', match: 'exact', ... }
await meds.classify('5640');                // -> ATC + FDA EPC classes (ATC ancestors included)
await meds.resolveClass('systemic corticosteroid'); // -> { quality: 'exact', classes: [{ classId: 'H02', ... }] }
await meds.checkProhibited('8640', [{ ruleId: 'PR-0021', classIds: ['H02'] }]);
```

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#where-the-data-comes-from">Where the data comes from</a></li>
    <li><a href="#behaviour-worth-knowing">Behaviour worth knowing</a></li>
    <li><a href="#cli">CLI</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

## Where the data comes from

NLM RxNav / RxClass (free, no key), behind a SQLite cache (`drugs.db`).
Lookups go to the cache first and fall through to the live API, writing
what they learn back. The committed `drugs.db` is a snapshot from `node build.js`
(~90 common drugs, the fixture drugs, and the full ATC + EPC class catalogue),
so a clean clone works with no network.

| Env var | Effect |
|---|---|
| `DRUGDB_OFFLINE=1` | Never touch the network; cache only. |
| `RXNAV_BASE` | Use a local RxNav-in-a-Box instead of nlm.nih.gov. |
| `DRUGDB_PATH` | Use a different cache file. |

## Behaviour worth knowing

- **Unknown is unknown.** `found: false` for anything it cannot resolve. A
  network failure is `unavailable: true`. It never invents an answer.
- **Fuzzy matches are suggestions.** `match: 'approximate'` means the spelling
  differed ("prednasone"). RxNav's own fuzzy score cannot tell good from bad,
  so a fuzzy hit is only accepted when most of the words said appear in the
  candidate's name; otherwise it is `found: false` with `candidates` to offer.
- **Products resolve to ingredients.** "Tylenol" -> acetaminophen (161).
- **Two class systems.** ATC (`H02`, hierarchical; a drug is reported under
  every ancestor) and FDA Established Pharmacologic Class (`N0000175576`).
  Rules should carry both where they exist: aspirin is an "NSAID" by EPC but
  not by ATC `M01A`.
- **Class search is by words, so it grades itself.** `resolveClass().quality`:
  `exact` (safe to apply), `partial` (apply, show a human what was dropped),
  `weak` (suggestions only), `none`. Known noise: "antineoplastic agent" also
  returns `V03AF` (detoxifying agents for antineoplastic treatment).
- **Membership only.** Dose and timing limits ("> 10 mg/day prednisone
  equivalent") are not something a drug database answers; the caller checks
  those against what was reported.

## CLI

```
node cli.js drug "tylenol"
node cli.js classify 8640
node cli.js class "live attenuated vaccine"
node cli.js check 8640 H02
node build.js            # re-warm drugs.db and audit the fixture RxCUIs
```

Requires Node 24 (`node:sqlite`).

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
