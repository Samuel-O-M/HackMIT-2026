# What the frontend needs from the backend

The UI is built against `src/types/contract.ts`, a verbatim mirror of the
contract in CLAUDE.md. Per the branch rules this file was **not** edited — the
gaps found while building are raised here instead.

## 1. `shared/types.ts` does not exist yet

`src/types/contract.ts` mirrors it. When the real file lands on `main`, that
mirror should collapse to `export * from '../../../shared/types'`.

## 2. Missing on `ConmedEntry`: `atcClass`

The UI can show a drug's ATC class only when a prohibited-rule match happens to
carry one (`ProhibitedHit.className`). Every resolved medication has a class,
and coordinators use it to scan. Proposed:

```ts
atcClass: string | null;   // e.g. "Systemic corticosteroid"
atcCode: string | null;    // e.g. "H02AB07"
```

## 3. Drug dictionary: RxNorm now, WHODrug later

`rxcui`/`canonicalName` map to `CMTRT`/`CMDECOD` in the SDTM CM domain, and the
UI labels them as such. RxNorm is the right call for an MIT-licensed project —
it is free and needs no licence, while WHODrug Global requires a paid UMC
subscription. If the sponsor supplies a WHODrug licence, the contract should
gain `whodrugCode` / `whodrugDrn` alongside the RxNorm fields rather than
replacing them.

## 4. `ReviewStatus` has no queried state — and should not get one

A query does **not** disposition a change: a queried row stays `pending`, which
is correct. Queries are modelled separately (`DataQuery` in `src/types/ui.ts`)
and keyed by `changeId`. The backend should own them but keep them off
`ReviewStatus`.

## 5. New endpoints the UI calls

All defined in `src/api/transport.ts`; `src/api/httpTransport.ts` is a working
implementation waiting on these routes.

| Method | Route | Notes |
|---|---|---|
| `PATCH` | `/sessions/:id/changes/:changeId` | body gains **`reason`** — required |
| `POST` | `/sessions/:id/changes/:changeId/queries` | `{ text }` → `DataQuery` |
| `GET` | `/sessions/:id/queries` | `DataQuery[]` |
| `POST` | `/sessions/:id/changes/:changeId/deviations` | `DeviationInput` → `ProtocolDeviation` |
| `GET` | `/sessions/:id/deviations` | `ProtocolDeviation[]` |
| `POST` | `/sessions/:id/promote` | body gains **`signature`** — required |
| `GET` | `/sessions/:id/stream` | SSE of `CallEvent`, incl. `{type:'unavailable'}` |

**`reason` and `signature` are not optional.** 21 CFR 11.10(e) requires audit
trails to record who, when and why; 11.50 requires a signature manifestation
carrying printed name, timestamp and meaning. The backend should reject an edit
without a reason and a promote without a signature — the UI already does.

## 6. `AuditEvent.reason`

Audit events carry `reason: string | null`. Events that change a value must
populate it; decision-only events leave it null.

## 7. Protocol deviations are a real record, not a UI flag

A prohibited conmed is a reportable deviation. `ProtocolDeviation` is currently
UI-side; it belongs in the backend and probably in its own store, since the PI
signs it and the IRB report draws from it.
