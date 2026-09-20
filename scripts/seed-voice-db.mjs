/**
 * Loads patient_data into the voice agent's own database, so a call is grounded
 * in the same participants, medications and prohibited rules the app shows.
 *
 * Names and dates of birth: the clinical store holds neither, by design — it
 * keeps subject ids only, and PHI lives in a separate system. The voice agent
 * has to verify who it is speaking to, so a contact layer is synthesised here
 * and written only to the voice database. It never touches patient_data.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, 'patient_data', p), 'utf8'));

const trials = read('trials/trials.json');
const protocols = read('trials/protocols.json');
const roster = read('participants/participants.json');
const sessions = read('participants/sessions.json');

const GIVEN = ['John','Margaret','David','Susan','Robert','Linda','James','Patricia','Michael','Barbara',
  'William','Elizabeth','Richard','Jennifer','Joseph','Maria','Thomas','Nancy','Charles','Karen'];
const FAMILY = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
  'Hernandez','Lopez','Wilson','Anderson','Taylor','Thomas','Moore','Jackson','Martin','Lee'];

const db = new DatabaseSync(join(ROOT, 'databases', 'call_sessions', 'patient.db'));
db.exec('PRAGMA foreign_keys = OFF');
for (const t of ['medications', 'protocol_rules', 'enrollments', 'patients', 'studies']) db.exec(`DELETE FROM ${t}`);

const iStudy = db.prepare('INSERT INTO studies (study_id,nct_id,title,protocol_version) VALUES (?,?,?,?)');
for (const t of trials) iStudy.run(t.studyId, t.nctId, t.shortTitle, protocols[t.studyId]?.amendment ?? null);

const iPatient = db.prepare('INSERT INTO patients (subject_id,given_name,family_name,dob,phone,preferred_language) VALUES (?,?,?,?,?,?)');
const iEnrol = db.prepare('INSERT INTO enrollments (subject_id,study_id,enrolled_date,arm) VALUES (?,?,?,?)');
const contacts = {};
roster.forEach((p, i) => {
  const n = Number(p.subjectId.replace(/\D/g, '')) || i;
  const given = GIVEN[n % GIVEN.length];
  const family = FAMILY[(n * 7) % FAMILY.length];
  const dob = `19${40 + (n % 45)}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`;
  iPatient.run(p.subjectId, given, family, dob, `555-0${String(100 + (n % 800))}`, 'en');
  iEnrol.run(p.subjectId, p.studyId, typeof p.enrolledDate === 'string' ? p.enrolledDate.slice(0, 10) : null, null);
  contacts[p.subjectId] = { given, family, dob };
});

// The medication log the agent reads back: the "current" side of each change.
const iMed = db.prepare(`INSERT INTO medications
  (subject_id,study_id,reported_text,rxcui,canonical_name,indication,dose,route,frequency,start_date,start_date_precision,stop_date,stop_date_precision,ongoing)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
let meds = 0;
for (const s of sessions) {
  for (const c of s.changes) {
    const e = c.current;
    if (!e) continue;   // an 'add' has nothing on file yet
    iMed.run(s.subjectId, s.studyId, e.reportedText, e.rxcui, e.canonicalName, e.indication, e.dose,
      e.route, e.frequency, e.startDate, e.startDatePrecision, e.stopDate, e.stopDatePrecision, e.ongoing ? 1 : 0);
    meds++;
  }
}

const iRule = db.prepare('INSERT INTO protocol_rules (study_id,rule_type,rxcui,class_id,protocol_section,rationale) VALUES (?,?,?,?,?,?)');
let rules = 0;
for (const [studyId, doc] of Object.entries(protocols)) {
  for (const r of doc.rules) {
    for (const classId of r.classIds?.length ? r.classIds : [r.className]) {
      iRule.run(studyId, r.matchedOn === 'drug' ? 'prohibited_drug' : 'prohibited_class',
        null, classId, r.protocolSection, r.rationale);
      rules++;
    }
  }
}

db.exec('PRAGMA foreign_keys = ON');
console.log(`voice db seeded from patient_data:`);
console.log(`  studies ${trials.length} · patients ${roster.length} · medications ${meds} · rules ${rules}`);
db.close();

// The driver needs the names it just invented in order to pass identity check.
import { writeFileSync } from 'node:fs';
writeFileSync(join(ROOT, 'databases', 'call_sessions', 'contacts.json'), `${JSON.stringify(contacts, null, 2)}\n`);
console.log('  contact layer -> databases/call_sessions/contacts.json (gitignored, not in patient_data)');
