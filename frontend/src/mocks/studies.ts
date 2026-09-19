import type { Study } from '../types/ui';

/*
  Trials this site is running. Every one is a real, registered Regeneron study:
  the protocol number, NCT identifier, phase and indication all come from its
  ClinicalTrials.gov record. Only the site-level detail is synthetic — the
  investigator names, enrolment counts, and the participants themselves.

  Four of the five have their real published Clinical Study Protocol checked
  into data/trials/, and the prohibited rules in the app cite the section of
  that document they were read from.

  R1979-ONC-22102 deliberately has none. ClinicalTrials.gov publishes a
  protocol only once results are posted, and that study is still active — so
  there is no document to download. That is the ordinary case for a trial a
  site is currently running, and the reason a coordinator has to load the
  protocol from the sponsor rather than fetch it from the registry.
*/

export const STUDIES: Study[] = [
  {
    studyId: 'R2810-ONC-1540',
    nctId: 'NCT02760498',
    shortTitle: 'Cemiplimab in advanced CSCC',
    investigationalProduct: 'Cemiplimab (REGN2810)',
    indication: 'Advanced cutaneous squamous cell carcinoma',
    phase: 'Phase 2',
    enrolledAtSite: 14,
    principalInvestigator: 'Dr L. Okonkwo',
    prohibitedHighlights: [
      'Chronic immunosuppressants',
      'Systemic corticosteroids > 10 mg/day',
      'Live attenuated vaccines',
    ],
  },
  {
    studyId: 'R2810-ONC-1676',
    nctId: 'NCT03257267',
    shortTitle: 'Cemiplimab in recurrent cervical cancer',
    investigationalProduct: 'Cemiplimab (REGN2810)',
    indication: 'Recurrent or metastatic platinum-refractory cervical cancer',
    phase: 'Phase 3',
    enrolledAtSite: 9,
    principalInvestigator: 'Dr M. Ferreira',
    prohibitedHighlights: [
      'Chronic immunosuppressants',
      'Systemic corticosteroids > 10 mg/day',
      'Live attenuated vaccines',
    ],
  },
  {
    studyId: 'R2810-ONC-1620',
    nctId: 'NCT03132636',
    shortTitle: 'Cemiplimab in advanced basal cell carcinoma',
    investigationalProduct: 'Cemiplimab (REGN2810)',
    indication: 'Advanced basal cell carcinoma after hedgehog inhibitor therapy',
    phase: 'Phase 2',
    enrolledAtSite: 6,
    principalInvestigator: 'Dr L. Okonkwo',
    prohibitedHighlights: [
      'Chronic immunosuppressants',
      'Systemic corticosteroids > 10 mg/day',
      'Live attenuated vaccines',
    ],
  },
  {
    studyId: 'R2810-ONC-1624',
    nctId: 'NCT03088540',
    shortTitle: 'Cemiplimab vs chemotherapy in metastatic NSCLC',
    investigationalProduct: 'Cemiplimab (REGN2810)',
    indication: 'Metastatic non-small cell lung cancer, PD-L1 high',
    phase: 'Phase 3',
    enrolledAtSite: 11,
    principalInvestigator: 'Dr P. Raghunathan',
    prohibitedHighlights: [
      'Chronic immunosuppressants',
      'Systemic corticosteroids > 10 mg/day',
      'Live attenuated vaccines',
    ],
  },
  {
    // Still active, so no protocol has been published — the upload case.
    studyId: 'R1979-ONC-22102',
    nctId: 'NCT06149286',
    shortTitle: 'Odronextamab + lenalidomide in R/R FL and MZL',
    investigationalProduct: 'Odronextamab + lenalidomide',
    indication: 'Relapsed/refractory follicular and marginal zone lymphoma',
    phase: 'Phase 3',
    enrolledAtSite: 4,
    principalInvestigator: 'Dr P. Raghunathan',
    prohibitedHighlights: [],
  },
];

export function studyById(studyId: string): Study | null {
  return STUDIES.find((s) => s.studyId === studyId) ?? null;
}
