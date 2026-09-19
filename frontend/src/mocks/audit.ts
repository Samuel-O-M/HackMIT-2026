import type { AuditEvent } from '../types/ui';

/*
  Append-only history. The mock seeds what the voice agent recorded on each
  call; events created during this browser session are appended by the api
  layer, so the history reflects what the coordinator just did.

  Times hang off today, the same way the sessions do — an absolute timestamp
  here would drift out of step with the visit it belongs to.
*/

const DAY = 86_400_000;
const anchor = new Date();
anchor.setHours(0, 0, 0, 0);

function at(dayOffset: number, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(anchor.getTime() + dayOffset * DAY + h * 3_600_000 + m * 60_000).toISOString();
}

function call(
  sessionId: string,
  subjectId: string,
  day: number,
  start: string,
  end: string,
  outcome: string,
  seq: number,
): [string, AuditEvent[]] {
  return [
    sessionId,
    [
      {
        eventId: `EV-${seq}`,
        at: at(day, start),
        actor: 'Voice agent',
        action: 'call_started',
        changeId: null,
        detail: `Outbound call placed to subject ${subjectId}`,
        reason: null,
      },
      {
        eventId: `EV-${seq + 1}`,
        at: at(day, end),
        actor: 'Voice agent',
        action: 'call_ended',
        changeId: null,
        detail: outcome,
        reason: null,
      },
    ],
  ];
}

export const SEED_AUDIT: Record<string, AuditEvent[]> = Object.fromEntries([
  call('SES-2026-0431', 'S-014', 0, '08:42', '08:45', '7 proposed changes staged for review · 2 prohibited findings', 4101),
  call('SES-2026-0433', 'S-033', -1, '15:20', '15:22', 'No changes — participant reports no concomitant medications', 4201),
  call('SES-2026-0512', 'S-102', 0, '09:20', '09:22', '3 proposed changes staged for review · 1 prohibited finding', 4301),
  call('SES-2026-0498', 'S-201', -3, '13:40', '13:42', '1 proposed change staged for review', 4401),
]);

// S-008 was reviewed and promoted two days ago, so it carries the full trail.
SEED_AUDIT['SES-2026-0429'] = [
  ...call('SES-2026-0429', 'S-008', -2, '11:02', '11:04', '1 proposed change staged for review', 4001)[1],
  {
    eventId: 'EV-4003',
    at: at(-2, '13:40'),
    actor: 'ayushim',
    action: 'change_accepted',
    changeId: 'CH-091',
    detail: 'Acyclovir · frequency Twice daily → Three times daily',
    reason: 'Participant clarified at review',
  },
  {
    eventId: 'EV-4004',
    at: at(-2, '13:41'),
    actor: 'ayushim',
    action: 'promoted',
    changeId: null,
    detail: `1 change promoted to the medication log · signed by Ayushi Mehrotra at ${at(-2, '13:41')}`,
    reason:
      'I have reviewed these changes against the source and approve their entry into the medication log.',
  },
];
