import type { Study } from '../types/ui';
import trials from '../../../patient_data/trials/trials.json';

/**
 * Trials this site is running. The data lives in data/trials/trials.json so the
 * backend and agent branches can read the same file; see data/README.md for
 * what each trial is and why one of them deliberately has no protocol.
 */
export const STUDIES = trials as Study[];

export function studyById(studyId: string): Study | null {
  return STUDIES.find((s) => s.studyId === studyId) ?? null;
}
