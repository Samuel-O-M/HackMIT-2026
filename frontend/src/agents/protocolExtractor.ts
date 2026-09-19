import type { ProtocolExtraction } from '../types/ui';
import { CEMIPLIMAB_RULES } from '../mocks/protocols';

/**
 * ============================================================================
 *  WIRING POINT — the protocol extraction agent plugs in here.
 * ============================================================================
 *
 * When a coordinator opens a new trial they upload the Clinical Study Protocol.
 * An agent reads the trial's identity off it (protocol number, NCT, product,
 * indication, phase, investigator) and the prohibited medication list out of
 * its concomitant medications section, so the coordinator confirms rather than
 * retypes.
 *
 * To wire the real agent, call `registerProtocolExtractor` once at startup:
 *
 *     import { registerProtocolExtractor } from './agents/protocolExtractor';
 *     registerProtocolExtractor(async (file) => {
 *       const body = new FormData();
 *       body.append('file', file);
 *       const res = await fetch('/agent/extract-protocol', { method: 'POST', body });
 *       return res.json();              // must satisfy ProtocolExtraction
 *     });
 *
 * Nothing else changes. Until that call is made, the stand-in below runs and
 * the UI labels every value as unverified, so a placeholder is never mistaken
 * for something actually read off the document.
 *
 * Contract notes for the implementer:
 *  - Every field carries its own `confidence` (0–1) and a `sourceHint`.
 *  - A field the agent could not find must be `{ value: null, confidence: 0 }`,
 *    not a guess. The coordinator fills those in.
 *  - `source` must be 'agent'. The UI keys its trust banner off this.
 */

export type ProtocolExtractor = (file: File) => Promise<ProtocolExtraction>;

let installed: ProtocolExtractor | null = null;

export function registerProtocolExtractor(extractor: ProtocolExtractor): void {
  installed = extractor;
}

export function hasProtocolExtractor(): boolean {
  return installed !== null;
}

export async function extractProtocolDetails(file: File): Promise<ProtocolExtraction> {
  if (installed) return installed(file);
  return stubExtraction(file);
}

/* -------------------------------------------------------------------------- */

const field = <T,>(value: T | null, confidence: number, sourceHint: string | null) => ({
  value,
  confidence,
  sourceHint,
});

/**
 * Stand-in used until the agent is wired.
 *
 * It does not read the file. For the one protocol checked into data/trials it
 * returns that document's real details so the flow can be demonstrated end to
 * end; for anything else it returns empty fields rather than inventing a trial.
 * Either way `source` is 'stub' and the UI says so.
 */
async function stubExtraction(file: File): Promise<ProtocolExtraction> {
  await new Promise((resolve) => setTimeout(resolve, 1600));

  const isKnownProtocol = /R2810[-_]?ONC[-_]?1540/i.test(file.name);

  if (!isKnownProtocol) {
    return {
      studyId: field<string>(null, 0, null),
      nctId: field<string>(null, 0, null),
      shortTitle: field<string>(null, 0, null),
      investigationalProduct: field<string>(null, 0, null),
      indication: field<string>(null, 0, null),
      phase: field<'Phase 1' | 'Phase 2' | 'Phase 3'>(null, 0, null),
      principalInvestigator: field<string>(null, 0, null),
      conmedSection: field<string>(null, 0, null),
      rules: [],
      source: 'stub',
      notes:
        'No extraction agent is wired, so nothing was read from this file. Enter the trial details below and load the prohibited list once the agent is connected.',
    };
  }

  return {
    studyId: field('R2810-ONC-1540', 0.97, 'Title page'),
    nctId: field('NCT02760498', 0.95, 'Title page'),
    shortTitle: field('Cemiplimab in advanced CSCC', 0.82, 'Protocol title'),
    investigationalProduct: field('Cemiplimab (REGN2810)', 0.94, 'Title page'),
    indication: field('Advanced cutaneous squamous cell carcinoma', 0.9, '§1 Synopsis'),
    phase: field<'Phase 1' | 'Phase 2' | 'Phase 3'>('Phase 2', 0.88, '§1 Synopsis'),
    principalInvestigator: field<string>(null, 0, null),
    conmedSection: field('5.7.2', 0.91, '§5.7.2 Prohibited Medications and Concomitant Treatments'),
    rules: CEMIPLIMAB_RULES,
    source: 'stub',
    notes:
      'These values come from the placeholder, not from reading the file. They match the protocol checked into data/trials/R2810-ONC-1540 so the flow can be demonstrated. Check every field before confirming.',
  };
}
