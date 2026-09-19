/**
 * The fixture JSON under data/ stores scheduling timestamps as an offset from
 * today rather than an absolute instant, so the demo never looks stale. This
 * turns them back into ISO strings at load.
 *
 * Only scheduling times are relative — when a call happened, when a visit is
 * due. Clinical dates (a medication start date, a protocol effective date) are
 * real calendar dates and are stored literally.
 */

export interface RelativeTime {
  dayOffset: number;
  time: string;
}

const DAY = 86_400_000;

function anchor(): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}

export function toIso(value: RelativeTime): string {
  const [h, m] = value.time.split(':').map(Number);
  return new Date(anchor() + value.dayOffset * DAY + h * 3_600_000 + m * 60_000).toISOString();
}
