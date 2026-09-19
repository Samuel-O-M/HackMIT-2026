# Patient data

All fixture data for the app, kept out of the frontend so the backend, agent
and voice branches can read the same files.

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

## What is real and what is not

**Real:** every trial. Protocol numbers, NCT identifiers, phases, indications
and investigational products come from each study's ClinicalTrials.gov record.
Four of the five have their actual published Clinical Study Protocol checked in,
and the prohibited rules cite the section of that document they were read from.

**Synthetic:** everything at site level — investigator names, enrolment counts,
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
