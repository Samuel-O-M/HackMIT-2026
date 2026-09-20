/**
 * Backstop: re-checks the committed transcripts for identifiers.
 *
 * Redaction is not this script's job any more. It happens in the pipeline —
 * voice/brain/bridge.js redacts when a call publishes, and record-transcripts
 * redacts before writing — so a transcript is de-identified by the time anyone
 * could run this. What is left here is the check: if this ever reports a
 * change, something upstream let an identifier through and that is the bug.
 *
 * Run it as a guard:   node scripts/redact-transcripts.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { redactText } = require('../voice/brain/redact.js');

export { redactText as redact };

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const tPath = join(ROOT, 'patient_data', 'participants', 'transcripts.json');
  const transcripts = JSON.parse(readFileSync(tPath, 'utf8'));
  const contacts = JSON.parse(readFileSync(join(ROOT, 'databases', 'call_sessions', 'contacts.json'), 'utf8'));
  const sessions = JSON.parse(readFileSync(join(ROOT, 'patient_data', 'participants', 'sessions.json'), 'utf8'));
  const bySession = Object.fromEntries(sessions.map((s) => [s.sessionId, s.subjectId]));

  const leaks = [];
  for (const [sessionId, turns] of Object.entries(transcripts)) {
    const who = contacts[bySession[sessionId]];
    if (!who) continue;
    // The participant and anyone authorised to speak for them. A caregiver is
    // named aloud as often as the participant and is no more publishable.
    const people = [who, who.caregiver].filter(Boolean);
    for (const turn of turns) {
      const next = people.reduce((text, person) => redactText(text, person), turn.text);
      if (next !== turn.text) {
        leaks.push({ sessionId, before: turn.text });
        turn.text = next;
      }
    }
  }

  if (!leaks.length) {
    console.log(`clean — ${Object.keys(transcripts).length} transcript(s), no identifiers found`);
    process.exit(0);
  }
  if (check) {
    console.error(`FAIL — ${leaks.length} unredacted turn(s); the pipeline let these through:`);
    for (const l of leaks.slice(0, 5)) console.error(`  ${l.sessionId}: ${l.before.slice(0, 80)}`);
    process.exit(1);
  }
  writeFileSync(tPath, `${JSON.stringify(transcripts, null, 2)}\n`);
  console.log(`redacted ${leaks.length} turn(s) — but find out why the pipeline missed them`);
}
