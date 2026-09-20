import type { ConmedEntry, Effectiveness, ProposedChange } from '../types/contract';
import { formatPartialDate } from './dates';

/** Fields the coordinator can correct inline before promoting. */
export const EDITABLE_FIELDS = ['dose', 'route', 'frequency', 'indication'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABEL: Record<EditableField, string> = {
  dose: 'Dose',
  route: 'Route',
  frequency: 'Frequency',
  indication: 'Indication',
};

export const EFFECTIVENESS_LABEL: Record<Effectiveness, string> = {
  working: 'Working',
  partly: 'Partly working',
  not_working: 'Not working',
  unsure: 'Not sure',
};

/** Only what the participant volunteered or was asked: null means never asked. */
export function sideEffectsLine(entry: ConmedEntry): { text: string; serious: boolean } | null {
  const note = entry.sideEffectsNote?.trim();
  switch (entry.sideEffects) {
    case 'none':
      return { text: 'None reported', serious: false };
    case 'unsure':
      return { text: 'Not sure', serious: false };
    case 'reported':
      return { text: note || 'Reported', serious: false };
    case 'serious':
      return { text: note || 'Reported', serious: true };
    default:
      // A note with no classification is still worth showing.
      return note ? { text: note, serious: false } : null;
  }
}

/** A row the coordinator should look at promptly, whatever else they are doing. */
export function hasSeriousSymptom(change: ProposedChange): boolean {
  return change.proposed.sideEffects === 'serious';
}

export const CHANGE_TAG: Record<ProposedChange['changeType'], string> = {
  add: 'ADD',
  stop: 'STOP',
  modify: 'MODIFY',
  confirm_unchanged: 'NO CHANGE',
};

export const CHANGE_VERB: Record<ProposedChange['changeType'], string> = {
  add: 'New medication',
  stop: 'Stopped',
  modify: 'Details changed',
  confirm_unchanged: 'Confirmed unchanged',
};

/**
 * Name to show. An unresolved entry has no name to show, so it gets a label
 * rather than the raw sentence — the verbatim text is rendered beneath it,
 * which is where a coordinator expects to read it back.
 */
export function displayName(entry: ConmedEntry): string {
  return entry.canonicalName ?? 'Unidentified medication';
}

export function isUnresolved(entry: ConmedEntry): boolean {
  return entry.rxcui === null;
}

/** Which attributes differ between the logged entry and the proposal. */
export function changedFields(change: ProposedChange): Set<string> {
  const diff = new Set<string>();
  const { current, proposed } = change;
  if (!current) return diff;
  for (const key of ['dose', 'route', 'frequency', 'indication'] as const) {
    if (current[key] !== proposed[key]) diff.add(key);
  }
  if (current.stopDate !== proposed.stopDate) diff.add('stopDate');
  if (current.ongoing !== proposed.ongoing) diff.add('ongoing');
  return diff;
}

export function startLine(entry: ConmedEntry): string {
  return formatPartialDate(entry.startDate, entry.startDatePrecision);
}

/**
 * Reads as a sentence fragment after "Stopped", so the leading word of an
 * approximate date is lowercased ("Stopped around July 2026"). Digits are
 * unaffected, and an unknown date says so rather than trailing off.
 */
/** A one-off administration: start and stop are the same date. */
export function isSingleAdministration(entry: ConmedEntry): boolean {
  return !entry.ongoing && entry.stopDate !== null && entry.stopDate === entry.startDate;
}

export function stopLine(entry: ConmedEntry): string {
  if (entry.ongoing) return 'Ongoing';
  // A vaccine or other one-off is logged with the same start and stop date.
  // "Stopped around August" would misread that as a course the participant came off.
  if (isSingleAdministration(entry)) return 'Single administration';
  const rendered = formatPartialDate(entry.stopDate, entry.stopDatePrecision);
  if (rendered === 'Date unknown') return 'Stop date unknown';
  return `Stopped ${rendered.charAt(0).toLowerCase()}${rendered.slice(1)}`;
}

export const LOW_CONFIDENCE = 0.7;

export function isLowConfidence(change: ProposedChange): boolean {
  return change.agentConfidence < LOW_CONFIDENCE;
}

/** Everything the coordinator has not yet dispositioned. */
export function pendingCount(changes: ProposedChange[]): number {
  return changes.filter((c) => c.reviewStatus === 'pending').length;
}

export function acceptedChanges(changes: ProposedChange[]): ProposedChange[] {
  return changes.filter((c) => c.reviewStatus === 'accepted' || c.reviewStatus === 'edited');
}
