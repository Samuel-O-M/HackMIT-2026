import type { ReconciliationSession } from '../types/contract';
import type { ScheduledVisit } from '../types/ui';
import rawSessions from '../../../patient_data/participants/sessions.json';
import rawVisits from '../../../patient_data/participants/visits.json';
import { toIso, type RelativeTime } from './schedule';

/**
 * Participants and their calls. The data lives in data/participants/ so the
 * backend and agent branches can read the same files.
 *
 * Subject identifiers, visit times and everything said on the calls are
 * synthetic. The trials they belong to, and the protocols their medications
 * are checked against, are real — see data/README.md.
 */

type StoredSession = Omit<ReconciliationSession, 'startedAt' | 'endedAt'> & {
  startedAt: RelativeTime;
  endedAt: RelativeTime | null;
};
type StoredVisit = Omit<ScheduledVisit, 'visitAt'> & { visitAt: RelativeTime };

export const SESSIONS: ReconciliationSession[] = (
  rawSessions as unknown as StoredSession[]
).map((s) => ({
  ...s,
  startedAt: toIso(s.startedAt),
  endedAt: s.endedAt === null ? null : toIso(s.endedAt),
}));

export const VISITS: ScheduledVisit[] = (rawVisits as unknown as StoredVisit[]).map((v) => ({
  ...v,
  visitAt: toIso(v.visitAt),
}));
