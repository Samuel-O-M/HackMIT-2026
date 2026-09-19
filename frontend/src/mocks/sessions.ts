import type { ConmedEntry, ProposedChange, ReconciliationSession } from '../types/contract';
import type { ScheduledVisit } from '../types/ui';
import { STUDIES } from './studies';

/*
  Fixtures for a bispecific-antibody oncology trial: odronextamab in
  relapsed/refractory follicular lymphoma. Odronextamab is a real Regeneron
  pipeline asset; the protocol code, NCT number and all subject data here are
  synthetic. Visits are named by cycle and day, as oncology trials are.

  The prohibited list is the one a T-cell engager trial actually carries:
  systemic corticosteroids above a threshold, live attenuated vaccines, and
  other systemic anticancer therapy — immunosuppression blunts T-cell
  redirection, and live vaccines are unsafe under it.

  One per hard case:
    - dose-threshold prohibition  → CH-101 (prednisone 20 mg > 10 mg limit)
    - LOW-confidence prohibition  → CH-107 (shingles vaccine, brand unconfirmed)
    - unresolved drug             → CH-102 ("blue pill for my stomach")
    - month-precision date        → CH-104 (omeprazole stop)
    - year-precision date         → CH-106 (melatonin start)
    - session with no changes     → SES-2026-0433
*/

const DAY = 86_400_000;
const anchor = new Date();
anchor.setHours(0, 0, 0, 0);

const STUDY_ID = 'R1979-ONC-22102';
const NCT_ID = 'NCT06149286';

function at(dayOffset: number, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(anchor.getTime() + dayOffset * DAY + h * 3_600_000 + m * 60_000).toISOString();
}

function entry(over: Partial<ConmedEntry> & Pick<ConmedEntry, 'logId' | 'reportedText'>): ConmedEntry {
  return {
    rxcui: null,
    canonicalName: null,
    indication: null,
    dose: null,
    route: null,
    frequency: null,
    startDate: null,
    startDatePrecision: 'unknown',
    stopDate: null,
    stopDatePrecision: 'unknown',
    ongoing: false,
    ...over,
  };
}

// ---------------------------------------------------------------- SES-…0431
// The demo session. Awaiting review, two prohibited findings — one certain,
// one that hinges on a brand the participant could not name.

