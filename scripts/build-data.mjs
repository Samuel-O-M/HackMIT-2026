/**
 * Rebuilds every file under patient_data/ from two inputs:
 *
 *   patient_data/catalog/registry.json  ClinicalTrials.gov snapshot per trial
 *   api/medical_data/medications.json   curated medications, RxCUIs verified vs RxNav
 *
 * Run: npm run build:data
 *
 * The six hand-written sessions are preserved verbatim — they are the demo, and
 * every word of their reasoning was checked. Everything beyond them is composed
 * from the catalog so the site has a realistic workload without inventing
 * clinical detail that would not survive being read closely.
 *
 * Deterministic: same inputs give byte-identical output.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(process.cwd(), '..');
const DATA = join(ROOT, 'patient_data');
const read = (p) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
/**
 * Anything added through the app — a trial opened from a protocol, a
 * participant enrolled — is not derivable from the inputs here. Regenerating
 * would silently delete it, so records this script did not produce are carried
 * forward. Keyed on `key`, matched against what the rebuild generated.
 */
const preserve = (relPath, generated, key) => {
  const f = join(DATA, relPath);
  if (!existsSync(f)) return generated;
  const ids = new Set(generated.map((x) => x[key]));
  const kept = JSON.parse(readFileSync(f, 'utf8')).filter((x) => !ids.has(x[key]));
  if (kept.length) console.log(`  kept ${kept.length} record(s) added through the app`);
  return [...generated, ...kept];
};

const write = (p, v) => {
  const f = join(DATA, p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);
  console.log('  wrote', p);
};

/* ---------------------------------------------------------------- random */
// mulberry32: small, seeded, reproducible.
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const chance = (r, p) => r() < p;

/* ---------------------------------------------------------------- trials */
const registry = read('catalog/registry.json');
const meds = JSON.parse(readFileSync(join(ROOT, 'api', 'medical_data', 'medications.json'), 'utf8'));

/** Hand-written where the registry title is too long to scan. */
const TRIAL_COPY = {
  'R2810-ONC-1540': ['Cemiplimab in advanced CSCC', 'Cemiplimab (REGN2810)', 'Advanced cutaneous squamous cell carcinoma'],
  'R2810-ONC-1620': ['Cemiplimab in advanced basal cell carcinoma', 'Cemiplimab (REGN2810)', 'Advanced basal cell carcinoma after hedgehog inhibitor therapy'],
  'R2810-ONC-1624': ['Cemiplimab vs chemotherapy in metastatic NSCLC', 'Cemiplimab (REGN2810)', 'Metastatic non-small cell lung cancer, PD-L1 high'],
  'R2810-ONC-1676': ['Cemiplimab in recurrent cervical cancer', 'Cemiplimab (REGN2810)', 'Recurrent or metastatic platinum-refractory cervical cancer'],
  'R2810-ONC-1690': ['Cemiplimab in pediatric solid and CNS tumors', 'Cemiplimab (REGN2810)', 'Relapsed or refractory solid and central nervous system tumors'],
  'R2810-ONC-1901': ['Cemiplimab in stage II–IV skin cancer', 'Cemiplimab (REGN2810)', 'Cutaneous squamous cell carcinoma, stage II to IV'],
  'R2810-ONC-16111': ['Cemiplimab + ipilimumab + chemotherapy in NSCLC', 'Cemiplimab + ipilimumab', 'Advanced non-small cell lung cancer'],
  'R2810-ONC-16113': ['Cemiplimab + platinum doublet in NSCLC', 'Cemiplimab + chemotherapy', 'Advanced non-small cell lung cancer'],
  'R2810-ONC-ISA-1981': ['Cemiplimab + ISA101b in HPV16+ OPC', 'Cemiplimab + ISA101b', 'Recurrent or metastatic HPV16-positive oropharyngeal cancer'],
  'R1979-HM-2298': ['Odronextamab in previously treated B-NHL', 'Odronextamab', 'Previously treated aggressive B-cell non-Hodgkin lymphoma'],
  'R1979-ONC-22102': ['Odronextamab + lenalidomide in R/R FL and MZL', 'Odronextamab + lenalidomide', 'Relapsed/refractory follicular and marginal zone lymphoma'],
};
const PIS = ['Dr L. Okonkwo', 'Dr M. Ferreira', 'Dr P. Raghunathan', 'Dr S. Lindqvist', 'Dr A. Haddad'];
const phaseOf = (p) => (p.includes('PHASE3') ? 'Phase 3' : p.includes('PHASE2') ? 'Phase 2' : 'Phase 1');

