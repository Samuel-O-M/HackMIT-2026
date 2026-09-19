# CLAUDE.md — frontend branch

Working context for Claude Code on the `frontend` branch. This branch owns the coordinator-facing UI and nothing else.

---

## What this project is

Pre-visit concomitant medication reconciliation for clinical trial sites.

Before a trial visit, a voice agent calls the participant and walks through their medications. It resolves what they say to canonical drug concepts, checks those against the trial protocol's prohibited list, and stages the result. A **clinical research coordinator** then reviews the staged changes and promotes the accepted ones into the medication log.

The UI is where that review happens. It is the part a judge looks at, so it is the deliverable, not a wrapper.

**The user is the coordinator.** Not a physician, not a patient. A busy person with a visit starting in twenty minutes who needs to know what changed and what needs attention.

---

## This branch's scope

**Owns:**
- `src/` — all UI code
- `src/mocks/` — fixture data for building without the backend
- UI-only dependencies in `package.json`

**Does not touch:**
- `server/`, `agent/`, `db/`, migrations, or anything under `protocol/`
- The shared type definitions in `shared/types.ts` — read them, do not edit them. If a type is wrong or missing, raise it rather than changing it locally, or the merge conflicts.

If a task seems to require a backend change, stop and say so instead of reaching across the boundary.

---

## Data contract

Build against these shapes. They come from `shared/types.ts`; this is a summary for orientation, not a substitute for reading the file.

```ts
type ChangeType = 'add' | 'stop' | 'modify' | 'confirm_unchanged';
type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'edited';
type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

interface ConmedEntry {
  logId: string;
  reportedText: string;        // verbatim, what the participant said
  rxcui: string | null;        // null when unresolved — this is a valid state
  canonicalName: string | null;
  indication: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  startDate: string | null;
  startDatePrecision: DatePrecision;
  stopDate: string | null;
  stopDatePrecision: DatePrecision;
  ongoing: boolean;
}

interface ProhibitedHit {
  ruleId: string;
  matchedOn: 'drug' | 'class';
  className: string | null;    // e.g. "NSAID"
  protocolSection: string;     // e.g. "6.5"
  rationale: string;
}

interface ToolStep {
  tool: string;                // resolve_drug | classify_drug | check_prohibited | resolve_date
  input: string;
  output: string;
}

interface ProposedChange {
  changeId: string;
  changeType: ChangeType;
  targetLogId: string | null;  // null for 'add'
  current: ConmedEntry | null; // null for 'add'
  proposed: ConmedEntry;
  agentConfidence: number;     // 0–1
  agentReasoning: string;
  toolTrace: ToolStep[];
  prohibitedHit: ProhibitedHit | null;
  reviewStatus: ReviewStatus;
}

interface ReconciliationSession {
  sessionId: string;
  subjectId: string;           // never a name — PHI lives in a separate store
  studyId: string;
  nctId: string;
  startedAt: string;
  endedAt: string | null;
  status: 'in_progress' | 'awaiting_review' | 'completed';
  changes: ProposedChange[];
}
```

**Two rules that follow from the data model:**

1. Never render a participant name. The clinical store holds `subjectId` only, by design. If a name appears in a mock, that is a bug in the mock.
2. Nothing is committed until the coordinator promotes it. The UI must never imply a change has landed before that click.

---

## Screens, in build order

### 1. Reconciliation diff (build this first, it is the demo)

Two columns: what the log says now, what the call produced. One row per proposed change, marked by `changeType`.

Requirements:
- Prohibited hits surface above the diff, not buried in a row. Include the drug, the class it matched, and the protocol section.
- Every row: confirm and reject. Inline edit on the proposed values.
- Every row exposes `agentReasoning` and `toolTrace` on demand. Collapsed by default, one interaction to open. This is the credibility surface — a judge will open it.
- `agentConfidence` is visible but not screaming. Low confidence should pull the eye without turning the screen into an alert.
- `rxcui: null` renders as an explicit unresolved state with the verbatim text shown. An unresolved medication is a real output, not an error.
- Partial dates render their precision honestly. "Around March 2026" for month precision, never a fake exact date.
- A promote action for accepted changes, with a count. Disabled until at least one row is accepted.

### 2. Session list

Scheduled participants, their reconciliation status, and an action to start a call. Sorted by upcoming visit. Sessions awaiting review are the ones that matter.

### 3. Live call view

Streaming transcript and fields populating as the agent works. Read-only. Its job is to make the call legible while it happens, not to allow intervention.

### 4. Audit view (last, cut if needed)

Append-only history for a session. Who promoted what and when.

---

## Design direction

Ground it in the subject: a clinical workstation used under time pressure, where the cost of a missed flag is a protocol deviation. That is closer to an air traffic console or a trading terminal than to a consumer SaaS dashboard. Dense, legible, calm, with one loud thing.

**Spend the boldness on the prohibited-medication alert.** Everything else stays quiet so that when it fires, it is unmistakable. If two things on screen compete for alarm, neither reads as alarming.

**Type carries the work.** Pick a family with a real range of weights and good numerals, and set a clear scale. Drug names, doses, and dates are scanned, not read, so tabular figures matter more than personality here.

**Structure encodes meaning.** Change type, confidence, and review state are all information. Let borders, weight, and position carry them rather than adding decorative chrome. Do not number things that are not a sequence.

**Motion only on state change.** A row moving from pending to accepted should show what changed. No entrance animations, no hover transitions on every card.

**Avoid the generated-page defaults:** cream background with a serif display and terracotta accent; identical rounded cards with the same soft shadow; all-caps tracked-out eyebrow labels above every heading; arrows appended to button text; monospace for small labels as decoration. Monospace is fine where it earns its place, such as RxCUIs.

**Copy is design content.** Write from the coordinator's view. "Confirm" not "Submit." The button that says "Promote to log" produces a toast that says "Promoted to log." Empty states point at the next action. Errors say what happened and what to do.

---

## Working practices

- Build every screen against `src/mocks/` fixtures. Do not block on the backend, and do not stub API calls in component files — everything goes through one `src/api/` layer so the swap to real endpoints is a single change.
- Include a fixture for each hard case: unresolved drug, month-precision date, low confidence, prohibited hit, and a session with no changes at all.
- Responsive down to tablet. Coordinators use tablets. Phone is out of scope.
- Visible keyboard focus, reduced motion respected, real contrast ratios. Build to that floor without narrating it.
- Do not add a dependency for something small. Every package is a merge conflict and an install step on someone else's machine.

## Demo constraints

The demo is live and on conference wifi. Therefore:
- No layout that reflows visibly on load.
- Nothing that requires a network call to render the first meaningful screen.
- A demo mode that replays a fixture session end to end without the backend. Build this by hour 14, not hour 23.

## Merge hygiene

This branch merges to `main` via pull request.

- Small, focused commits. One screen or one concern per commit.
- Never commit changes to `shared/types.ts`, `server/`, `agent/`, or `db/`. If the PR touches those, it will be rejected.
- Rebase on `main` before opening the PR.
- The PR description says what screens are included, what is still mocked, and anything the backend needs to provide.

## Out of scope on this branch

Authentication, multi-user, participant-facing views, EDC export, real telephony. If asked for any of these, say they are out of scope for this branch rather than building them.