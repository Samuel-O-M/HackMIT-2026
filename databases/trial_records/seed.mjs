/**
 * Builds patient_data/db/conmed.db from the JSON under patient_data/.
 *
 * Run: node patient_data/db/seed.mjs      (from the repo root)
 *
 * Uses node:sqlite, built into Node 22+, so there is no dependency to install.
 * The database is a derived artifact — patient_data/ stays the source of truth, and
 * this is safe to delete and rebuild at any time.
 */
import { locate, open } from '../connection.mjs';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DATA = join(ROOT, 'patient_data');
const target = locate('trial_records');
const DB_PATH = target.file;

const read = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));

/** data/ stores scheduling times as an offset from today; the DB stores instants. */
const DAY = 86_400_000;
const midnight = new Date();
midnight.setHours(0, 0, 0, 0);
function toIso(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  const [h, m] = v.time.split(':').map(Number);
  return new Date(midnight.getTime() + v.dayOffset * DAY + h * 3_600_000 + m * 60_000).toISOString();
}

if (target.driver !== 'sqlite') {
  console.error(`trial_records points at ${target.driver}. Seed that server from its own migrations;`);
  console.error('this script only builds the local demo database.');
  process.exit(1);
}
if (existsSync(DB_PATH)) rmSync(DB_PATH);
const db = open('trial_records');
db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));

const trials = read('trials/trials.json');
const protocols = read('trials/protocols.json');
const visits = read('participants/visits.json');
const sessions = read('participants/sessions.json');
const transcripts = read('participants/transcripts.json');
const audit = read('participants/audit.json');
const meds = JSON.parse(readFileSync(join(ROOT, 'api', 'medical_data', 'medications.json'), 'utf8'));
const roster = read('participants/participants.json');

