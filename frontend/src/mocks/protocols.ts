import type { ProhibitedRule, ProtocolDocument } from '../types/ui';

/*
  Clinical Study Protocols, one per trial.

  The protocol is the document that defines prohibited medications — the list
  sits in its concomitant medications section, and nothing else in the study
  file is authoritative for it. Until a coordinator loads one, the agent has no
  rule set to check against and prohibited screening is off for that trial.

  R2810-ONC-1540 is the real published protocol for the pivotal cemiplimab
  study in advanced CSCC, downloaded from ClinicalTrials.gov and kept at
  data/R2810-ONC-1540_Protocol_Amendment9.pdf. Its section numbering below
  (§5.7.2, "Prohibited Medications and Concomitant Treatments") is that
  document's own. The other protocols are synthetic.

  Rule extraction belongs to the agent branch. This module only holds the
  result; the UI renders what it is given and never infers a rule itself.
*/

export const CEMIPLIMAB_RULES: ProhibitedRule[] = [
  {
    ruleId: 'PR-0009',
    matchedOn: 'class',
    label: 'Chronic immunosuppressants',
    className: 'Chronic immunosuppressant',
    protocolSection: '5.7.2',
    rationale:
      'Chronic immunosuppressive therapy is prohibited throughout treatment. Immunosuppression opposes the mechanism of checkpoint blockade and may mask immune-related adverse events.',
    threshold: null,
  },
  {
    ruleId: 'PR-0021',
    matchedOn: 'class',
    label: 'Systemic corticosteroids above 10 mg/day prednisone equivalent',
    className: 'Systemic corticosteroid',
    protocolSection: '5.7.2',
    rationale:
      'Corticosteroids above the stated threshold are prohibited. Physiologic replacement doses and short courses for non-oncologic indications may be permitted after discussion with the medical monitor.',
    threshold: '> 10 mg/day prednisone equivalent',
  },
  {
    ruleId: 'PR-0034',
    matchedOn: 'class',
    label: 'Live attenuated vaccines',
    className: 'Live attenuated vaccine',
    protocolSection: '5.7.2',
    rationale:
      'Live attenuated vaccines are prohibited within 4 weeks before the first dose and throughout treatment. Inactivated and recombinant vaccines are permitted.',
    threshold: 'Within 28 days of first dose and throughout treatment',
  },
  {
    ruleId: 'PR-0040',
    matchedOn: 'class',
    label: 'Other systemic anticancer therapy',
    className: 'Antineoplastic agent',
    protocolSection: '5.7.2',
    rationale:
      'No other systemic anticancer therapy may be given while the participant is on study treatment.',
    threshold: null,
  },
];

const ODRONEXTAMAB_RULES: ProhibitedRule[] = [
  {
    ruleId: 'PR-0021',
    matchedOn: 'class',
    label: 'Systemic corticosteroids above 10 mg/day prednisone equivalent',
    className: 'Systemic corticosteroid',
    protocolSection: '6.5.1',
    rationale:
      'Systemic corticosteroids above 10 mg/day prednisone equivalent are prohibited from screening through the end of treatment. Corticosteroid immunosuppression blunts the T-cell redirection that odronextamab depends on and may reduce efficacy.',
    threshold: '> 10 mg/day prednisone equivalent',
  },
  {
    ruleId: 'PR-0003',
    matchedOn: 'class',
    label: 'Strong CYP3A4 inducers',
    className: 'CYP3A4 inducer',
    protocolSection: '6.5.2',
    rationale:
      'Strong CYP3A4 inducers are prohibited throughout the study for participants on concurrent small-molecule supportive therapy.',
    threshold: null,
  },
  {
    ruleId: 'PR-0034',
    matchedOn: 'class',
    label: 'Live attenuated vaccines',
    className: 'Live attenuated vaccine',
    protocolSection: '6.5.3',
    rationale:
      'Live attenuated vaccines are prohibited within 4 weeks before the first dose and throughout treatment. Under T-cell engaging therapy a live vaccine strain carries a risk of disseminated infection.',
    threshold: 'Within 28 days of first dose and throughout treatment',
  },
  {
    ruleId: 'PR-0040',
    matchedOn: 'class',
    label: 'Other systemic anticancer therapy',
    className: 'Antineoplastic agent',
    protocolSection: '6.5',
    rationale:
      'No other systemic anticancer therapy may be given while the participant is on study treatment.',
    threshold: null,
  },
];

