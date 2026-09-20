-- Conmed reconciliation — relational schema.
--
-- Shapes follow shared/types.ts (mirrored in frontend/src/types/). Where the
-- TypeScript nests, this normalises: a ProposedChange carries two ConmedEntry
-- objects, which become two rows in conmed_entries joined by id.
--
-- Two rules from the domain are enforced here, not just in the UI:
--   * A participant is identified by subject id only. There is no name column,
--     and there must never be one — PHI lives in a separate store.
--   * Nothing is promoted without a signature. promotions requires one.

PRAGMA foreign_keys = ON;

CREATE TABLE trials (
  study_id                TEXT PRIMARY KEY,
  nct_id                  TEXT NOT NULL UNIQUE,
  short_title             TEXT NOT NULL,
  investigational_product TEXT NOT NULL,
  indication              TEXT NOT NULL,
  phase                   TEXT NOT NULL CHECK (phase IN ('Phase 1','Phase 2','Phase 3')),
  enrolled_at_site        INTEGER NOT NULL DEFAULT 0,
  principal_investigator  TEXT,
  site_id                 TEXT NOT NULL DEFAULT 'Site 042'
);

-- The Clinical Study Protocol. A trial with no row here has no prohibited rule
-- set, which is why prohibited screening is off for it.
CREATE TABLE protocols (
  document_id     TEXT PRIMARY KEY,
  study_id        TEXT NOT NULL REFERENCES trials(study_id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  protocol_number TEXT NOT NULL,
  amendment       TEXT,
  effective_date  TEXT,
  size_bytes      INTEGER,
  page_count      INTEGER,
  conmed_section  TEXT,          -- e.g. '5.7.2', read from the document itself
  source_path     TEXT,
  uploaded_by     TEXT NOT NULL,
  uploaded_at     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('parsing','active','superseded','failed')),
  UNIQUE (study_id, status) ON CONFLICT REPLACE
);

CREATE TABLE prohibited_rules (
  document_id      TEXT NOT NULL REFERENCES protocols(document_id) ON DELETE CASCADE,
  rule_id          TEXT NOT NULL,
  matched_on       TEXT NOT NULL CHECK (matched_on IN ('drug','class')),
  label            TEXT NOT NULL,
  class_name       TEXT,
  protocol_section TEXT NOT NULL,
  threshold        TEXT,
  rationale        TEXT NOT NULL,
  PRIMARY KEY (document_id, rule_id)
);

CREATE TABLE participants (
  subject_id       TEXT PRIMARY KEY,     -- never a name, by design
  study_id         TEXT NOT NULL REFERENCES trials(study_id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN
                     ('screening','enrolled','discontinued','screen_failed','completed')),
  -- Assigned at consent, before eligibility is known. A screen failure keeps
  -- this and never receives a subject id from randomization.
  screening_number TEXT,
  consent_version  TEXT,
  consent_date     TEXT,
  enrolled_date    TEXT,
  -- The signed ICF. Consent precedes every study procedure, so an enrollment
  -- without this on file is not defensible.
  icf_filename     TEXT
);

-- CDISC SDTM DS (Disposition). How a participant leaves a study.
--
-- There is deliberately no DELETE path for a participant anywhere in this
-- schema. Leaving is an event recorded here; the participant row, their
-- visits, sessions and proposed changes all stay. Deleting them would destroy
-- the audit trail and the denominator of the analysis.
--
-- Append-only, and more than one row per participant is normal: end of
-- treatment and end of study are separate disposition events.
CREATE TABLE dispositions (
  disposition_id        INTEGER PRIMARY KEY,
  subject_id            TEXT NOT NULL REFERENCES participants(subject_id) ON DELETE CASCADE,
  study_id              TEXT NOT NULL REFERENCES trials(study_id) ON DELETE CASCADE,
  -- DSDECOD: the standardised term the sponsor counts. Note it is
  -- 'WITHDRAWAL BY SUBJECT', not 'withdrawal of consent' — different events.
  reason                TEXT NOT NULL CHECK (reason IN (
                          'COMPLETED','ADVERSE EVENT','WITHDRAWAL BY SUBJECT',
                          'LOST TO FOLLOW-UP','PHYSICIAN DECISION','PROTOCOL DEVIATION',
                          'DEATH','SCREEN FAILURE','OTHER')),
  detail                TEXT,            -- DSTERM: the verbatim term from source
  event_date            TEXT NOT NULL,
  -- Withdrawing consent stops future collection; it does not retract what was
  -- lawfully collected before. This records what the participant agreed to.
  retain_collected_data INTEGER NOT NULL CHECK (retain_collected_data IN (0,1)),
  recorded_by           TEXT NOT NULL,
  recorded_at           TEXT NOT NULL
);

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES participants(subject_id) ON DELETE CASCADE,
  study_id   TEXT NOT NULL REFERENCES trials(study_id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at   TEXT,                      -- null while the call is live
  status     TEXT NOT NULL CHECK (status IN ('in_progress','awaiting_review','completed'))
);

