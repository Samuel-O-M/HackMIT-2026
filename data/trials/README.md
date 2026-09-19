# Trial documents

One folder per trial, named by its protocol number. Everything a site needs to
run medication reconciliation for that trial lives in its folder:

| Document | Why it is needed |
|---|---|
| **Clinical Study Protocol** | Defines the prohibited medications. The list lives in the protocol's concomitant medications section, and it is the only authoritative source for it. Without this the agent can record what a participant reports but cannot tell you whether any of it is prohibited. |
| **Baseline medication log** | The concomitant medications already on file for enrolled participants. This is the "in the medication log" side of the reconciliation diff — without it there is nothing to reconcile against, only a list of what was said. |
| **Visit schedule** | Which participants are due and when, so calls can be placed ahead of each visit. |

## What is here

- `R2810-ONC-1540/` — the real published Clinical Study Protocol (Amendment 9)
  for the pivotal cemiplimab study in advanced cutaneous squamous cell
  carcinoma, downloaded from ClinicalTrials.gov (NCT02760498). Its §5.7.2,
  "Prohibited Medications and Concomitant Treatments", is the section the
  prohibited rules in the app are attributed to.
- `R1979-ONC-22102/` (odronextamab + lenalidomide, NCT06149286) and
  `R4018-ONC-2445/` (ubamatamab, NCT06787612) — real registered trials whose
  protocols are **not** published. ClinicalTrials.gov posts a protocol only at
  results posting, and both are still active, so there is no file to download.
  Their rule sets are represented in the app fixtures.
- `R3767-ONC-22122/` (fianlimab + cemiplimab, NCT06246916) — deliberately
  empty. This trial demonstrates the state a coordinator actually starts from:
  the trial is open at the site, no protocol has been loaded, and prohibited
  screening is off until one is uploaded.

All four trials are real Regeneron studies; only the site-level detail in the
app (investigators, enrolment counts, participants) is synthetic.

The app serves this directory at `/protocol-docs` in development
(see `frontend/vite.config.ts`); in production the backend serves it.
