import type {
  AdherenceExtent,
  AdherenceReason,
  AdherenceReport,
  BehaviourReport,
  BehaviourRuleType,
} from '../types/contract';

/**
 * Display vocabulary for what a call found beyond the medication list.
 *
 * Kept out of the components because the wording is a clinical decision, not a
 * layout one: "missed some doses" and "non-compliant" describe the same data
 * and only one of them is something a coordinator should read.
 */

const BEHAVIOUR_LABELS: Record<string, string> = {
  alcohol: 'Alcohol',
  nicotine: 'Smoking and nicotine',
  grapefruit: 'Grapefruit',
  contraception: 'Contraception',
  pregnancy: 'Pregnancy and breastfeeding',
  blood_donation: 'Blood donation',
  sun_exposure: 'Sun exposure',
  strenuous_exercise: 'Strenuous exercise',
  recreational_drugs: 'Recreational drugs',
  caffeine: 'Caffeine',
};

export function behaviourLabel(code: string): string {
  return BEHAVIOUR_LABELS[code] ?? code.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

const EXTENT_LABELS: Record<AdherenceExtent, string> = {
  as_prescribed: 'Taking as prescribed',
  missed_some: 'Missing some doses',
  stopped: 'Stopped taking it',
  never_started: 'Never started',
  unknown: 'Not established',
};

export function extentLabel(extent: AdherenceExtent): string {
  return EXTENT_LABELS[extent] ?? EXTENT_LABELS.unknown;
}

const REASON_LABELS: Record<AdherenceReason, string> = {
  forgot: 'forgets',
  side_effects: 'side effects',
  felt_better: 'felt better',
  cost: 'cost',
  too_many: 'too many tablets',
  ran_out: 'ran out',
  instructions_unclear: 'unclear instructions',
  other: 'other',
};

export function reasonLabel(reason: AdherenceReason): string {
  return REASON_LABELS[reason] ?? String(reason).replace(/_/g, ' ');
}

/**
 * How much attention a single adherence report deserves.
 *
 * 'attention' is deliberately not 'alarm'. The prohibited-medication alert is
 * the only loud thing on this screen; an adherence gap pulls the eye without
 * competing with it.
 */
export type FindingTone = 'attention' | 'note' | 'quiet';

export function adherenceTone(report: AdherenceReport): FindingTone {
  if (report.extent === 'stopped' || report.extent === 'never_started') return 'attention';
  if (report.extent === 'missed_some') {
    // A missed dose of the study drug is a different matter from a missed
    // vitamin: it is what the trial is measuring.
    if (report.isStudyDrug) return 'attention';
    const missed = report.daysMissed;
    return missed != null && missed >= Math.ceil(report.recallDays / 2) ? 'attention' : 'note';
  }
  if (report.extent === 'unknown') return 'note';
  return 'quiet';
}

/** "3 of the last 7 days" — a count is meaningless without its window. */
export function missedPhrase(report: AdherenceReport): string | null {
  if (report.daysMissed == null) return null;
  return `${report.daysMissed} of the last ${report.recallDays} days`;
}

export function behaviourTone(report: BehaviourReport): FindingTone {
  if (report.breachesRule) return 'attention';
  if (report.status === 'declined_to_answer') return 'note';
  return 'quiet';
}

/**
 * What the coordinator is looking at, in one line.
 *
 * A 'required' rule reads backwards from the others — the finding is that the
 * participant is *not* doing something — so it gets its own sentence rather
 * than being forced into the same template.
 */
export function behaviourSummary(report: BehaviourReport): string {
  if (report.status === 'declined_to_answer') return 'Declined to answer';
  if (report.status === 'unknown') return 'Not asked';

  const ruleType: BehaviourRuleType | null = report.rule?.ruleType ?? null;
  if (ruleType === 'required') {
    return report.status === 'denied'
      ? 'Reported NOT being followed'
      : 'Reported as being followed';
  }
  if (report.status === 'denied') return 'None reported';

  const detail = [report.quantity, report.frequency].filter(Boolean).join(', ');
  return detail ? `Reported — ${detail}` : 'Reported';
}

/**
 * AUDIT-C is scored 0–12; ≥4 in men and ≥3 in women is a positive screen.
 *
 * A score requires answers. Someone who declined has not scored zero — they
 * have not scored — and rendering "AUDIT-C 0 of 12" against a refusal states
 * the opposite of what happened.
 */
export function instrumentPhrase(report: BehaviourReport): string | null {
  if (report.status === 'declined_to_answer' || report.status === 'unknown') return null;
  if (!report.instrument || report.instrumentScore == null) return null;
  if (report.instrument === 'AUDIT-C') {
    return `AUDIT-C ${report.instrumentScore} of 12`;
  }
  return `${report.instrument} ${report.instrumentScore}`;
}
