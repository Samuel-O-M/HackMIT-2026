import type { TranscriptTurn } from '../types/ui';
import raw from '../../../patient_data/participants/transcripts.json';

/**
 * Call transcripts, keyed by session. Lives in
 * data/participants/transcripts.json.
 *
 * `atMs` is the offset from call start and drives replay pacing; `yields`
 * names the changes that turn produced, so the capture panel fills in step
 * with the words that caused it.
 */
export const TRANSCRIPTS = raw as unknown as Record<string, TranscriptTurn[]>;

/** Wall-clock length of a call fixture. */
export function transcriptDuration(turns: TranscriptTurn[]): number {
  return turns.length ? turns[turns.length - 1].atMs + 4000 : 0;
}
