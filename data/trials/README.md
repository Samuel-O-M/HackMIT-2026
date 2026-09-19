# Trial documents

One folder per trial, named by its protocol number. Everything a site needs to
run medication reconciliation for that trial lives in its folder:

| Document | Why it is needed |
|---|---|
| **Clinical Study Protocol** | Defines the prohibited medications. The list lives in the protocol's concomitant medications section, and it is the only authoritative source for it. Without this the agent can record what a participant reports but cannot tell you whether any of it is prohibited. |
| **Baseline medication log** | The concomitant medications already on file for enrolled participants. This is the "in the medication log" side of the reconciliation diff — without it there is nothing to reconcile against, only a list of what was said. |
| **Visit schedule** | Which participants are due and when, so calls can be placed ahead of each visit. |

## What is here

Four real published Clinical Study Protocols, downloaded from
ClinicalTrials.gov. The section listed is the one the app attributes its
prohibited rules to, taken from each document's own table of contents:

| Trial | NCT | Indication | Prohibited medications section |
|---|---|---|---|
| `R2810-ONC-1540` | NCT02760498 | Advanced cutaneous squamous cell carcinoma | §5.7.2 Prohibited Medications and Concomitant Treatments |
| `R2810-ONC-1676` | NCT03257267 | Recurrent/metastatic cervical cancer | §8.10.1 Prohibited Medications and Procedures |
| `R2810-ONC-1620` | NCT03132636 | Advanced basal cell carcinoma | §7.7.1 Prohibited Medications and Procedures |
| `R2810-ONC-1624` | NCT03088540 | Metastatic non-small cell lung cancer | §7.7.1 Prohibited Medications |

`R1979-ONC-22102/` (odronextamab + lenalidomide, NCT06149286) is deliberately
empty. ClinicalTrials.gov publishes a protocol only once results are posted,
and that study is still active — so there genuinely is no document to
download. This is the ordinary case for a trial a site is currently running,
and it is why the app has an upload: the coordinator gets the protocol from the
sponsor, not from the registry. It is also the trial to demonstrate the upload
flow on, since its prohibited screening is off until a protocol is loaded.

All five trials are real Regeneron studies. Only the site-level detail in the
app — investigators, enrolment counts, participants and what they said on the
calls — is synthetic.

The app serves this directory at `/protocol-docs` in development
(see `frontend/vite.config.ts`); in production the backend serves it.
