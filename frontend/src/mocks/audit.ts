import type { AuditEvent } from '../types/ui';
import raw from '../../../data/participants/audit.json';
import { toIso, type RelativeTime } from './schedule';

/**
 * Append-only history, keyed by session. Lives in
 * data/participants/audit.json.
 *
 * This seeds what the voice agent recorded on each call; events created during
 * a browser session are appended by the api layer, so the history reflects what
 * the coordinator just did.
 */
type StoredEvent = Omit<AuditEvent, 'at'> & { at: RelativeTime };

export const SEED_AUDIT: Record<string, AuditEvent[]> = Object.fromEntries(
  Object.entries(raw as unknown as Record<string, StoredEvent[]>).map(([id, events]) => [
    id,
    events.map((e) => ({ ...e, at: toIso(e.at) })),
  ]),
);