const HIGHLIGHTS = ['Chronic immunosuppressants', 'Systemic corticosteroids > 10 mg/day', 'Live attenuated vaccines'];

const r0 = rng(20260919);
const trials = registry.map((t, i) => {
  const [shortTitle, product, indication] = TRIAL_COPY[t.studyId];
  const hasDoc = Boolean(t.localFile) && t.conmedSection && existsSync(join(DATA, 'trials', t.studyId, t.localFile));
  return {
    studyId: t.studyId,
    nctId: t.nctId,
    shortTitle,
    investigationalProduct: product,
    indication,
    phase: phaseOf(t.phases),
    enrolledAtSite: 3 + Math.floor(r0() * 12),
    principalInvestigator: PIS[i % PIS.length],
    prohibitedHighlights: hasDoc ? HIGHLIGHTS : [],
  };
});

/* ------------------------------------------------------------- protocols */
const checkpointRules = (section) => [
  { ruleId: 'PR-0009', matchedOn: 'class', label: 'Chronic immunosuppressants', className: 'Chronic immunosuppressant', protocolSection: section, rationale: 'Chronic immunosuppressive therapy is prohibited throughout treatment. Immunosuppression opposes the mechanism of checkpoint blockade and may mask immune-related adverse events.', threshold: null },
  { ruleId: 'PR-0021', matchedOn: 'class', label: 'Systemic corticosteroids above 10 mg/day prednisone equivalent', className: 'Systemic corticosteroid', protocolSection: section, rationale: 'Corticosteroids above the stated threshold are prohibited. Physiologic replacement doses and short courses for non-oncologic indications may be permitted after discussion with the medical monitor.', threshold: '> 10 mg/day prednisone equivalent' },
  { ruleId: 'PR-0034', matchedOn: 'class', label: 'Live attenuated vaccines', className: 'Live attenuated vaccine', protocolSection: section, rationale: 'Live attenuated vaccines are prohibited within 4 weeks before the first dose and throughout treatment. Inactivated and recombinant vaccines are permitted.', threshold: 'Within 28 days of first dose and throughout treatment' },
  { ruleId: 'PR-0040', matchedOn: 'class', label: 'Other systemic anticancer therapy', className: 'Antineoplastic agent', protocolSection: section, rationale: 'No other systemic anticancer therapy may be given while the participant is on study treatment.', threshold: null },
];

const protocols = {};
registry.forEach((t, i) => {
  const path = t.localFile ? join(DATA, 'trials', t.studyId, t.localFile) : null;
  if (!path || !existsSync(path) || !t.conmedSection) return;
  protocols[t.studyId] = {
    documentId: `DOC-${t.studyId}`,
    studyId: t.studyId,
    filename: t.localFile,
    protocolNumber: t.studyId,
    amendment: t.localFile.includes('Amendment') ? 'Amendment 9' : 'Original protocol',
    effectiveDate: ['2021-03-15', '2020-06-18', '2020-09-09', '2020-11-02', '2021-01-11', '2020-04-30', '2020-08-21', '2021-05-06'][i % 8],
    sizeBytes: statSync(path).size,
    pageCount: null,
    uploadedBy: 'ayushim',
    uploadedAt: { dayOffset: -(8 + i * 3), time: '09:15' },
    status: 'active',
    conmedSection: t.conmedSection,
    rules: checkpointRules(t.conmedSection),
    sourceUrl: `/protocol-docs/${t.studyId}/${t.localFile}`,
  };
});

