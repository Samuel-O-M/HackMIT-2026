import type { Participant } from '../types/ui';
import raw from '../../../patient_data/participants/participants.json';
import { toIso, type RelativeTime } from './schedule';

/**
 * The roster. A participant is a record in their own right, not something
 * inferred from a visit — see patient_data/participants/README.md.
 */
type Stored = Omit<Participant, 'consentDate' | 'enrolledDate'> & {
  consentDate: RelativeTime | null;
  enrolledDate: RelativeTime | null;
};

export const PARTICIPANTS: Participant[] = (raw as unknown as Stored[]).map((p) => ({
  ...p,
  consentDate: p.consentDate ? toIso(p.consentDate) : null,
  enrolledDate: p.enrolledDate ? toIso(p.enrolledDate) : null,
}));