const UBAMATAMAB_RULES: ProhibitedRule[] = [
  {
    ruleId: 'PR-0021',
    matchedOn: 'class',
    label: 'Systemic corticosteroids above 10 mg/day prednisone equivalent',
    className: 'Systemic corticosteroid',
    protocolSection: '6.5.1',
    rationale:
      'Systemic corticosteroids above the stated threshold are prohibited from screening through the end of treatment.',
    threshold: '> 10 mg/day prednisone equivalent',
  },
  {
    ruleId: 'PR-0034',
    matchedOn: 'class',
    label: 'Live attenuated vaccines',
    className: 'Live attenuated vaccine',
    protocolSection: '6.5.3',
    rationale: 'Live attenuated vaccines are prohibited throughout treatment.',
    threshold: 'Within 28 days of first dose and throughout treatment',
  },
  {
    ruleId: 'PR-0003',
    matchedOn: 'class',
    label: 'Strong CYP3A4 inducers',
    className: 'CYP3A4 inducer',
    protocolSection: '6.5.2',
    rationale: 'Strong CYP3A4 inducers are prohibited throughout the study.',
    threshold: null,
  },
];

/**
 * Keyed by study. A study absent from this map has no protocol loaded, which
 * is a real state: R3767-ONC-22122 is open at the site but not yet configured, so its
 * prohibited screening is off until a coordinator uploads the document.
 */
export const SEED_PROTOCOLS: Record<string, ProtocolDocument> = {
  'R2810-ONC-1540': {
    documentId: 'DOC-1540-A9',
    studyId: 'R2810-ONC-1540',
    filename: 'R2810-ONC-1540_Protocol_Amendment9.pdf',
    protocolNumber: 'R2810-ONC-1540',
    amendment: 'Amendment 9',
    effectiveDate: '2021-03-15',
    sizeBytes: 3_300_775,
    pageCount: 176,
    uploadedBy: 'ayushim',
    uploadedAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    status: 'active',
    conmedSection: '5.7.2',
    rules: CEMIPLIMAB_RULES,
    sourceUrl: '/protocol-docs/R2810-ONC-1540_Protocol_Amendment9.pdf',
  },
  'R1979-ONC-22102': {
    documentId: 'DOC-3005-A3',
    studyId: 'R1979-ONC-22102',
    filename: 'R1979-ONC-22102_Protocol_Amendment3.pdf',
    protocolNumber: 'R1979-ONC-22102',
    amendment: 'Amendment 3',
    effectiveDate: '2026-02-09',
    sizeBytes: 2_140_880,
    pageCount: 148,
    uploadedBy: 'ayushim',
    uploadedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    status: 'active',
    conmedSection: '6.5',
    rules: ODRONEXTAMAB_RULES,
    sourceUrl: null,
  },
  'R4018-ONC-2445': {
    documentId: 'DOC-1208-A1',
    studyId: 'R4018-ONC-2445',
    filename: 'R4018-ONC-2445_Protocol_Amendment1.pdf',
    protocolNumber: 'R4018-ONC-2445',
    amendment: 'Amendment 1',
    effectiveDate: '2026-01-22',
    sizeBytes: 1_884_210,
    pageCount: 132,
    uploadedBy: 'ayushim',
    uploadedAt: new Date(Date.now() - 44 * 86_400_000).toISOString(),
    status: 'active',
    conmedSection: '6.5',
    rules: UBAMATAMAB_RULES,
    sourceUrl: null,
  },
};

/**
 * What a freshly uploaded document resolves to in the mock. The real parse
 * happens on the agent branch; this stands in so the flow is demonstrable
 * without it, and is deliberately generic rather than pretending to have read
 * whatever file the coordinator dropped.
 */
export const PARSE_STUB: ProhibitedRule[] = [
  {
    ruleId: 'PR-0009',
    matchedOn: 'class',
    label: 'Chronic immunosuppressants',
    className: 'Chronic immunosuppressant',
    protocolSection: '6.5.2',
    rationale: 'Chronic immunosuppressive therapy is prohibited throughout treatment.',
    threshold: null,
  },
  {
    ruleId: 'PR-0034',
    matchedOn: 'class',
    label: 'Live attenuated vaccines',
    className: 'Live attenuated vaccine',
    protocolSection: '6.5.3',
    rationale: 'Live attenuated vaccines are prohibited throughout treatment.',
    threshold: 'Within 28 days of first dose and throughout treatment',
  },
  {
    ruleId: 'PR-0052',
    matchedOn: 'drug',
    label: 'Prior anti-LAG-3 therapy',
    className: null,
    protocolSection: '6.5.4',
    rationale: 'Participants must not have received prior anti-LAG-3 directed therapy.',
    threshold: null,
  },
];
