<a id="readme-top"></a>

[![MIT License][license-shield]][license-url]
[![Contributors][contributors-shield]][contributors-url]

# Trial records — `conmed.db`

> A SQLite database built from the JSON under `patient_data/`.

Part of **[ReconMed](../../README.md)** — pre-visit concomitant medication
reconciliation for clinical trial sites. See also the
[`databases/` overview](../README.md).

```
node patient_data/db/seed.mjs        # rebuild db/conmed.db from data/
sqlite3 patient_data/db/conmed.db    # open it
```

`patient_data/` is the source of truth. `conmed.db` is a derived artifact — safe to
delete and rebuild at any time, and it is not what the frontend reads.

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#why-it-exists">Why it exists</a></li>
    <li><a href="#shape">Shape</a></li>
    <li><a href="#two-domain-rules-are-enforced-here-not-just-in-the-ui">Two domain rules</a></li>
    <li><a href="#dates">Dates</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contributors">Contributors</a></li>
  </ol>
</details>

## Why it exists

The frontend loads the JSON directly and needs no database. This is for the
**agent and backend branches**: the voice agent's `check_prohibited` tool has to
answer "is this drug prohibited on this trial, and under which rule?" on every
call, which is a join, not a file read.

```sql
SELECT pr.rule_id, pr.class_name, pr.protocol_section, pr.threshold, pr.rationale
FROM trials t
JOIN protocols p         ON p.study_id = t.study_id AND p.status = 'active'
JOIN prohibited_rules pr ON pr.document_id = p.document_id
JOIN medications m       ON m.trips_class = pr.class_name
WHERE t.study_id = ? AND m.rxcui = ?;
```

Note the same rule cites a different section on different trials — §5.7.2 on
R2810-ONC-1540, §8.10.1 on R2810-ONC-1676 — because those are the real section
numbers in each protocol. A finding has to carry the section of *its* trial's
document.

## Shape

16 tables. It follows `shared/types.ts` (mirrored in `frontend/src/types/`),
normalising where the TypeScript nests: a `ProposedChange` holds two
`ConmedEntry` objects, which here are two rows in `conmed_entries` joined by id.

| Group | Tables |
|---|---|
| Trial | `trials`, `protocols`, `prohibited_rules` |
| People | `participants`, `visits`, `sessions` |
| Reconciliation | `proposed_changes`, `conmed_entries`, `tool_steps` |
| Call | `transcript_turns`, `transcript_yields` |
| Regulated record | `audit_events`, `queries`, `deviations`, `promotions` |
| Reference | `medications` |

`trial_summary` is a view giving the per-trial rollup the picker screen shows.

## Two domain rules are enforced here, not just in the UI

**No participant names.** `participants` has a subject id and nothing else, and
must never gain a name column. PHI lives in a separate store.

**Nothing is promoted without a signature.** `promotions` requires
`signed_by`, `signed_name`, `signature_meaning` and `signed_at` — 21 CFR 11.50
requires a signature manifestation to carry the printed name, the time, and what
the signature means. `audit_events.reason` carries the "why" that 11.10(e) wants.

## Dates

`patient_data/` stores scheduling times as an offset from today so the demo never looks
stale; the seed resolves them to ISO instants. Rebuild the database to move the
schedule to the current day. Clinical dates are stored as written.

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
