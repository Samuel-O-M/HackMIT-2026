/**
 * Dumps the fixture modules to JSON under ../data.
 *
 * Run with: npm run export:data
 *
 * The fixtures compute their timestamps relative to "today" so the demo never
 * looks stale. JSON cannot hold that, so scheduling timestamps are written back
 * as { dayOffset, time } and re-materialised by the loaders in src/mocks/.
 * Clinical dates (a medication start date, a protocol effective date) are real
 * calendar dates and are written literally.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { STUDIES } from '../src/mocks/studies';
import { SESSIONS, VISITS } from '../src/mocks/sessions';
import { TRANSCRIPTS } from '../src/mocks/transcripts';
import { SEED_AUDIT } from '../src/mocks/audit';
import { SEED_PROTOCOLS } from '../src/mocks/protocols';

const DATA = join(process.cwd(), '..', 'data');
const DAY = 86_400_000;
const anchor = new Date();
anchor.setHours(0, 0, 0, 0);

function relative(iso: string): { dayOffset: number; time: string } {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return {
    dayOffset: Math.round((day.getTime() - anchor.getTime()) / DAY),
    time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  };
}

function write(relPath: string, value: unknown): void {
  const path = join(DATA, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log('wrote', relPath);
}

write('trials/trials.json', STUDIES);

write(
  'trials/protocols.json',
  Object.fromEntries(
    Object.entries(SEED_PROTOCOLS).map(([id, p]) => [id, { ...p, uploadedAt: relative(p.uploadedAt) }]),
  ),
);

write(
  'participants/visits.json',
  VISITS.map((v) => ({ ...v, visitAt: relative(v.visitAt) })),
);

write(
  'participants/sessions.json',
  SESSIONS.map((s) => ({
    ...s,
    startedAt: relative(s.startedAt),
    endedAt: s.endedAt === null ? null : relative(s.endedAt),
  })),
);

write('participants/transcripts.json', TRANSCRIPTS);

write(
  'participants/audit.json',
  Object.fromEntries(
    Object.entries(SEED_AUDIT).map(([id, events]) => [
      id,
      events.map((e) => ({ ...e, at: relative(e.at) })),
    ]),
  ),
);
