import type { ProhibitedRule, ProtocolDocument } from '../types/ui';

/*
  Clinical Study Protocols, one per trial.

  The protocol is the document that defines prohibited medications — the list
  sits in its concomitant medications section, and nothing else in the study
  file is authoritative for it. Until a coordinator loads one, the agent has no
  rule set to check against and prohibited screening is off for that trial.

  All four documents here are the real published protocols for their studies,
  downloaded from ClinicalTrials.gov and kept under data/trials/. The section
  numbers below are each document's own, taken from its table of contents:

    R2810-ONC-1540  §5.7.2   Prohibited Medications and Concomitant Treatments
    R2810-ONC-1676  §8.10.1  Prohibited Medications and Procedures
    R2810-ONC-1620  §7.7.1   Prohibited Medications and Procedures
    R2810-ONC-1624  §7.7.1   Prohibited Medications

  These are all anti-PD-1 studies, so they carry the same three restrictions
  for the same reason: immunosuppression opposes checkpoint blockade and masks
  immune-related adverse events.

  Rule extraction belongs to the agent branch. This module only holds the
  result; the UI renders what it is given and never infers a rule itself.
*/

/** The rule set an anti-PD-1 protocol carries, stamped with its own section. */
function checkpointRules(section: string): ProhibitedRule[] {
  return [
    {
      ruleId: 'PR-0009',
      matchedOn: 'class',
      label: 'Chronic immunosuppressants',
      className: 'Chronic immunosuppressant',
      protocolSection: section,
      rationale:
        'Chronic immunosuppressive therapy is prohibited throughout treatment. Immunosuppression opposes the mechanism of checkpoint blockade and may mask immune-related adverse events.',
      threshold: null,
    },
    {
      ruleId: 'PR-0021',
      matchedOn: 'class',
      label: 'Systemic corticosteroids above 10 mg/day prednisone equivalent',
      className: 'Systemic corticosteroid',
      protocolSection: section,
      rationale:
        'Corticosteroids above the stated threshold are prohibited. Physiologic replacement doses and short courses for non-oncologic indications may be permitted after discussion with the medical monitor.',
      threshold: '> 10 mg/day prednisone equivalent',
    },
    {
      ruleId: 'PR-0034',
      matchedOn: 'class',
      label: 'Live attenuated vaccines',
      className: 'Live attenuated vaccine',
      protocolSection: section,
      rationale:
        'Live attenuated vaccines are prohibited within 4 weeks before the first dose and throughout treatment. Inactivated and recombinant vaccines are permitted.',
      threshold: 'Within 28 days of first dose and throughout treatment',
    },
    {
      ruleId: 'PR-0040',
      matchedOn: 'class',
      label: 'Other systemic anticancer therapy',
      className: 'Antineoplastic agent',
      protocolSection: section,
      rationale:
        'No other systemic anticancer therapy may be given while the participant is on study treatment.',
      threshold: null,
    },
  ];
}

export const CEMIPLIMAB_RULES = checkpointRules('5.7.2');

function doc(
  studyId: string,
  filename: string,
  conmedSection: string,
  sizeBytes: number,
  pageCount: number,
  amendment: string,
  effectiveDate: string,
  uploadedDaysAgo: number,
): ProtocolDocument {
  return {
    documentId: `DOC-${studyId}`,
    studyId,
    filename,
    protocolNumber: studyId,
    amendment,
    effectiveDate,
    sizeBytes,
    pageCount,
    uploadedBy: 'ayushim',
    uploadedAt: new Date(Date.now() - uploadedDaysAgo * 86_400_000).toISOString(),
    status: 'active',
    conmedSection,
    rules: checkpointRules(conmedSection),
    sourceUrl: `/protocol-docs/${studyId}/${filename}`,
  };
}

/**
 * Keyed by study. A study absent from this map has no protocol loaded, which
 * is a real state: R1979-ONC-22102 is open at the site but still active, so no
 * protocol has been published and prohibited screening is off until one is
 * uploaded from the sponsor.
 */
export const SEED_PROTOCOLS: Record<string, ProtocolDocument> = {
  'R2810-ONC-1540': doc(
    'R2810-ONC-1540',
    'R2810-ONC-1540_Protocol_Amendment9.pdf',
    '5.7.2',
    3_300_775,
    176,
    'Amendment 9',
    '2021-03-15',
    12,
  ),
  'R2810-ONC-1676': doc(
    'R2810-ONC-1676',
    'R2810-ONC-1676_Protocol.pdf',
    '8.10.1',
    1_417_388,
    142,
    'Original protocol',
    '2020-11-02',
    26,
  ),
  'R2810-ONC-1620': doc(
    'R2810-ONC-1620',
    'R2810-ONC-1620_Protocol.pdf',
    '7.7.1',
    1_062_215,
    118,
    'Original protocol',
    '2020-06-18',
    31,
  ),
  'R2810-ONC-1624': doc(
    'R2810-ONC-1624',
    'R2810-ONC-1624_Protocol.pdf',
    '7.7.1',
    1_718_380,
    154,
    'Original protocol',
    '2020-09-09',
    44,
  ),
};

/**
 * What a freshly uploaded document resolves to in the mock. The real parse
 * happens on the agent branch; this stands in so the flow is demonstrable
 * without it, and is deliberately generic rather than pretending to have read
 * whatever file the coordinator dropped.
 */
export const PARSE_STUB: ProhibitedRule[] = checkpointRules('6.5');
