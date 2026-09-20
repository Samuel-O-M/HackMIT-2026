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
// Who the site has recorded as authorised to speak on a participant's behalf.
// Names live here and in the gitignored contact layer only — never in
// patient_data, which holds subject ids by design.
const iContact = db.prepare(
  'INSERT INTO authorised_contacts (subject_id,given_name,family_name,relationship,role,authorised,consent_on_file) VALUES (?,?,?,?,?,?,?)'
);
/**
 * Identities that are fixed rather than derived.
 *
 * Every other participant's name and date of birth come out of a formula, so
 * they change if the roster order changes. This one has to stay put: someone
 * is going to answer the phone and say it out loud, and the identity check
 * compares what they say against this row.
 */
const FIXED_IDENTITY = {
  'S-437': { given: 'Samuel', family: 'Mateo', dob: '2005-01-01' },
};

const contacts = {};
roster.forEach((p, i) => {
  const n = Number(p.subjectId.replace(/\D/g, '')) || i;
  const fixed = FIXED_IDENTITY[p.subjectId];
  const given = fixed ? fixed.given : GIVEN[n % GIVEN.length];
  const family = fixed ? fixed.family : FAMILY[(n * 7) % FAMILY.length];
  const dob = fixed
    ? fixed.dob
    : `19${40 + (n % 45)}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`;
    // 555-0100 through 555-0199 is the only range NANP reserves as fictitious.
  // The old formula ran to 555-0899, which strays into numbers that may belong
  // to real people — and this system is now one env var away from dialling.
  // 0100 is the site's own caller ID, so participants start at 0101.
  const phone = `+1617555${String(101 + (n % 99)).padStart(4, '0')}`;
  iPatient.run(p.subjectId, given, family, dob, phone, 'en');
  iEnrol.run(p.subjectId, p.studyId, typeof p.enrolledDate === 'string' ? p.enrolledDate.slice(0, 10) : null, null);
  contacts[p.subjectId] = { given, family, dob };

  // Roughly one participant in four has someone recorded on their
  // authorisation form. In an oncology trial that is if anything low — the
  // person who fills the pill organiser is very often not the participant.
  if (n % 4 === 0) {
    const rel = ['daughter', 'son', 'husband', 'wife', 'carer'][n % 5];
    const cGiven = GIVEN[(n * 3 + 5) % GIVEN.length];
    // Family members usually share a surname; a paid carer does not.
    const cFamily = rel === 'carer' ? FAMILY[(n * 11 + 3) % FAMILY.length] : family;
    iContact.run(p.subjectId, cGiven, cFamily, rel,
      rel === 'carer' ? 'caregiver' : 'caregiver', 1, p.enrolledDate ? String(p.enrolledDate).slice(0, 10) : null);
    contacts[p.subjectId].caregiver = { given: cGiven, family: cFamily, relationship: rel };
  }
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

/**
 * A medication log for the participant who has not been called yet.
 *
 * Everyone else's log is derived from the "current" side of their recorded
 * call. S-437 has no recorded call — that is the point of them — so without
 * this the agent would ring, verify identity, and have nothing to read back.
 *
 * RxCUIs verified against RxNav.
 */
const UNCALLED_LOG = {
  'S-437': [
    ['omeprazole', '7646', 'omeprazole', 'Acid reflux', '20 mg', 'Oral', 'Once daily', '2025-02-11'],
    ['ibuprofen', '5640', 'ibuprofen', 'Headaches', '400 mg', 'Oral', 'As needed', '2025-06-03'],
    ['cetirizine', '20610', 'cetirizine', 'Hay fever', '10 mg', 'Oral', 'Once daily', '2024-04-20'],
  ],
};
for (const [subjectId, rows] of Object.entries(UNCALLED_LOG)) {
  const who = roster.find((x) => x.subjectId === subjectId);
  if (!who) continue;
  for (const [reported, rxcui, canonical, indication, dose, route, freq, start] of rows) {
    iMed.run(subjectId, who.studyId, reported, rxcui, canonical, indication, dose, route, freq,
      start, 'day', null, 'unknown', 1);
    meds++;
  }
}

const iRule = db.prepare(
  'INSERT INTO protocol_rules (study_id,rule_type,rxcui,class_id,protocol_section,rationale,applies_when,washout_window,threshold) VALUES (?,?,?,?,?,?,?,?,?)'
);
let rules = 0;
let screeningOnly = 0;
const unscreenable = [];
for (const [studyId, doc] of Object.entries(protocols)) {
  for (const r of doc.rules) {
    // Carried through, not dropped. A screening-only rule still belongs on the
    // record — it just must not be checked against someone already dosed.
    const applies = r.appliesWhen || 'during_treatment';
    if (applies === 'before_first_dose') screeningOnly++;
    // A rule with no grounded class id cannot match a drug, so it is not
    // screened at all. Seeding the class NAME instead produced rows that
    // looked like working rules and silently matched nothing — which is worse
    // than an absent rule, because the count said the trial was covered.
    if (!r.classIds?.length && !r.rxcuis?.length) {
      unscreenable.push(`${studyId} §${r.protocolSection} ${r.label}`);
      continue;
    }
    for (const classId of r.classIds?.length ? r.classIds : [r.className]) {
      iRule.run(studyId, r.matchedOn === 'drug' ? 'prohibited_drug' : 'prohibited_class',
        null, classId, r.protocolSection, r.rationale,
        applies, r.washoutWindow || null, r.threshold || null);
      rules++;
    }
  }
}

/**
 * Non-drug protocol requirements.
 *
 * All eight trials are cemiplimab, an anti-PD-1 monoclonal antibody, so the
 * rules below are the ones those protocols actually carry. Notably absent:
 * grapefruit. It is the textbook example of a dietary restriction, and it is
 * meaningless here — grapefruit inhibits CYP3A4, and a monoclonal antibody is
 * catabolised to peptides, not metabolised by CYP enzymes. Seeding it would
 * have produced a convincing demo of a rule no oncologist would write.
 *
 * Contraception and pregnancy come from the reproductive-toxicity language
 * common to every PD-1 protocol. Smoking is carried only on the lung-cancer
 * studies, where smoking status is a real recorded covariate; sun exposure only
 * on the skin-cancer studies.
 *
 * A production system extracts these from the protocol PDF the same way
 * prohibited drugs already are. This is the seam that would feed it.
 */
const NSCLC = ['R2810-ONC-1624', 'R2810-ONC-16111', 'R2810-ONC-16113'];
const SKIN = ['R2810-ONC-1540', 'R2810-ONC-1620'];

const iBRule = db.prepare(
  'INSERT INTO behaviour_rules (study_id,behaviour_code,rule_type,threshold,instrument,protocol_section,rationale) VALUES (?,?,?,?,?,?,?)'
);
let brules = 0;
for (const t of trials) {
  const id = t.studyId;
  const add = (code, type, threshold, instrument, section, why) => {
    iBRule.run(id, code, type, threshold, instrument, section, why);
    brules++;
  };
  add('contraception', 'required',
    'Highly effective contraception during treatment and for 6 months after the last dose',
    null, '5.6', 'Reproductive toxicity of the study drug has not been established.');
  add('pregnancy', 'prohibited', 'Pregnancy or breastfeeding at any point during treatment',
    null, '5.6', 'Immunoglobulin crosses the placenta and is excreted in breast milk.');
  add('blood_donation', 'prohibited', 'No donation during treatment or for 30 days after the last dose',
    null, '5.7', 'Protects the participant, and recipients, during active immunotherapy.');
  add('alcohol', 'monitored', 'Record usual intake; no fixed limit',
    'AUDIT-C', '5.7', 'Intake is needed to interpret liver function tests during treatment.');
  if (NSCLC.includes(id)) {
    add('nicotine', 'monitored', 'Record current status and any change since screening',
      null, '5.7', 'Smoking status is a stratification covariate in this population.');
  }
  if (SKIN.includes(id)) {
    add('sun_exposure', 'monitored', 'Record sun protection practice',
      null, '5.7', 'UV exposure is a driver of new lesions in this population.');
  }
}

db.exec('PRAGMA foreign_keys = ON');
console.log(`voice db seeded from patient_data:`);
const contactCount = db.prepare('SELECT COUNT(*) AS n FROM authorised_contacts').get().n;
console.log(`  studies ${trials.length} · patients ${roster.length} · medications ${meds} · drug rules ${rules} (${screeningOnly} screening-only) · behaviour rules ${brules}`);
console.log(`  authorised contacts ${contactCount}`);
if (unscreenable.length) {
  console.log(`  NOT auto-screened (no grounded class/rxcui) — a person must check these:`);
  for (const u of unscreenable) console.log(`    ${u}`);
}
db.close();

// The driver needs the names it just invented in order to pass identity check.
import { writeFileSync } from 'node:fs';
writeFileSync(join(ROOT, 'databases', 'call_sessions', 'contacts.json'), `${JSON.stringify(contacts, null, 2)}\n`);
console.log('  contact layer -> databases/call_sessions/contacts.json (gitignored, not in patient_data)');
