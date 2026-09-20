/**
 * Removes names and dates of birth from the stored transcripts.
 *
 * The identity exchange is real and belongs in the transcript — a coordinator
 * needs to see that the agent verified who it was speaking to. What does not
 * belong is the name and date of birth themselves: this file is committed, and
 * the clinical store holds subject ids only, by design. The app renders this
 * transcript on screen, so leaving them in would put a participant's name on a
 * screen that is built never to show one.
 *
 * The turn stays. The identifiers become placeholders.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tPath = join(ROOT, 'patient_data', 'participants', 'transcripts.json');
const transcripts = JSON.parse(readFileSync(tPath, 'utf8'));
const contacts = JSON.parse(readFileSync(join(ROOT, 'databases', 'call_sessions', 'contacts.json'), 'utf8'));
const sessions = JSON.parse(readFileSync(join(ROOT, 'patient_data', 'participants', 'sessions.json'), 'utf8'));
const bySession = Object.fromEntries(sessions.map((s) => [s.sessionId, s.subjectId]));

export function redact(text, who) {
  if (!who) return text;
  let out = text;
  for (const dob of dobForms(who.dob)) out = out.replaceAll(dob, '[date of birth]');
  out = out.replaceAll(`${who.given} ${who.family}`, '[name]');
  // Titles keep their shape so the line still reads like speech.
  out = out.replace(new RegExp(`\\b(Mr|Mrs|Ms|Dr)\\.?\\s+${who.family}\\b`, 'g'), '$1. [name]');
  out = out.replaceAll(who.family, '[name]').replaceAll(who.given, '[name]');
  return out.replace(/\[name\](,?\s*\[name\])+/g, '[name]');
}

/** The same date said several ways, because people do not read out ISO. */
function dobForms(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const ord = (n) => `${n}${['th','st','nd','rd'][n % 10 > 3 || (n > 10 && n < 14) ? 0 : n % 10]}`;
  return [iso, `${m}/${d}/${y}`, `${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}/${y}`,
    `${months[m-1]} ${d}, ${y}`, `${months[m-1]} ${d} ${y}`, `${months[m-1]} ${ord(d)}, ${y}`,
    `${months[m-1]} ${ord(d)} ${y}`, `${d} ${months[m-1]} ${y}`];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let changed = 0;
  for (const [sessionId, turns] of Object.entries(transcripts)) {
    const who = contacts[bySession[sessionId]];
    if (!who) continue;
    for (const turn of turns) {
      const next = redact(turn.text, who);
      if (next !== turn.text) { turn.text = next; changed++; }
    }
  }
  writeFileSync(tPath, `${JSON.stringify(transcripts, null, 2)}\n`);
  console.log(`redacted ${changed} turn(s)`);
}