console.log(`trials: ${trials.length} · with protocol: ${Object.keys(protocols).length}`);
write('trials/trials.json', preserve('trials/trials.json', trials, 'studyId'));
{
  const f = join(DATA, 'trials', 'protocols.json');
  const existing = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  for (const [id, doc] of Object.entries(existing)) if (!protocols[id]) protocols[id] = doc;
  write('trials/protocols.json', protocols);
}

/* ---------------------------------------------------------- participants */

// Stable input, not the script's own output — so a rebuild is idempotent.
const SNAPSHOT = read('catalog/handwritten.json');
// The hand-written calls are the curated demo, and every one of them was
// conducted end to end. They predate the `ending` field, so they carry no
// outcome — which would make a completed call with no changes render as
// "no changes were captured" rather than the accurate "nothing changed".
const HAND = SNAPSHOT.sessions.map((s) => ({
  ...s,
  ending: s.ending ?? {
    outcome: 'completed',
    detail: null,
    callbackText: null,
    callbackAfter: null,
    attempt: 1,
    notAsked: [],
  },
}));
const HAND_T = SNAPSHOT.transcripts;

// Two RxCUIs in the hand-written sessions were wrong; RxNav verification caught
// them. Corrected here so the fix survives a rebuild.
const RXCUI_FIX = { '1006296': '1292422' };
for (const s of HAND) {
  for (const c of s.changes) {
    for (const e of [c.current, c.proposed]) {
      if (!e) continue;
      if (RXCUI_FIX[e.rxcui]) e.rxcui = RXCUI_FIX[e.rxcui];
      if (e.rxcui === '1655944') {
        // RxNorm carries no resolvable concept for the live intranasal influenza
        // vaccine. Unresolved is the truth; the prohibited check still fires by class.
        e.rxcui = null;
        e.canonicalName = null;
      }
    }
    if (c.proposed?.reportedText?.includes('nasal spray')) {
      c.agentConfidence = 0.58;
      c.agentReasoning =
        'Participant explicitly distinguished the nasal spray from the injection. The intranasal influenza vaccine is live attenuated, unlike the inactivated injectable. RxNorm has no concept for it, so it stays unresolved — but the prohibited check matches on class, not on a resolved code, so the finding stands.';
      c.toolTrace = [
        { tool: 'resolve_drug', input: 'flu vaccine, nasal spray', output: 'no RxNorm concept · class inferred from formulation' },
        { tool: 'classify_drug', input: 'intranasal influenza vaccine', output: 'ATC J07BB03 · Live attenuated viral vaccine' },
        { tool: 'check_prohibited', input: 'class=Live attenuated vaccine', output: 'HIT · rule PR-0034' },
      ];
    }
  }
}

const handSubjects = new Set(HAND.map((s) => s.subjectId));
const withProtocol = trials.filter((t) => protocols[t.studyId]);

const VISIT_NAMES = ['Screening', 'Cycle 2 Day 1', 'Cycle 3 Day 1', 'Cycle 4 Day 1', 'Cycle 5 Day 1', 'Cycle 7 Day 1', 'Cycle 9 Day 1', 'Cycle 12 Day 1', 'End of Treatment'];
const REASONS = ['a long time now', 'a couple of years', 'since the spring', 'about six months'];

const byName = Object.fromEntries(meds.map((m) => [m.name, m]));
const plain = meds.filter((m) => !m.trips && m.rxcui);
const tripping = meds.filter((m) => m.trips);
const dateFor = (r, yearsBack) => {
  const y = 2026 - (1 + Math.floor(r() * yearsBack));
  const mo = 1 + Math.floor(r() * 12);
  return `${y}-${String(mo).padStart(2, '0')}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}`;
};

