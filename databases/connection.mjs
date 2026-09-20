/**
 * Where each database lives.
 *
 * The demo runs entirely on local SQLite files — no server, no container, no
 * connection string, nothing to stand up. That is deliberate: the app has to
 * work on conference wifi with no backing services.
 *
 * To point a database at a real server instead, set its environment variable.
 * Nothing else in the codebase needs to change, because everything opens a
 * database through here:
 *
 *   TRIAL_RECORDS_URL=postgres://user:pass@host:5432/trials
 *   CALL_SESSIONS_URL=postgres://...
 *   DRUG_REFERENCE_URL=postgres://...
 *
 * `DATABASE_URL` is honoured as a fallback for all of them, which is what most
 * hosts inject.
 *
 * What is NOT done here: an actual Postgres driver. Adding one means installing
 * `pg` and implementing `openPostgres` below against the same tiny surface the
 * SQLite path exposes (`prepare`, `exec`, `close`). The schema in
 * trial_records/schema.sql is close to portable — see PORTING below.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** name -> [folder, filename, env var] */
const DATABASES = {
  trial_records: ['trial_records', 'conmed.db', 'TRIAL_RECORDS_URL'],
  call_sessions: ['call_sessions', 'patient.db', 'CALL_SESSIONS_URL'],
  drug_reference: ['drug_reference', 'drugs.db', 'DRUG_REFERENCE_URL'],
  health_guidance: ['health_guidance', 'general_health.db', 'HEALTH_GUIDANCE_URL'],
};

export function locate(name) {
  const entry = DATABASES[name];
  if (!entry) throw new Error(`Unknown database "${name}". Known: ${Object.keys(DATABASES).join(', ')}`);
  const [folder, file, envVar] = entry;
  const url = process.env[envVar] || process.env.DATABASE_URL;
  return url
    ? { driver: 'postgres', url, name }
    : { driver: 'sqlite', file: join(HERE, folder, file), name };
}

export function open(name) {
  const target = locate(name);
  if (target.driver === 'sqlite') return new DatabaseSync(target.file);
  return openPostgres(target);
}

/** Every database, and where it currently resolves to. */
export function describe() {
  return Object.keys(DATABASES).map((name) => {
    const t = locate(name);
    return { name, driver: t.driver, at: t.driver === 'sqlite' ? t.file.replace(HERE, 'databases') : redact(t.url) };
  });
}

const redact = (url) => url.replace(/\/\/[^@]*@/, '//***@');

function openPostgres(target) {
  throw new Error(
    `${target.name} is configured for Postgres (${redact(target.url)}) but no driver is installed.\n` +
    `Add one: npm i pg, then implement openPostgres in databases/connection.mjs.\n` +
    `Unset ${DATABASES[target.name][2]} (and DATABASE_URL) to fall back to the local SQLite file.`,
  );
}

/*
 * PORTING trial_records/schema.sql to Postgres — the only SQLite-isms in it:
 *
 *   INTEGER PRIMARY KEY            -> GENERATED ALWAYS AS IDENTITY
 *   INTEGER ... CHECK (x IN (0,1)) -> BOOLEAN            (the retain/ongoing flags)
 *   UNIQUE (...) ON CONFLICT REPLACE -> a partial unique index plus an upsert
 *   PRAGMA foreign_keys = ON       -> drop it; Postgres always enforces them
 *
 * The CHECK constraints, the foreign keys, the partial index and the
 * trial_summary view all carry over unchanged. Dates are stored as ISO-8601
 * TEXT, which Postgres will accept into TIMESTAMPTZ columns if you tighten them.
 */