const changes0431: ProposedChange[] = [
  {
    changeId: 'CH-101',
    changeType: 'add',
    targetLogId: null,
    current: null,
    proposed: entry({
      logId: 'NEW-101',
      reportedText: 'my other doctor put me on prednisone for the joint pain, twenty milligrams',
      rxcui: '8640',
      canonicalName: 'Prednisone',
      indication: 'Polymyalgia rheumatica',
      dose: '20 mg',
      route: 'Oral',
      frequency: 'Once daily',
      startDate: '2026-09-02',
      startDatePrecision: 'day',
      ongoing: true,
    }),
    agentConfidence: 0.93,
    agentReasoning:
      'Participant named prednisone and a dose of 20 mg once daily, started by a physician outside the study. The protocol permits systemic corticosteroids only up to 10 mg/day prednisone equivalent; 20 mg is double that limit. This is a dose-threshold breach rather than a blanket ban — the drug itself is allowed, the dose is not, so the coordinator may be able to resolve it with a taper rather than a withdrawal.',
    toolTrace: [
      { tool: 'resolve_drug', input: 'prednisone', output: 'rxcui=8640 · Prednisone · confidence 0.99' },
      { tool: 'classify_drug', input: 'rxcui=8640', output: 'ATC H02AB07 · Systemic corticosteroid (glucocorticoid)' },
      {
        tool: 'check_prohibited',
        input: 'class=Systemic corticosteroid · dose=20 mg/day · R1979-ONC-22102',
        output: 'HIT · rule PR-0021 · §6.5.1 · exceeds 10 mg/day prednisone-equivalent limit',
      },
      { tool: 'resolve_date', input: '"about two and a half weeks ago"', output: '2026-09-02 · precision=day' },
    ],
    prohibitedHit: {
      ruleId: 'PR-0021',
      matchedOn: 'class',
      className: 'Systemic corticosteroid',
      protocolSection: '6.5.1',
      rationale:
        'Systemic corticosteroids above 10 mg/day prednisone equivalent are prohibited from screening through the end of treatment. Corticosteroid immunosuppression blunts the T-cell redirection that odronextamab depends on and may reduce efficacy.',
    },
    reviewStatus: 'pending',
  },
  {
    changeId: 'CH-107',
    changeType: 'add',
    targetLogId: null,
    current: null,
    proposed: entry({
      logId: 'NEW-107',
      reportedText: 'I had the shingles jab at the pharmacy in August, just the one shot',
      rxcui: '1006296',
      canonicalName: 'Zoster vaccine, live',
      indication: 'Shingles prophylaxis',
      dose: '0.65 mL',
      route: 'Subcutaneous',
      frequency: 'Single dose',
      startDate: '2026-08-01',
      startDatePrecision: 'month',
      stopDate: '2026-08-01',
      stopDatePrecision: 'month',
      ongoing: false,
    }),
    agentConfidence: 0.61,
    agentReasoning:
      'Participant reports a shingles vaccination as a single dose. Two products exist: Zostavax, which is live attenuated and prohibited, and Shingrix, which is recombinant and permitted. The single-dose detail points to Zostavax, since Shingrix is a two-dose series — but the participant did not name the brand and may simply not have had the second dose yet. This resolution is an inference from dosing schedule alone. The brand must be confirmed against the pharmacy record before this is treated as a deviation.',
    toolTrace: [
      { tool: 'resolve_drug', input: 'shingles jab, single shot', output: 'ambiguous · Zostavax (live) 0.61 / Shingrix (recombinant) 0.37' },
      { tool: 'classify_drug', input: 'rxcui=1006296', output: 'ATC J07BK01 · Live attenuated viral vaccine' },
      { tool: 'check_prohibited', input: 'class=Live attenuated vaccine · R1979-ONC-22102', output: 'HIT · rule PR-0034 · §6.5.3' },
      { tool: 'resolve_date', input: '"in August"', output: '2026-08-01 · precision=month' },
    ],
    prohibitedHit: {
      ruleId: 'PR-0034',
      matchedOn: 'class',
      className: 'Live attenuated vaccine',
      protocolSection: '6.5.3',
      rationale:
        'Live attenuated vaccines are prohibited within 4 weeks before the first dose and throughout treatment. Under T-cell engaging therapy a live vaccine strain carries a risk of disseminated infection.',
    },
    reviewStatus: 'pending',
  },
  {
    changeId: 'CH-102',
    changeType: 'add',
    targetLogId: null,
    current: null,
    proposed: entry({
      logId: 'NEW-102',
      reportedText: 'and there is a little blue pill I take for my stomach, I could not tell you the name',
      rxcui: null,
      canonicalName: null,
      indication: 'Stomach complaint, unspecified',
      dose: null,
      route: 'Oral',
      frequency: 'Once daily',
      startDate: null,
      startDatePrecision: 'unknown',
      ongoing: true,
    }),
    agentConfidence: 0.41,
    agentReasoning:
      'Participant described an unnamed blue tablet taken once daily for a stomach complaint. Colour and indication are not enough to identify a product — famotidine, omeprazole and dicyclomine all ship as blue tablets. No resolution was attempted beyond the failed lookup. This needs the coordinator to ask the participant to bring the bottle to the visit.',
    toolTrace: [
      { tool: 'resolve_drug', input: 'blue pill for stomach', output: 'no match above threshold (best 0.31 · famotidine)' },
      { tool: 'resolve_drug', input: 'blue pill stomach once daily', output: 'no match above threshold' },
      { tool: 'resolve_date', input: '"a long time now"', output: 'unresolved · precision=unknown' },
    ],
    prohibitedHit: null,
    reviewStatus: 'pending',
  },
  {
    changeId: 'CH-103',
    changeType: 'modify',
    targetLogId: 'LOG-0041',
    current: entry({
      logId: 'LOG-0041',
      reportedText: 'Allopurinol',
      rxcui: '519',
      canonicalName: 'Allopurinol',
      indication: 'Tumour lysis syndrome prophylaxis',
      dose: '300 mg',
      route: 'Oral',
      frequency: 'Once daily',
      startDate: '2026-03-11',
      startDatePrecision: 'day',
      ongoing: true,
    }),
    proposed: entry({
      logId: 'LOG-0041',
      reportedText: 'they cut the allopurinol down to one small tablet in June',
      rxcui: '519',
      canonicalName: 'Allopurinol',
      indication: 'Tumour lysis syndrome prophylaxis',
      dose: '100 mg',
      route: 'Oral',
      frequency: 'Once daily',
      startDate: '2026-03-11',
      startDatePrecision: 'day',
      ongoing: true,
    }),
    agentConfidence: 0.86,
    agentReasoning:
      'Participant reports the allopurinol was reduced in June to "one small tablet". Allopurinol is supplied as 100 mg and 300 mg tablets; the logged dose is 300 mg, so the smaller tablet is 100 mg. Route, frequency and start date are unchanged.',
    toolTrace: [
      { tool: 'resolve_drug', input: 'allopurinol', output: 'rxcui=519 · Allopurinol · confidence 0.99' },
      { tool: 'classify_drug', input: 'rxcui=519', output: 'ATC M04AA01 · Xanthine oxidase inhibitor' },
      { tool: 'check_prohibited', input: 'rxcui=519 · R1979-ONC-22102', output: 'no hit' },
      { tool: 'resolve_date', input: '"in June"', output: '2026-06-01 · precision=month (dose change, not start)' },
    ],
    prohibitedHit: null,
    reviewStatus: 'pending',
  },
  {
    changeId: 'CH-104',
    changeType: 'stop',
    targetLogId: 'LOG-0038',
    current: entry({
      logId: 'LOG-0038',
      reportedText: 'Omeprazole',
      rxcui: '7646',
      canonicalName: 'Omeprazole',
      indication: 'Gastro-oesophageal reflux',
      dose: '20 mg',
      route: 'Oral',
      frequency: 'Once daily',
      startDate: '2024-11-03',
      startDatePrecision: 'day',
      ongoing: true,
    }),
    proposed: entry({
      logId: 'LOG-0038',
      reportedText: 'I came off the reflux one back in July, it was not doing much',
      rxcui: '7646',
      canonicalName: 'Omeprazole',
      indication: 'Gastro-oesophageal reflux',
      dose: '20 mg',
      route: 'Oral',
      frequency: 'Once daily',
      startDate: '2024-11-03',
      startDatePrecision: 'day',
      stopDate: '2026-07-01',
      stopDatePrecision: 'month',
      ongoing: false,
    }),
    agentConfidence: 0.78,
    agentReasoning:
      'Participant reports stopping "the reflux one" in July. Omeprazole is the only acid-suppression medication on the log, so the reference resolves by context. They could not name a day, so the stop date is held at month precision rather than guessed.',
    toolTrace: [
      { tool: 'resolve_drug', input: 'the reflux one', output: 'rxcui=7646 · Omeprazole · via log context · confidence 0.83' },
      { tool: 'resolve_date', input: '"back in July"', output: '2026-07-01 · precision=month' },
      { tool: 'check_prohibited', input: 'rxcui=7646 · R1979-ONC-22102', output: 'no hit' },
    ],
    prohibitedHit: null,
    reviewStatus: 'pending',
  },
  {
    changeId: 'CH-105',
    changeType: 'confirm_unchanged',
    targetLogId: 'LOG-0036',
    current: entry({
      logId: 'LOG-0036',
      reportedText: 'Atorvastatin',
      rxcui: '83367',
      canonicalName: 'Atorvastatin',
      indication: 'Hyperlipidaemia',
      dose: '20 mg',
      route: 'Oral',
      frequency: 'Once daily at night',
      startDate: '2021-06-15',
      startDatePrecision: 'day',
      ongoing: true,
    }),
    proposed: entry({
      logId: 'LOG-0036',
      reportedText: 'the cholesterol tablet, yes, same as before, one at night',
      rxcui: '83367',
      canonicalName: 'Atorvastatin',
      indication: 'Hyperlipidaemia',
      dose: '20 mg',
      route: 'Oral',
      frequency: 'Once daily at night',
      startDate: '2021-06-15',
      startDatePrecision: 'day',
      ongoing: true,
    }),
    agentConfidence: 0.97,
    agentReasoning:
      'Participant confirmed the statin is unchanged and still taken nightly. All logged fields match what was reported. No edit is proposed; the entry is carried forward so the log shows it was reviewed at this visit.',
    toolTrace: [
      { tool: 'resolve_drug', input: 'the cholesterol tablet', output: 'rxcui=83367 · Atorvastatin · via log context · confidence 0.95' },
      { tool: 'check_prohibited', input: 'rxcui=83367 · R1979-ONC-22102', output: 'no hit' },
    ],
    prohibitedHit: null,
    reviewStatus: 'pending',
  },
  {
    changeId: 'CH-106',
    changeType: 'add',
    targetLogId: null,
    current: null,
    proposed: entry({
      logId: 'NEW-106',
      reportedText: 'melatonin, the gummies, on and off for sleep, years now',
      rxcui: '6711',
      canonicalName: 'Melatonin',
      indication: 'Insomnia',
      dose: '5 mg',
      route: 'Oral',
      frequency: 'At bedtime PRN',
      startDate: '2024-01-01',
      startDatePrecision: 'year',
      ongoing: true,
    }),
    agentConfidence: 0.63,
    agentReasoning:
      'Participant reports intermittent melatonin gummies for sleep. The 5 mg dose is inferred from the most common gummy strength, not stated — the participant did not know it. The start date resolved only to a year. Both inferences are worth a second question at the visit.',
    toolTrace: [
      { tool: 'resolve_drug', input: 'melatonin gummies', output: 'rxcui=6711 · Melatonin · confidence 0.91' },
      { tool: 'classify_drug', input: 'rxcui=6711', output: 'Dietary supplement · hormone' },
      { tool: 'check_prohibited', input: 'rxcui=6711 · R1979-ONC-22102', output: 'no hit' },
      { tool: 'resolve_date', input: '"years now"', output: '2024-01-01 · precision=year · low certainty' },
    ],
    prohibitedHit: null,
    reviewStatus: 'pending',
  },
];

