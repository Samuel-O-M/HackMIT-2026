import type { AuditEvent } from '../types/ui';

/*
  Append-only history. The mock seeds the completed session; events recorded
  during this browser session are appended by the api layer so the audit view
  reflects what the coordinator just did.
*/

export const SEED_AUDIT: Record<string, AuditEvent[]> = {
  'SES-2026-0429': [
    {
      eventId: 'EV-4001',
      at: '2026-09-17T11:02:14Z',
      actor: 'Voice agent',
      action: 'call_started',
      changeId: null,
      detail: 'Outbound call placed to subject S-008',
      reason: null,
    },
    {
      eventId: 'EV-4002',
      at: '2026-09-17T11:14:02Z',
      actor: 'Voice agent',
      action: 'call_ended',
      changeId: null,
      detail: '1 proposed change staged for review',
      reason: null,
    },
    {
      eventId: 'EV-4003',
      at: '2026-09-17T13:40:51Z',
      actor: 'ayushim',
      action: 'change_accepted',
      changeId: 'CH-091',
      detail: 'Acyclovir · frequency Twice daily → Three times daily',
      reason: 'Participant clarified at review',
    },
    {
      eventId: 'EV-4004',
      at: '2026-09-17T13:41:09Z',
      actor: 'ayushim',
      action: 'promoted',
      changeId: null,
      detail:
        '1 change promoted to the medication log · signed by Ayushi Mehrotra at 2026-09-17T13:41:09Z',
      reason:
        'I have reviewed these changes against the source and approve their entry into the medication log.',
    },
  ],
  'SES-2026-0431': [
    {
      eventId: 'EV-4101',
      at: new Date(Date.now() - 3600_000).toISOString(),
      actor: 'Voice agent',
      action: 'call_started',
      changeId: null,
      detail: 'Outbound call placed to subject S-014',
      reason: null,
    },
    {
      eventId: 'EV-4102',
      at: new Date(Date.now() - 3060_000).toISOString(),
      actor: 'Voice agent',
      action: 'call_ended',
      changeId: null,
      detail: '7 proposed changes staged for review · 2 prohibited findings',
      reason: null,
    },
  ],
};
