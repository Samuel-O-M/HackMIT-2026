import type { ProposedChange } from '../types/contract';
import type { ProtocolDeviation } from '../types/ui';
import { displayName } from '../lib/entry';
import { Disclosure } from './Disclosure';

interface Props {
  changes: ProposedChange[];
  deviations: ProtocolDeviation[];
  locked: boolean;
  onJump: (changeId: string) => void;
  onLogDeviation: (change: ProposedChange) => void;
}

/**
 * The one loud thing. Sits above the diff so a prohibited finding is never
 * something the coordinator has to scroll to discover.
 */
export function ProhibitedAlert({
  changes,
  deviations,
  locked,
  onJump,
  onLogDeviation,
}: Props) {
  const hits = changes.filter((c) => c.prohibitedHit !== null);
  if (hits.length === 0) return null;
  const filed = new Map(deviations.map((d) => [d.changeId, d]));

  return (
    <section className="alarm" aria-labelledby="alarm-title">
      <header className="alarm-head">
        <h2 id="alarm-title">
          {hits.length} prohibited medication{hits.length === 1 ? '' : 's'} reported
        </h2>
        <span className="dim">
          {filed.size === hits.length ? 'Deviations filed' : 'Discuss at the visit'}
        </span>
      </header>
      <ul className="alarm-list">
        {hits.map((change) => {
          const hit = change.prohibitedHit!;
          return (
            <li className="alarm-item" key={change.changeId}>
              <div>
                <div className="alarm-drug">{displayName(change.proposed)}</div>
                <div className="alarm-meta">
                  {hit.matchedOn === 'class' && hit.className
                    ? `Matched on class · ${hit.className}`
                    : 'Matched on drug'}
                  {' · '}
                  Protocol §{hit.protocolSection} · rule <span className="mono">{hit.ruleId}</span>
                </div>
              </div>
              <Disclosure tone="alarm" label="Why it is prohibited">
                {hit.rationale}
              </Disclosure>
              <div className="alarm-acts">
                <button className="alarm-jump" onClick={() => onJump(change.changeId)}>
                  Go to change
                </button>
                {filed.has(change.changeId) ? (
                  <span className="alarm-filed">
                    Deviation <span className="mono">{filed.get(change.changeId)!.deviationId}</span>{' '}
                    filed
                  </span>
                ) : (
                  <button
                    className="alarm-jump"
                    data-primary="true"
                    disabled={locked}
                    onClick={() => onLogDeviation(change)}
                  >
                    Log deviation
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