const insert = (sql) => db.prepare(sql);
const counts = {};
const bump = (k, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

db.exec('BEGIN');

const iTrial = insert(`INSERT INTO trials (study_id,nct_id,short_title,investigational_product,indication,phase,enrolled_at_site,principal_investigator)
  VALUES (?,?,?,?,?,?,?,?)`);
for (const t of trials) {
  iTrial.run(t.studyId, t.nctId, t.shortTitle, t.investigationalProduct, t.indication, t.phase, t.enrolledAtSite, t.principalInvestigator);
  bump('trials');
}

const iProto = insert(`INSERT INTO protocols (document_id,study_id,filename,protocol_number,amendment,effective_date,size_bytes,page_count,conmed_section,source_path,uploaded_by,uploaded_at,status)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const iRule = insert(`INSERT INTO prohibited_rules (document_id,rule_id,matched_on,label,class_name,protocol_section,threshold,rationale)
  VALUES (?,?,?,?,?,?,?,?)`);
for (const p of Object.values(protocols)) {
  iProto.run(p.documentId, p.studyId, p.filename, p.protocolNumber, p.amendment, p.effectiveDate, p.sizeBytes, p.pageCount, p.conmedSection, p.sourceUrl, p.uploadedBy, toIso(p.uploadedAt), p.status);
  bump('protocols');
  for (const r of p.rules) {
    iRule.run(p.documentId, r.ruleId, r.matchedOn, r.label, r.className, r.protocolSection, r.threshold, r.rationale);
    bump('prohibited_rules');
  }
}

const iPart = insert(`INSERT INTO participants
  (subject_id,study_id,status,screening_number,consent_version,consent_date,enrolled_date,icf_filename)
  VALUES (?,?,?,?,?,?,?,?)`);
const iDisp = insert(`INSERT INTO dispositions
  (subject_id,study_id,reason,detail,event_date,retain_collected_data,recorded_by,recorded_at)
  VALUES (?,?,?,?,?,?,?,?)`);

const seen = new Set();
for (const p of roster) {
  seen.add(p.subjectId);
  iPart.run(p.subjectId, p.studyId, p.status, p.screeningNumber, p.consentVersion,
    toIso(p.consentDate), toIso(p.enrolledDate), p.icfFilename);
  bump('participants');
  if (p.discontinuation) {
    const d = p.discontinuation;
    iDisp.run(p.subjectId, p.studyId, d.reason, d.detail, d.date,
      d.retainCollectedData ? 1 : 0, d.recordedBy, d.recordedAt);
    bump('dispositions');
  }
}
// A visit for someone not on the roster would be an orphan; surface it rather
// than silently inventing a participant row for them.
for (const v of visits) {
  if (!seen.has(v.subjectId)) {
    console.warn(`  visit references unknown participant ${v.subjectId}`);
    iPart.run(v.subjectId, v.studyId, 'enrolled', null, null, null, null, null);
    seen.add(v.subjectId);
    bump('participants');
  }
}

const iSession = insert('INSERT INTO sessions (session_id,subject_id,study_id,started_at,ended_at,status) VALUES (?,?,?,?,?,?)');
const iEntry = insert(`INSERT INTO conmed_entries (log_id,reported_text,rxcui,canonical_name,indication,dose,route,frequency,start_date,start_date_precision,stop_date,stop_date_precision,ongoing)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const iChange = insert(`INSERT INTO proposed_changes (change_id,session_id,change_type,target_log_id,current_entry_id,proposed_entry_id,agent_confidence,agent_reasoning,review_status,prohibited_rule_id,prohibited_matched_on,prohibited_class,prohibited_section,prohibited_rationale)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const iStep = insert('INSERT INTO tool_steps (change_id,seq,tool,input,output) VALUES (?,?,?,?,?)');

function entryId(e) {
  if (!e) return null;
  const r = iEntry.run(e.logId, e.reportedText, e.rxcui, e.canonicalName, e.indication, e.dose, e.route, e.frequency, e.startDate, e.startDatePrecision, e.stopDate, e.stopDatePrecision, e.ongoing ? 1 : 0);
  bump('conmed_entries');
  return Number(r.lastInsertRowid);
}

for (const s of sessions) {
  iSession.run(s.sessionId, s.subjectId, s.studyId, toIso(s.startedAt), toIso(s.endedAt), s.status);
  bump('sessions');
  for (const c of s.changes) {
    const cur = entryId(c.current);
    const prop = entryId(c.proposed);
    const h = c.prohibitedHit;
    iChange.run(c.changeId, s.sessionId, c.changeType, c.targetLogId, cur, prop, c.agentConfidence, c.agentReasoning, c.reviewStatus,
      h?.ruleId ?? null, h?.matchedOn ?? null, h?.className ?? null, h?.protocolSection ?? null, h?.rationale ?? null);
    bump('proposed_changes');
    c.toolTrace.forEach((t, i) => { iStep.run(c.changeId, i, t.tool, t.input, t.output); bump('tool_steps'); });
  }
}

const iVisit = insert('INSERT INTO visits (subject_id,study_id,session_id,visit_name,visit_at,recon_status) VALUES (?,?,?,?,?,?)');
for (const v of visits) { iVisit.run(v.subjectId, v.studyId, v.sessionId, v.visitName, toIso(v.visitAt), v.reconStatus); bump('visits'); }

const iTurn = insert('INSERT INTO transcript_turns (session_id,at_ms,speaker,text) VALUES (?,?,?,?)');
const iYield = insert('INSERT INTO transcript_yields (turn_id,change_id) VALUES (?,?)');
for (const [sessionId, turns] of Object.entries(transcripts)) {
  for (const t of turns) {
    const r = iTurn.run(sessionId, t.atMs, t.speaker, t.text);
    bump('transcript_turns');
    for (const cid of t.yields ?? []) { iYield.run(Number(r.lastInsertRowid), cid); bump('transcript_yields'); }
  }
}

const iAudit = insert('INSERT INTO audit_events (event_id,session_id,at,actor,action,change_id,detail,reason) VALUES (?,?,?,?,?,?,?,?)');
for (const [sessionId, events] of Object.entries(audit)) {
  for (const e of events) { iAudit.run(e.eventId, sessionId, toIso(e.at), e.actor, e.action, e.changeId, e.detail, e.reason ?? null); bump('audit_events'); }
}

const iMed = insert('INSERT INTO medications (rxcui,name,atc_code,drug_class,trips_class) VALUES (?,?,?,?,?)');
for (const m of meds) {
  if (!m.rxcui) continue;   // unresolvable by design; nothing to key on
  iMed.run(m.rxcui, m.name, m.atc, m.class, m.trips ?? null);
  bump('medications');
}

db.exec('COMMIT');

const fk = db.prepare('PRAGMA foreign_key_check').all();
if (fk.length) { console.error('FOREIGN KEY VIOLATIONS:', fk.slice(0, 5)); process.exitCode = 1; }

console.log(`built ${DB_PATH}`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`  foreign key check     ${fk.length === 0 ? 'clean' : `${fk.length} VIOLATIONS`}`);
db.close();
