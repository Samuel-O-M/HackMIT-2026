import { LOW_CONFIDENCE } from '../lib/entry';

/**
 * Visible, not screaming. A dim gold meter pulls the eye on a low score without
 * borrowing the alarm colour, which belongs to prohibited findings alone.
 */
export function Confidence({ value }: { value: number }) {
  const low = value < LOW_CONFIDENCE;
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="conf" data-low={low}>
      <span className="conf-val">{value.toFixed(2)}</span>
      <span className="conf-meter" role="img" aria-label={`Agent confidence ${pct} percent`}>
        <i style={{ width: `${pct}%` }} />
      </span>
      {low && <span className="conf-label">Low confidence</span>}
    </div>
  );
}
