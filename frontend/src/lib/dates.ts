import type { DatePrecision } from '../types/contract';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** ISO dates arrive as plain calendar dates. Parse without a timezone shift. */
function parts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/**
 * Render a date at the precision the agent actually resolved it to.
 * A month-precision date never renders a day it does not have.
 */
export function formatPartialDate(iso: string | null, precision: DatePrecision): string {
  if (precision === 'unknown' || iso === null) return 'Date unknown';
  const p = parts(iso);
  if (!p) return 'Date unknown';
  if (precision === 'year') return `Sometime in ${p.y}`;
  if (precision === 'month') return `Around ${MONTHS[p.m - 1]} ${p.y}`;
  return `${p.d} ${MONTHS_SHORT[p.m - 1]} ${p.y}`;
}

/** True when the rendered string is an approximation rather than a known day. */
export function isApproximate(precision: DatePrecision): boolean {
  return precision !== 'day';
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}, ${clock(d)}`;
}

export function clock(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Today", "Tomorrow", or "Mon 22 Sep" — for grouping the visit schedule. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const today = startOfDay(new Date());
  const days = Math.round((startOfDay(d).getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${weekday} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown' : startOfDay(d).toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Elapsed call time as m:ss. */
export function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
