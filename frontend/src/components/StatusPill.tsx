import type { ScheduledVisit } from '../types/ui';

const LABEL: Record<ScheduledVisit['reconStatus'], string> = {
  not_started: 'Call not placed',
  in_progress: 'Call in progress',
  awaiting_review: 'Awaiting review',
  completed: 'Promoted to log',
  no_contact: 'Needs another call',
};

export function StatusPill({ status }: { status: ScheduledVisit['reconStatus'] }) {
  return (
    <span className="pill" data-s={status}>
      {LABEL[status]}
    </span>
  );
}