CREATE TABLE visits (
  visit_id     INTEGER PRIMARY KEY,
  subject_id   TEXT NOT NULL REFERENCES participants(subject_id) ON DELETE CASCADE,
  study_id     TEXT NOT NULL REFERENCES trials(study_id) ON DELETE CASCADE,
  session_id   TEXT REFERENCES sessions(session_id) ON DELETE SET NULL,
  visit_name   TEXT NOT NULL,
  visit_at     TEXT NOT NULL,
  recon_status TEXT NOT NULL CHECK (recon_status IN ('not_started','in_progress','awaiting_review','completed'))
);

-- One medication as recorded at a point in time. A change references two:
-- what the log holds now, and what the call proposes.
CREATE TABLE conmed_entries (
  entry_id             INTEGER PRIMARY KEY,
  log_id               TEXT NOT NULL,
  reported_text        TEXT NOT NULL,   -- verbatim; maps to CMTRT
  rxcui                TEXT,            -- null is a valid state, not an error
  canonical_name       TEXT,            -- maps to CMDECOD
  indication           TEXT,
  dose                 TEXT,
  route                TEXT,
  frequency            TEXT,
  start_date           TEXT,
  start_date_precision TEXT NOT NULL CHECK (start_date_precision IN ('day','month','year','unknown')),
  stop_date            TEXT,
  stop_date_precision  TEXT NOT NULL CHECK (stop_date_precision IN ('day','month','year','unknown')),
  ongoing              INTEGER NOT NULL CHECK (ongoing IN (0,1))
);

CREATE TABLE proposed_changes (
  change_id             TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  change_type           TEXT NOT NULL CHECK (change_type IN ('add','stop','modify','confirm_unchanged')),
  target_log_id         TEXT,           -- null for an add
  current_entry_id      INTEGER REFERENCES conmed_entries(entry_id),  -- null for an add
  proposed_entry_id     INTEGER NOT NULL REFERENCES conmed_entries(entry_id),
  agent_confidence      REAL NOT NULL CHECK (agent_confidence BETWEEN 0 AND 1),
  agent_reasoning       TEXT NOT NULL,
  review_status         TEXT NOT NULL CHECK (review_status IN ('pending','accepted','rejected','edited')),
  prohibited_rule_id    TEXT,
  prohibited_matched_on TEXT CHECK (prohibited_matched_on IN ('drug','class')),
  prohibited_class      TEXT,
  prohibited_section    TEXT,
  prohibited_rationale  TEXT,
  CHECK ((change_type = 'add') = (current_entry_id IS NULL))
);