function entry(r, med, logId, opts = {}) {
  return {
    logId,
    reportedText: opts.reportedText ?? med.name,
    rxcui: med.rxcui,
    canonicalName: med.rxcui ? med.name : null,
    indication: med.indication,
    dose: opts.dose ?? pick(r, med.doses),
    route: med.route,
    frequency: opts.frequency ?? pick(r, med.frequencies),
    startDate: opts.startDate ?? dateFor(r, 6),
    startDatePrecision: opts.startDatePrecision ?? 'day',
    stopDate: opts.stopDate ?? null,
    stopDatePrecision: opts.stopDatePrecision ?? 'unknown',
    ongoing: opts.ongoing ?? true,
  };
}

const trace = (med, studyId, hit) => {
  const steps = [
    { tool: 'resolve_drug', input: med.name.toLowerCase(), output: med.rxcui ? `rxcui=${med.rxcui} · ${med.name} · confidence 0.97` : 'no RxNorm concept above threshold' },
  ];
  if (med.atc) steps.push({ tool: 'classify_drug', input: med.rxcui ? `rxcui=${med.rxcui}` : med.name, output: `ATC ${med.atc} · ${med.class}` });
  steps.push({ tool: 'check_prohibited', input: `class=${med.class} · ${studyId}`, output: hit ? `HIT · rule ${hit.ruleId} · §${hit.protocolSection}` : 'no hit' });
  return steps;
};

const sessions = [...HAND];
const transcripts = { ...HAND_T };
const visits = [];
const audit = {};

let subjectSeq = 400;
let sessionSeq = 600;
let changeSeq = 900;

// Keep the hand-written visits and audit exactly as they are.
for (const v of SNAPSHOT.visits) visits.push(v);
for (const [k, v] of Object.entries(SNAPSHOT.audit)) audit[k] = v;

const r = rng(776611);