const session0431: ReconciliationSession = {
  sessionId: 'SES-2026-0431',
  subjectId: 'S-014',
  studyId: STUDY_ID,
  nctId: NCT_ID,
  startedAt: at(0, '08:42'),
  endedAt: at(0, '08:51'),
  status: 'awaiting_review',
  changes: changes0431,
};

// ---------------------------------------------------------------- SES-…0432
// A call in flight. Changes arrive as the replay advances.

const session0432: ReconciliationSession = {
  sessionId: 'SES-2026-0432',
  subjectId: 'S-021',
  studyId: STUDY_ID,
  nctId: NCT_ID,
  startedAt: at(0, '09:05'),
  endedAt: null,
  status: 'in_progress',
  changes: [
    {
      changeId: 'CH-201',
      changeType: 'confirm_unchanged',
      targetLogId: 'LOG-0102',
      current: entry({
        logId: 'LOG-0102',
        reportedText: 'Levothyroxine',
        rxcui: '10582',
        canonicalName: 'Levothyroxine',
        indication: 'Hypothyroidism',
        dose: '75 mcg',
        route: 'Oral',
        frequency: 'Once daily',
        startDate: '2019-02-20',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      proposed: entry({
        logId: 'LOG-0102',
        reportedText: 'the thyroid one, every morning, no change',
        rxcui: '10582',
        canonicalName: 'Levothyroxine',
        indication: 'Hypothyroidism',
        dose: '75 mcg',
        route: 'Oral',
        frequency: 'Once daily',
        startDate: '2019-02-20',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      agentConfidence: 0.96,
      agentReasoning: 'Participant confirmed the thyroid medication is unchanged.',
      toolTrace: [
        { tool: 'resolve_drug', input: 'the thyroid one', output: 'rxcui=10582 · Levothyroxine · via log context' },
        { tool: 'check_prohibited', input: 'rxcui=10582 · R1979-ONC-22102', output: 'no hit' },
      ],
      prohibitedHit: null,
      reviewStatus: 'pending',
    },
    {
      changeId: 'CH-202',
      changeType: 'add',
      targetLogId: null,
      current: null,
      proposed: entry({
        logId: 'NEW-202',
        reportedText: 'I got the flu vaccine last week, the nasal spray one, not the needle',
        rxcui: '1655944',
        canonicalName: 'Influenza vaccine, live attenuated (intranasal)',
        indication: 'Influenza prophylaxis',
        dose: '0.2 mL',
        route: 'Intranasal',
        frequency: 'Single dose',
        startDate: '2026-09-10',
        startDatePrecision: 'day',
        stopDate: '2026-09-10',
        stopDatePrecision: 'day',
        ongoing: false,
      }),
      agentConfidence: 0.94,
      agentReasoning:
        'Participant explicitly distinguished the nasal spray from the injection. The intranasal influenza vaccine is live attenuated, unlike the inactivated injectable, and is prohibited under this protocol.',
      toolTrace: [
        { tool: 'resolve_drug', input: 'flu vaccine, nasal spray', output: 'rxcui=1655944 · Influenza vaccine, live attenuated · confidence 0.96' },
        { tool: 'classify_drug', input: 'rxcui=1655944', output: 'ATC J07BB03 · Live attenuated viral vaccine' },
        { tool: 'check_prohibited', input: 'class=Live attenuated vaccine · R1979-ONC-22102', output: 'HIT · rule PR-0034 · §6.5.3' },
      ],
      prohibitedHit: {
        ruleId: 'PR-0034',
        matchedOn: 'class',
        className: 'Live attenuated vaccine',
        protocolSection: '6.5.3',
        rationale:
          'Live attenuated vaccines are prohibited within 4 weeks before the first dose and throughout treatment. Under T-cell engaging therapy a live vaccine strain carries a risk of disseminated infection.',
      },
      reviewStatus: 'pending',
    },
  ],
};

// ---------------------------------------------------------------- SES-…0433
// Reviewed, nothing to change. The empty-diff fixture.

const session0433: ReconciliationSession = {
  sessionId: 'SES-2026-0433',
  subjectId: 'S-033',
  studyId: STUDY_ID,
  nctId: NCT_ID,
  startedAt: at(-1, '15:20'),
  endedAt: at(-1, '15:24'),
  status: 'awaiting_review',
  changes: [],
};

// ---------------------------------------------------------------- SES-…0429
// Already promoted. Backs the audit view.

const session0429: ReconciliationSession = {
  sessionId: 'SES-2026-0429',
  subjectId: 'S-008',
  studyId: STUDY_ID,
  nctId: NCT_ID,
  startedAt: at(-2, '11:02'),
  endedAt: at(-2, '11:14'),
  status: 'completed',
  changes: [
    {
      changeId: 'CH-091',
      changeType: 'modify',
      targetLogId: 'LOG-0011',
      current: entry({
        logId: 'LOG-0011',
        reportedText: 'Acyclovir',
        rxcui: '281',
        canonicalName: 'Acyclovir',
        indication: 'Herpes zoster prophylaxis',
        dose: '400 mg',
        route: 'Oral',
        frequency: 'Twice daily',
        startDate: '2026-04-09',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      proposed: entry({
        logId: 'LOG-0011',
        reportedText: 'they put the acyclovir up to three a day',
        rxcui: '281',
        canonicalName: 'Acyclovir',
        indication: 'Herpes zoster prophylaxis',
        dose: '400 mg',
        route: 'Oral',
        frequency: 'Three times daily',
        startDate: '2026-04-09',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      agentConfidence: 0.91,
      agentReasoning: 'Participant reports the antiviral prophylaxis frequency was increased to three times daily.',
      toolTrace: [
        { tool: 'resolve_drug', input: 'acyclovir', output: 'rxcui=281 · Acyclovir · confidence 0.99' },
        { tool: 'check_prohibited', input: 'rxcui=281 · R1979-ONC-22102', output: 'no hit · required prophylaxis under §6.4' },
      ],
      prohibitedHit: null,
      reviewStatus: 'accepted',
    },
  ],
};

// ---------------------------------------------------------------- CEM-2014
// A second trial. Same UI, different prohibited profile: a checkpoint
// inhibitor restricts chronic immunosuppressants, which a T-cell engager
// protocol words differently.

const session0512: ReconciliationSession = {
  sessionId: 'SES-2026-0512',
  subjectId: 'S-102',
  studyId: 'R2810-ONC-1540',
  nctId: 'NCT02760498',
  startedAt: at(0, '09:20'),
  endedAt: at(0, '09:28'),
  status: 'awaiting_review',
  changes: [
    {
      changeId: 'CH-301',
      changeType: 'add',
      targetLogId: null,
      current: null,
      proposed: entry({
        logId: 'NEW-301',
        reportedText: 'my rheumatologist started me on methotrexate, one dose a week on Sundays',
        rxcui: '6851',
        canonicalName: 'Methotrexate',
        indication: 'Rheumatoid arthritis',
        dose: '15 mg',
        route: 'Oral',
        frequency: 'Once weekly',
        startDate: '2026-08-15',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      agentConfidence: 0.91,
      agentReasoning:
        'Participant reports weekly oral methotrexate started by a rheumatologist for rheumatoid arthritis. Low-dose weekly methotrexate is a chronic immunosuppressant, which this protocol prohibits. Note the dosing: methotrexate is weekly, and a daily entry would be a dosing error worth catching separately.',
      toolTrace: [
        { tool: 'resolve_drug', input: 'methotrexate', output: 'rxcui=6851 · Methotrexate · confidence 0.98' },
        { tool: 'classify_drug', input: 'rxcui=6851', output: 'ATC L04AX03 · Immunosuppressant; antimetabolite' },
        { tool: 'check_prohibited', input: 'class=Chronic immunosuppressant · CEM-2014', output: 'HIT · rule PR-0009 · §5.7.2' },
        { tool: 'resolve_date', input: '"middle of August"', output: '2026-08-15 · precision=day' },
      ],
      prohibitedHit: {
        ruleId: 'PR-0009',
        matchedOn: 'class',
        className: 'Chronic immunosuppressant',
        protocolSection: '5.7.2',
        rationale:
          'Chronic immunosuppressive therapy is prohibited throughout treatment. Immunosuppression opposes the mechanism of checkpoint blockade and may mask immune-related adverse events.',
      },
      reviewStatus: 'pending',
    },
    {
      changeId: 'CH-302',
      changeType: 'modify',
      targetLogId: 'LOG-0210',
      current: entry({
        logId: 'LOG-0210',
        reportedText: 'Levothyroxine',
        rxcui: '10582',
        canonicalName: 'Levothyroxine',
        indication: 'Hypothyroidism',
        dose: '50 mcg',
        route: 'Oral',
        frequency: 'Once daily',
        startDate: '2026-05-02',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      proposed: entry({
        logId: 'LOG-0210',
        reportedText: 'the thyroid tablet went up after my last blood test, I take the 75 now',
        rxcui: '10582',
        canonicalName: 'Levothyroxine',
        indication: 'Hypothyroidism',
        dose: '75 mcg',
        route: 'Oral',
        frequency: 'Once daily',
        startDate: '2026-05-02',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      agentConfidence: 0.87,
      agentReasoning:
        'Participant reports the levothyroxine dose was increased to 75 mcg after a thyroid function test. Levothyroxine was started during treatment and a dose increase may reflect immune-related thyroiditis, so the timing is worth checking against the adverse event log.',
      toolTrace: [
        { tool: 'resolve_drug', input: 'the thyroid tablet', output: 'rxcui=10582 · Levothyroxine · via log context · confidence 0.94' },
        { tool: 'check_prohibited', input: 'rxcui=10582 · CEM-2014', output: 'no hit' },
      ],
      prohibitedHit: null,
      reviewStatus: 'pending',
    },
    {
      changeId: 'CH-303',
      changeType: 'confirm_unchanged',
      targetLogId: 'LOG-0208',
      current: entry({
        logId: 'LOG-0208',
        reportedText: 'Amlodipine',
        rxcui: '17767',
        canonicalName: 'Amlodipine',
        indication: 'Hypertension',
        dose: '5 mg',
        route: 'Oral',
        frequency: 'Once daily',
        startDate: '2020-01-20',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      proposed: entry({
        logId: 'LOG-0208',
        reportedText: 'blood pressure one, no change, same as always',
        rxcui: '17767',
        canonicalName: 'Amlodipine',
        indication: 'Hypertension',
        dose: '5 mg',
        route: 'Oral',
        frequency: 'Once daily',
        startDate: '2020-01-20',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      agentConfidence: 0.95,
      agentReasoning: 'Participant confirmed the antihypertensive is unchanged.',
      toolTrace: [
        { tool: 'resolve_drug', input: 'blood pressure one', output: 'rxcui=17767 · Amlodipine · via log context' },
        { tool: 'check_prohibited', input: 'rxcui=17767 · CEM-2014', output: 'no hit' },
      ],
      prohibitedHit: null,
      reviewStatus: 'pending',
    },
  ],
};

// ---------------------------------------------------------------- R4018-ONC-2445

const session0498: ReconciliationSession = {
  sessionId: 'SES-2026-0498',
  subjectId: 'S-201',
  studyId: 'R4018-ONC-2445',
  nctId: 'NCT06787612',
  startedAt: at(-3, '13:40'),
  endedAt: at(-3, '13:47'),
  status: 'completed',
  changes: [
    {
      changeId: 'CH-401',
      changeType: 'stop',
      targetLogId: 'LOG-0301',
      current: entry({
        logId: 'LOG-0301',
        reportedText: 'Ondansetron',
        rxcui: '26225',
        canonicalName: 'Ondansetron',
        indication: 'Chemotherapy-induced nausea',
        dose: '8 mg',
        route: 'Oral',
        frequency: 'Twice daily PRN',
        startDate: '2026-06-02',
        startDatePrecision: 'day',
        ongoing: true,
      }),
      proposed: entry({
        logId: 'LOG-0301',
        reportedText: 'I stopped the nausea tablets, I have not needed them since the end of July',
        rxcui: '26225',
        canonicalName: 'Ondansetron',
        indication: 'Chemotherapy-induced nausea',
        dose: '8 mg',
        route: 'Oral',
        frequency: 'Twice daily PRN',
        startDate: '2026-06-02',
        startDatePrecision: 'day',
        stopDate: '2026-07-31',
        stopDatePrecision: 'day',
        ongoing: false,
      }),
      agentConfidence: 0.89,
      agentReasoning: 'Participant reports stopping the antiemetic at the end of July as nausea resolved.',
      toolTrace: [
        { tool: 'resolve_drug', input: 'the nausea tablets', output: 'rxcui=26225 · Ondansetron · via log context' },
        { tool: 'resolve_date', input: '"end of July"', output: '2026-07-31 · precision=day' },
        { tool: 'check_prohibited', input: 'rxcui=26225 · R4018-ONC-2445', output: 'no hit' },
      ],
      prohibitedHit: null,
      reviewStatus: 'accepted',
    },
  ],
};

export const SESSIONS: ReconciliationSession[] = [
  session0431,
  session0432,
  session0433,
  session0429,
  session0512,
  session0498,
];

function visit(
  studyId: string,
  over: Partial<ScheduledVisit> & Pick<ScheduledVisit, 'subjectId' | 'visitName' | 'visitAt'>,
): ScheduledVisit {
  const study = STUDIES.find((s) => s.studyId === studyId);
  return {
    sessionId: null,
    studyId,
    nctId: study?.nctId ?? NCT_ID,
    reconStatus: 'not_started',
    changeCount: 0,
    prohibitedCount: 0,
    unresolvedCount: 0,
    ...over,
  };
}

export const VISITS: ScheduledVisit[] = [
  // --- R1979-ONC-22102 ---
  visit(STUDY_ID, {
    sessionId: 'SES-2026-0431',
    subjectId: 'S-014',
    visitName: 'Cycle 5 Day 1',
    visitAt: at(0, '10:30'),
    reconStatus: 'awaiting_review',
    changeCount: 7,
    prohibitedCount: 2,
    unresolvedCount: 1,
  }),
  visit(STUDY_ID, {
    sessionId: 'SES-2026-0432',
    subjectId: 'S-021',
    visitName: 'Cycle 3 Day 1',
    visitAt: at(0, '11:15'),
    reconStatus: 'in_progress',
    changeCount: 2,
    prohibitedCount: 1,
  }),
  visit(STUDY_ID, {
    sessionId: 'SES-2026-0433',
    subjectId: 'S-033',
    visitName: 'Cycle 9 Day 1',
    visitAt: at(0, '14:00'),
    reconStatus: 'awaiting_review',
  }),
  visit(STUDY_ID, { subjectId: 'S-047', visitName: 'Screening', visitAt: at(0, '16:00') }),
  visit(STUDY_ID, { subjectId: 'S-052', visitName: 'Cycle 2 Day 1', visitAt: at(1, '09:00') }),
  visit(STUDY_ID, { subjectId: 'S-019', visitName: 'Cycle 5 Day 1', visitAt: at(1, '13:30') }),
  visit(STUDY_ID, {
    sessionId: 'SES-2026-0429',
    subjectId: 'S-008',
    visitName: 'Cycle 7 Day 1',
    visitAt: at(-2, '11:30'),
    reconStatus: 'completed',
    changeCount: 1,
  }),

  // --- CEM-2014 ---
  visit('R2810-ONC-1540', {
    sessionId: 'SES-2026-0512',
    subjectId: 'S-102',
    visitName: 'Week 12',
    visitAt: at(0, '13:00'),
    reconStatus: 'awaiting_review',
    changeCount: 3,
    prohibitedCount: 1,
  }),
  visit('R2810-ONC-1540', { subjectId: 'S-109', visitName: 'Week 24', visitAt: at(0, '15:15') }),
  visit('R2810-ONC-1540', { subjectId: 'S-114', visitName: 'Screening', visitAt: at(1, '10:45') }),
  visit('R2810-ONC-1540', { subjectId: 'S-103', visitName: 'Week 36', visitAt: at(2, '09:30') }),

  // --- R3767-ONC-22122 · no calls placed yet ---
  visit('R3767-ONC-22122', { subjectId: 'S-305', visitName: 'Cycle 4 Day 1', visitAt: at(1, '11:00') }),
  visit('R3767-ONC-22122', { subjectId: 'S-311', visitName: 'Cycle 2 Day 1', visitAt: at(2, '14:20') }),

  // --- R4018-ONC-2445 ---
  visit('R4018-ONC-2445', {
    sessionId: 'SES-2026-0498',
    subjectId: 'S-201',
    visitName: 'Cycle 6 Day 1',
    visitAt: at(-3, '14:00'),
    reconStatus: 'completed',
    changeCount: 1,
  }),
  visit('R4018-ONC-2445', { subjectId: 'S-207', visitName: 'Cycle 3 Day 1', visitAt: at(3, '10:00') }),
];