CREATE TABLE tool_steps (
  step_id   INTEGER PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES proposed_changes(change_id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  tool      TEXT NOT NULL,
  input     TEXT NOT NULL,
  output    TEXT NOT NULL,
  UNIQUE (change_id, seq)
);

CREATE TABLE transcript_turns (
  turn_id    INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  at_ms      INTEGER NOT NULL,
  speaker    TEXT NOT NULL CHECK (speaker IN ('agent','participant')),
  text       TEXT NOT NULL,
  UNIQUE (session_id, at_ms, speaker)
);

-- Which change a turn produced, so the capture panel can fill in step with the
-- words that caused it.
CREATE TABLE transcript_yields (
  turn_id   INTEGER NOT NULL REFERENCES transcript_turns(turn_id) ON DELETE CASCADE,
  change_id TEXT NOT NULL REFERENCES proposed_changes(change_id) ON DELETE CASCADE,
  PRIMARY KEY (turn_id, change_id)
);

-- 21 CFR 11.10(e): who, when, and why. Append-only; never updated or deleted.
CREATE TABLE audit_events (
  event_id   TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL CHECK (action IN (
               'call_started','call_ended','change_accepted','change_rejected',
               'change_cleared','change_edited','query_raised','deviation_logged','promoted')),
  change_id  TEXT,
  detail     TEXT NOT NULL,
  reason     TEXT           -- required for anything that alters a value
);

CREATE TABLE queries (
  query_id   TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  change_id  TEXT NOT NULL REFERENCES proposed_changes(change_id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  raised_by  TEXT NOT NULL,
  raised_at  TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('open','closed'))
);

CREATE TABLE deviations (
  deviation_id      TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  change_id         TEXT NOT NULL REFERENCES proposed_changes(change_id) ON DELETE CASCADE,
  subject_id        TEXT NOT NULL REFERENCES participants(subject_id) ON DELETE CASCADE,
  category          TEXT NOT NULL,
  protocol_section  TEXT NOT NULL,
  rule_id           TEXT NOT NULL,
  description       TEXT NOT NULL,
  reportable_to_irb INTEGER NOT NULL CHECK (reportable_to_irb IN (0,1)),
  notify_pi         INTEGER NOT NULL CHECK (notify_pi IN (0,1)),
  logged_by         TEXT NOT NULL,
  logged_at         TEXT NOT NULL
);

-- 21 CFR 11.50: a signature carries printed name, time, and its meaning.
CREATE TABLE promotions (
  promotion_id   INTEGER PRIMARY KEY,
  session_id     TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  promoted_count INTEGER NOT NULL,
  signed_by      TEXT NOT NULL,
  signed_name    TEXT NOT NULL,
  signature_meaning TEXT NOT NULL,
  signed_at      TEXT NOT NULL
);

-- Curated drug reference. RxNorm is free to use; WHODrug, the regulatory
-- standard for CM coding, needs a paid UMC license — see BACKEND-ASKS.md.
CREATE TABLE medications (
  rxcui       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  atc_code    TEXT,
  drug_class  TEXT NOT NULL,
  trips_class TEXT           -- prohibited class this medication falls into
);

CREATE INDEX idx_participants_study  ON participants(study_id, status);
CREATE INDEX idx_dispositions_subject ON dispositions(subject_id);
CREATE INDEX idx_visits_study        ON visits(study_id, visit_at);
CREATE INDEX idx_visits_status       ON visits(recon_status);
CREATE INDEX idx_sessions_study      ON sessions(study_id, status);
CREATE INDEX idx_changes_session     ON proposed_changes(session_id);
CREATE INDEX idx_changes_prohibited  ON proposed_changes(prohibited_rule_id) WHERE prohibited_rule_id IS NOT NULL;
CREATE INDEX idx_audit_session       ON audit_events(session_id, at);
CREATE INDEX idx_turns_session       ON transcript_turns(session_id, at_ms);
CREATE INDEX idx_rules_document      ON prohibited_rules(document_id);

-- Convenience view: the picker's rollup per trial.
CREATE VIEW trial_summary AS
SELECT t.study_id, t.nct_id, t.short_title, t.phase, t.enrolled_at_site,
       (p.document_id IS NOT NULL)                                        AS has_protocol,
       (SELECT COUNT(*) FROM prohibited_rules pr WHERE pr.document_id = p.document_id) AS rule_count,
       (SELECT COUNT(*) FROM participants pt WHERE pt.study_id = t.study_id AND pt.status IN ('enrolled','screening')) AS active_participants,
       (SELECT COUNT(*) FROM visits v WHERE v.study_id = t.study_id AND v.recon_status = 'awaiting_review') AS awaiting_review,
       (SELECT COUNT(*) FROM visits v WHERE v.study_id = t.study_id AND v.recon_status = 'in_progress')     AS calls_in_progress,
       (SELECT COUNT(*) FROM proposed_changes c JOIN sessions s ON s.session_id = c.session_id
         WHERE s.study_id = t.study_id AND c.prohibited_rule_id IS NOT NULL)                                AS prohibited_findings
FROM trials t
LEFT JOIN protocols p ON p.study_id = t.study_id AND p.status = 'active';
