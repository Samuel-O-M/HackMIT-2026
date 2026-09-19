import type { ProhibitedRule, ProtocolDocument } from '../types/ui';
import raw from '../../../data/trials/protocols.json';
import { toIso, type RelativeTime } from './schedule';

/**
 * Clinical Study Protocols, keyed by trial. Lives in
 * data/trials/protocols.json; the documents themselves sit beside it in
 * data/trials/<protocol number>/.
 *
 * A trial absent from this map has no protocol loaded — a real state, and the
 * reason the app has an upload. See data/trials/README.md.
 */
type StoredProtocol = Omit<ProtocolDocument, 'uploadedAt'> & { uploadedAt: RelativeTime };

export const SEED_PROTOCOLS: Record<string, ProtocolDocument> = Object.fromEntries(
  Object.entries(raw as unknown as Record<string, StoredProtocol>).map(([id, p]) => [
    id,
    { ...p, uploadedAt: toIso(p.uploadedAt) },
  ]),
);

export const CEMIPLIMAB_RULES: ProhibitedRule[] = SEED_PROTOCOLS['R2810-ONC-1540'].rules;

/**
 * What a freshly uploaded document resolves to in the mock. The real parse
 * happens on the agent branch; this stands in so the flow is demonstrable
 * without it, and is deliberately generic rather than pretending to have read
 * whatever file the coordinator dropped.
 */
export const PARSE_STUB: ProhibitedRule[] = CEMIPLIMAB_RULES.map((rule) => ({
  ...rule,
  protocolSection: '6.5',
}));
