import type { Study } from '../types/ui';

/*
  Trials this site is running. All four are real, currently registered
  Regeneron oncology studies — protocol numbers and NCT identifiers are taken
  from their ClinicalTrials.gov records. Only the site-level detail is
  synthetic: the investigator names, enrolment counts and the participants.

  Only R2810-ONC-1540 has a published protocol document, because
  ClinicalTrials.gov posts protocols at results posting and the other three are
  still active. That is the ordinary case, and the reason a coordinator has to
  upload the protocol from the sponsor rather than fetch it from the registry.

  The prohibited profiles differ deliberately. A T-cell engager and a checkpoint
  inhibitor both restrict immunosuppression, but for different reasons and at
  different thresholds — which is the whole argument for choosing the study
  before reviewing anything.
*/

export const STUDIES: Study[] = [
  {
    studyId: 'R1979-ONC-22102',
    nctId: 'NCT06149286',
    shortTitle: 'Odronextamab + lenalidomide in R/R FL and MZL',
    investigationalProduct: 'Odronextamab + lenalidomide',
    indication: 'Relapsed/refractory follicular and marginal zone lymphoma',
    phase: 'Phase 3',
    enrolledAtSite: 14,
    principalInvestigator: 'Dr L. Okonkwo',
    prohibitedHighlights: [
      'Systemic corticosteroids > 10 mg/day',
      'Live attenuated vaccines',
      'Other systemic anticancer therapy',
    ],
  },
  {
    // The one real protocol in this fixture set: the published Amendment 9 PDF
    // for this study is in data/, and its §5.7.2 is what the rules below cite.
    studyId: 'R2810-ONC-1540',
    nctId: 'NCT02760498',
    shortTitle: 'Cemiplimab in advanced CSCC',
    investigationalProduct: 'Cemiplimab',
    indication: 'Advanced cutaneous squamous cell carcinoma',
    phase: 'Phase 2',
    enrolledAtSite: 9,
    principalInvestigator: 'Dr M. Ferreira',
    prohibitedHighlights: [
      'Chronic immunosuppressants',
      'Systemic corticosteroids > 10 mg/day',
      'Live attenuated vaccines',
    ],
  },
  {
    studyId: 'R3767-ONC-22122',
    nctId: 'NCT06246916',
    shortTitle: 'Anti-LAG-3 + anti-PD-1 in advanced melanoma',
    investigationalProduct: 'Fianlimab + cemiplimab',
    indication: 'Advanced or metastatic melanoma',
    phase: 'Phase 3',
    enrolledAtSite: 6,
    principalInvestigator: 'Dr L. Okonkwo',
    prohibitedHighlights: [
      'Chronic immunosuppressants',
      'Live attenuated vaccines',
      'Prior anti-LAG-3 therapy',
    ],
  },
  {
    studyId: 'R4018-ONC-2445',
    nctId: 'NCT06787612',
    shortTitle: 'Ubamatamab combination in ovarian cancer',
    investigationalProduct: 'Ubamatamab',
    indication: 'Platinum-resistant ovarian, fallopian tube or primary peritoneal cancer',
    phase: 'Phase 2',
    enrolledAtSite: 4,
    principalInvestigator: 'Dr P. Raghunathan',
    prohibitedHighlights: [
      'Systemic corticosteroids > 10 mg/day',
      'Live attenuated vaccines',
      'Strong CYP3A4 inducers',
    ],
  },
];

export function studyById(studyId: string): Study | null {
  return STUDIES.find((s) => s.studyId === studyId) ?? null;
}