for (const trial of trials) {
  const rules = protocols[trial.studyId]?.rules ?? [];
  const ruleFor = (cls) => rules.find((x) => x.className === cls) ?? null;
  // Roughly the site's enrollment, minus anyone already hand-written onto it.
  const existing = HAND.filter((s) => s.studyId === trial.studyId).length;
  const count = Math.max(3, Math.min(5, trial.enrolledAtSite - existing));

  for (let i = 0; i < count; i++) {
    let subjectId = `S-${String(++subjectSeq).padStart(3, '0')}`;
    while (handSubjects.has(subjectId)) subjectId = `S-${String(++subjectSeq).padStart(3, '0')}`;

    const visitName = pick(r, VISIT_NAMES);
    const dayOffset = Math.floor(r() * 9) - 3;
    const time = `${String(9 + Math.floor(r() * 8)).padStart(2, '0')}:${pick(r, ['00', '15', '30', '45'])}`;

    // No protocol means no prohibited screening, so those trials stay un-called.
    const called = rules.length > 0 && chance(r, 0.74);
    if (!called) {
      visits.push({ sessionId: null, subjectId, studyId: trial.studyId, nctId: trial.nctId, visitName, visitAt: { dayOffset, time }, reconStatus: 'not_started', changeCount: 0, prohibitedCount: 0, unresolvedCount: 0 });
      continue;
    }

    const sessionId = `SES-2026-${++sessionSeq}`;
    const baseline = [];
    const used = new Set();
    for (let b = 0; b < 2 + Math.floor(r() * 3); b++) {
      const m = pick(r, plain);
      if (used.has(m.name)) continue;
      used.add(m.name);
      baseline.push(m);
    }

    const changes = [];
    // One confirmed-unchanged, so the log shows it was reviewed this visit.
    if (baseline[0]) {
      const m = baseline[0];
      const cur = entry(r, m, `LOG-${sessionSeq}-0`);
      changes.push({ changeId: `CH-${++changeSeq}`, changeType: 'confirm_unchanged', targetLogId: cur.logId, current: cur, proposed: { ...cur, reportedText: `the ${m.indication.toLowerCase()} one, no change` }, agentConfidence: 0.93 + r() * 0.06, agentReasoning: `Participant confirmed ${m.name.toLowerCase()} is unchanged. All logged fields match what was reported.`, toolTrace: trace(m, trial.studyId, null), prohibitedHit: null, reviewStatus: 'pending' });
    }
    // A dose change.
    if (baseline[1] && baseline[1].doses.length > 1) {
      const m = baseline[1];
      const cur = entry(r, m, `LOG-${sessionSeq}-1`, { dose: m.doses[0] });
      changes.push({ changeId: `CH-${++changeSeq}`, changeType: 'modify', targetLogId: cur.logId, current: cur, proposed: { ...cur, dose: m.doses[1], reportedText: `they changed the ${m.name.toLowerCase()} dose` }, agentConfidence: 0.82 + r() * 0.12, agentReasoning: `Participant reports the ${m.name.toLowerCase()} dose changed from ${m.doses[0]} to ${m.doses[1]}. Route, frequency and start date are unchanged.`, toolTrace: trace(m, trial.studyId, null), prohibitedHit: null, reviewStatus: 'pending' });
    }
    // A stop, at month precision — partial dates are the common case.
    if (baseline[2] && chance(r, 0.6)) {
      const m = baseline[2];
      const cur = entry(r, m, `LOG-${sessionSeq}-2`);
      changes.push({ changeId: `CH-${++changeSeq}`, changeType: 'stop', targetLogId: cur.logId, current: cur, proposed: { ...cur, ongoing: false, stopDate: '2026-07-01', stopDatePrecision: 'month', reportedText: `I came off the ${m.indication.toLowerCase()} one back in July` }, agentConfidence: 0.71 + r() * 0.15, agentReasoning: `Participant reports stopping ${m.name.toLowerCase()} in July. They could not name a day, so the stop date is held at month precision rather than guessed.`, toolTrace: [...trace(m, trial.studyId, null), { tool: 'resolve_date', input: '"back in July"', output: '2026-07-01 · precision=month' }], prohibitedHit: null, reviewStatus: 'pending' });
    }
    // A prohibited finding on about a third of calls.
    if (chance(r, 0.34)) {
      const m = pick(r, tripping);
      const rule = ruleFor(m.trips);
      if (rule) {
        const overThreshold = m.doseDependent ? m.doses[0] : pick(r, m.doses);
        changes.push({ changeId: `CH-${++changeSeq}`, changeType: 'add', targetLogId: null, current: null, proposed: entry(r, m, `NEW-${sessionSeq}`, { dose: overThreshold, startDate: '2026-08-14', startDatePrecision: 'day', reportedText: `another doctor started me on ${m.name.toLowerCase()}` }), agentConfidence: m.rxcui ? 0.88 + r() * 0.09 : 0.55 + r() * 0.1, agentReasoning: m.doseDependent ? `Participant reports ${m.name.toLowerCase()} at ${overThreshold}. The protocol permits this class only up to 10 mg/day prednisone equivalent, so this is a dose-threshold breach rather than a blanket ban — a taper may resolve it.` : `Participant reports ${m.name.toLowerCase()}, which falls in a class this protocol prohibits throughout treatment.`, toolTrace: trace(m, trial.studyId, rule), prohibitedHit: { ruleId: rule.ruleId, matchedOn: 'class', className: rule.className, protocolSection: rule.protocolSection, rationale: rule.rationale }, reviewStatus: 'pending' });
      }
    }
    // An unresolved entry on a few — a real output, not an error.
    if (chance(r, 0.22)) {
      changes.push({ changeId: `CH-${++changeSeq}`, changeType: 'add', targetLogId: null, current: null, proposed: { logId: `NEW-${sessionSeq}-u`, reportedText: pick(r, ['a small white tablet for my stomach, I do not know the name', 'something my wife picks up for my joints', 'a yellow capsule, twice a day, I would have to check the box']), rxcui: null, canonicalName: null, indication: 'Unspecified', dose: null, route: 'Oral', frequency: 'Once daily', startDate: null, startDatePrecision: 'unknown', stopDate: null, stopDatePrecision: 'unknown', ongoing: true }, agentConfidence: 0.33 + r() * 0.12, agentReasoning: 'Participant described a medication they could not name. Color and form are not enough to identify a product, so no resolution was attempted beyond the failed lookup. The coordinator needs to ask them to bring the bottle to the visit.', toolTrace: [{ tool: 'resolve_drug', input: 'unnamed tablet', output: 'no match above threshold' }, { tool: 'resolve_date', input: `"${pick(r, REASONS)}"`, output: 'unresolved · precision=unknown' }], prohibitedHit: null, reviewStatus: 'pending' });
    }

    const startH = 8 + Math.floor(r() * 6);
    const started = { dayOffset, time: `${String(startH).padStart(2, '0')}:${pick(r, ['05', '20', '40'])}` };
    const ended = { dayOffset, time: `${String(startH).padStart(2, '0')}:${pick(r, ['48', '52', '57'])}` };
    const promoted = dayOffset < 0 && chance(r, 0.55);
    if (promoted) for (const c of changes) c.reviewStatus = 'accepted';

    // What the call found beyond the list: adherence, tolerability, the
    // protocol's non-drug rules, and who was actually on the phone. Synthetic
    // like the rest of the call content — the trials and the protocol rules
    // these are checked against are real.
    const onLog = changes.map((c) => c.current?.canonicalName).filter(Boolean);
    const adherence = onLog.slice(0, 2).map((name) => {
      const missed = chance(r, 0.38) ? 1 + Math.floor(r() * 4) : 0;
      return {
        canonicalName: name,
        isStudyDrug: false,
        extent: missed === 0 ? 'as_prescribed' : missed >= 4 ? 'stopped' : 'missed_some',
        daysMissed: missed === 0 ? 0 : missed,
        recallDays: 7,
        reasons: missed === 0 ? [] : [pick(r, ['forgot', 'side_effects', 'ran_out', 'too_many'])],
        reportedText: missed === 0
          ? 'Yes, every day, no trouble with that one.'
          : pick(r, ['I miss the evening one now and then.', 'A couple of days I forgot it.', 'I ran out before the repeat came through.']),
      };
    });

    // Symptoms, with the label check the bridge would have resolved live.
    const SYMPTOMS = [
      { symptom: 'nausea', onLabel: true }, { symptom: 'headache', onLabel: true },
      { symptom: 'fatigue', onLabel: true }, { symptom: 'trouble sleeping', onLabel: false },
      { symptom: 'a metallic taste', onLabel: false }, { symptom: 'dizziness', onLabel: true },
    ];
    const symptoms = onLog.length && chance(r, 0.45)
      ? [pick(r, SYMPTOMS)].map((sx) => ({
          canonicalName: onLog[0], isStudyDrug: false, symptom: sx.symptom,
          severity: chance(r, 0.4) ? pick(r, ['mild', 'moderate']) : null,
          since: null, sincePrecision: 'unknown',
          onLabel: sx.onLabel, labelSource: 'openFDA drug/label',
          reportedText: `I have had some ${sx.symptom} since starting it.`,
        }))
      : [];

    // Every one of these trials is cemiplimab, so these are its real rules.
    const drinks = Math.floor(r() * 4);
    const behaviours = [
      {
        behaviourCode: 'alcohol',
        status: chance(r, 0.12) ? 'declined_to_answer' : drinks === 0 ? 'denied' : 'reported',
        reportedText: drinks === 0 ? 'No, I do not drink.' : `A glass ${drinks > 2 ? 'most nights' : 'now and then'}.`,
        frequency: drinks === 0 ? null : drinks > 2 ? 'most days' : 'monthly or less',
        quantity: drinks === 0 ? null : `${drinks} standard drink${drinks === 1 ? '' : 's'}`,
        period: 'typical week', instrument: 'AUDIT-C', instrumentScore: null, // set below, only when answered
        rule: { ruleType: 'monitored', threshold: 'Record usual intake; no fixed limit', protocolSection: '5.7', rationale: 'Intake is needed to interpret liver function tests during treatment.' },
        breachesRule: false,
      },
      {
        behaviourCode: 'contraception',
        // A 'required' rule: the finding is that it is NOT being followed.
        status: chance(r, 0.08) ? 'denied' : 'reported',
        reportedText: null, frequency: null, quantity: null, period: null,
        instrument: null, instrumentScore: null,
        rule: { ruleType: 'required', threshold: 'Highly effective contraception during treatment and for 6 months after the last dose', protocolSection: '5.6', rationale: 'Reproductive toxicity of the study drug has not been established.' },
        breachesRule: false,
      },
    ];
    for (const b of behaviours) {
      if (b.rule.ruleType === 'required') b.breachesRule = b.status === 'denied';
      // A screen only has a score if the questions were answered.
      if (b.instrument && b.status !== 'declined_to_answer' && b.status !== 'unknown') {
        b.instrumentScore = drinks === 0 ? 0 : drinks + 1;
      }
    }

    const caregiver = chance(r, 0.18);
    const callParticipants = {
      caregiverPresent: caregiver,
      caregiverRelationship: caregiver ? pick(r, ['daughter', 'son', 'husband', 'wife']) : null,
      caregiverAuthStatus: caregiver ? 'authorised' : 'none',
    };

    // How the call ended. Most complete; a few do not, because that is what
    // calling forty people actually looks like and a demo where every call
    // succeeds hides the case the screen most needs to handle.
    const roll = r();
    let outcome = 'completed';
    let callbackText = null;
    let notAsked = [];
    if (!promoted && roll < 0.08) {
      outcome = 'reschedule_requested';
      callbackText = pick(r, ['tomorrow morning', 'after four, when I am home from work', 'Monday, any time']);
      // They asked to stop, so the rest of the sweep never happened.
      notAsked = ['contraception'];
    } else if (!promoted && roll < 0.13) {
      outcome = 'partial';
      notAsked = ['contraception'];
    } else if (!promoted && roll < 0.16) {
      outcome = 'no_answer';
    }

    const noContact = outcome === 'no_answer';
    const ending = {
      outcome,
      detail: null,
      callbackText,
      callbackAfter: null,
      attempt: outcome === 'no_answer' ? 1 + Math.floor(r() * 3) : 1,
      notAsked,
    };

    // A call nobody answered has nothing in it. Publishing findings against
    // one would be inventing a conversation that did not happen.
    const ended_changes = noContact ? [] : changes;
    const ended_adherence = noContact ? [] : adherence;
    const ended_symptoms = noContact ? [] : symptoms;
    const ended_behaviours = noContact ? [] : behaviours.filter((b) => !notAsked.includes(b.behaviourCode));

    sessions.push({
      sessionId, subjectId, studyId: trial.studyId, nctId: trial.nctId,
      startedAt: started, endedAt: ended,
      status: promoted ? 'completed' : noContact ? 'no_contact' : 'awaiting_review',
      changes: ended_changes,
      adherence: ended_adherence,
      symptoms: ended_symptoms,
      behaviours: ended_behaviours,
      callParticipants, ending,
    });

    // A transcript that matches the call that produced it.
    //
    // A call nobody answered has no conversation. Generating one anyway gave
    // SES-2026-619 seven turns of dialogue under the heading "No answer" —
    // the transcript builder ran downstream of the outcome and never saw it.
    const turns = noContact ? [] : [{ atMs: 0, speaker: 'agent', text: `Good morning. This is the study team calling ahead of your ${visitName} visit. Do you have a few minutes to go through your medications?` }, { atMs: 5600, speaker: 'participant', text: 'Yes, that is fine.' }];
    let t = 9000;
    // `ended_changes`, not `changes`: an unanswered call has no changes and
    // must get no dialogue. Iterating the pre-outcome list refilled the array
    // the line above had deliberately left empty, and produced a seven-turn
    // conversation under the heading "No answer".
    for (const c of ended_changes) {
      const name = c.proposed.canonicalName ?? 'that one';
      turns.push({ atMs: t, speaker: 'agent', text: c.changeType === 'add' ? 'Has anything new started since we last spoke, including anything another doctor prescribed?' : `I have ${name.toLowerCase()} on file${c.current?.dose ? `, ${c.current.dose}` : ''}. Is that still right?` });
      t += 6200;
      turns.push({ atMs: t, speaker: 'participant', text: c.proposed.reportedText, yields: [c.changeId] });
      t += 6800;
    }
    // The sign-off belongs to a call that was actually had.
    if (!noContact) {
      turns.push({ atMs: t, speaker: 'agent', text: 'That is everything I needed. Thank you for your time.' });
    }
    if (turns.length) transcripts[sessionId] = turns;

    audit[sessionId] = [
      { eventId: `EV-${sessionSeq}1`, at: started, actor: 'Voice agent', action: 'call_started', changeId: null, detail: `Outbound call placed to subject ${subjectId}`, reason: null },
      { eventId: `EV-${sessionSeq}2`, at: ended, actor: 'Voice agent', action: 'call_ended', changeId: null, detail: `${changes.length} proposed change${changes.length === 1 ? '' : 's'} staged for review`, reason: null },
    ];

    visits.push({ sessionId, subjectId, studyId: trial.studyId, nctId: trial.nctId, visitName, visitAt: { dayOffset, time }, reconStatus: promoted ? 'completed' : noContact ? 'no_contact' : 'awaiting_review', changeCount: ended_changes.length, prohibitedCount: ended_changes.filter((c) => c.prohibitedHit).length, unresolvedCount: ended_changes.filter((c) => c.proposed.rxcui === null).length });
  }
}

