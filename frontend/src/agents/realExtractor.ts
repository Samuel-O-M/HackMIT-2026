import type { ProtocolExtraction } from '../types/ui';
import { registerProtocolExtractor } from './protocolExtractor';

/**
 * Wires the protocol parser in recognize/ to the upload flow. The parser needs
 * Node, an OpenAI key and medical_data's SQLite cache, so it runs behind
 * api/server.mjs and this posts the file to it.
 *
 * If the service is not running the registration simply fails at call time and
 * the placeholder in protocolExtractor.ts takes over, which is why the UI still
 * labels an unverified extraction.
 */
const BASE = (import.meta.env.VITE_AGENT_BASE as string | undefined) ?? 'http://localhost:5174';

export interface AgentExtraction extends ProtocolExtraction {
  filename?: string;
  sizeBytes?: number;
  /** Where the service parked the upload, so the trial can file it. */
  tmpPath?: string;
}

export function installRealExtractor(): void {
  registerProtocolExtractor(async (file) => {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`${BASE}/agent/extract-protocol`, { method: 'POST', body });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Extraction failed: ${res.status}`);
    return (await res.json()) as AgentExtraction;
  });
}

/**
 * The app bundles patient_data at build time, so trials added since the last
 * build are invisible to it. When the service is up this returns what is
 * actually on disk, and the api layer merges it over the bundled seed.
 */
export async function fetchLiveTrials(): Promise<{ trials: unknown[]; protocols: Record<string, unknown> } | null> {
  try {
    const res = await fetch(`${BASE}/agent/trials`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;   // service down: the bundled data still works
  }
}

/** The roster as it is on disk, for the same reason as fetchLiveTrials. */
export async function fetchLiveParticipants(): Promise<unknown[] | null> {
  try {
    const res = await fetch(`${BASE}/agent/participants`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Upsert a participant. Used for both enrollment and a disposition event —
 * there is no delete, because leaving a study does not remove the record.
 */
export async function persistParticipant(participant: unknown): Promise<void> {
  await fetch(`${BASE}/agent/participants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(participant),
  });
}

/** Writes a new or updated trial into patient_data/ so it survives a reload. */
export async function persistTrial(payload: unknown): Promise<void> {
  await fetch(`${BASE}/agent/trials`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