write('participants/sessions.json', sessions);
write('participants/transcripts.json', transcripts);
write('participants/visits.json', visits);
write('participants/audit.json', audit);

/*
  Participants as a record in their own right, not something inferred from a
  visit. Real enrollment is: consent signed -> screening number -> eligibility
  checked -> randomized, which is what assigns the subject id. Leaving a study
  is a disposition event with a CDISC DS reason, never a deletion.
*/
const CONSENT_VERSIONS = ['ICF v3.0', 'ICF v2.1', 'ICF v4.0'];
const roster = [];
const seenSubjects = new Set();
for (const v of visits) {
  if (seenSubjects.has(v.subjectId)) continue;
  seenSubjects.add(v.subjectId);
  const n = Number(v.subjectId.replace(/\D/g, '')) || 1;
  const consentDay = -(30 + (n % 240));
  roster.push({
    subjectId: v.subjectId,
    studyId: v.studyId,
    status: 'enrolled',
    screeningNumber: `SCR-${String(n).padStart(4, '0')}`,
    consentVersion: CONSENT_VERSIONS[n % CONSENT_VERSIONS.length],
    consentDate: { dayOffset: consentDay, time: '09:00' },
    enrolledDate: { dayOffset: consentDay + 14, time: '11:00' },
    icfFilename: null,
    discontinuation: null,
  });
}
write('participants/participants.json', preserve('participants/participants.json', roster, 'subjectId'));

const subjects = new Set(visits.map((v) => v.subjectId));
console.log(`participants: ${subjects.size} · visits: ${visits.length} · sessions: ${sessions.length} · transcripts: ${Object.keys(transcripts).length}`);
