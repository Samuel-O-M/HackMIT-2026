import type { BehaviourReport, ProposedChange } from '../types/contract';
import type { ProtocolDeviation } from '../types/ui';
import { displayName } from '../lib/entry';
import { Disclosure } from './Disclosure';
import { behaviourLabel, behaviourSummary } from '../lib/callFindings';

interface Props {
  changes: ProposedChange[];
  behaviours?: BehaviourReport[];
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
  behaviours = [],
  deviations,
  locked,
  onJump,
  onLogDeviation,
}: Props) {
  const hits = changes.filter((c) => c.prohibitedHit !== null);
  // A protocol breach is a protocol breach whether it was a drug or a pint.
  // These join the existing alert rather than raising a second one: two things
  // competing to be the loudest means neither reads as loud.
  const breaches = behaviours.filter((b) => b.breachesRule);
  const total = hits.length + breaches.length;
  if (total === 0) return null;
  const filed = new Map(deviations.map((d) => [d.changeId, d]));

  return (
    <section className="alarm" aria-labelledby="alarm-title">
      <header className="alarm-head">
        <h2 id="alarm-title">
          {breaches.length === 0
            ? `${hits.length} prohibited medication${hits.length === 1 ? '' : 's'} reported`
            : `${total} protocol finding${total === 1 ? '' : 's'}`}
        </h2>
        <span className="dim">
          {/* A deviation is filed against a medication change. With no drug
              hits there is nothing to have filed, and "0 of 0 filed" was
              rendering as an all-clear over an unaddressed finding. */}
          {hits.length > 0 && filed.size === hits.length
            ? 'Deviations filed'
            : 'Discuss at the visit'}
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
                  {/* Only shown where it changes the reading: a rule that also
                      governed the run-up to dosing is easy to mistake for one
                      the participant breached at screening. */}
                  {hit.appliesWhen === 'both' && ' · applies before and during treatment'}
                  {hit.doseLimit && ` · only above ${hit.doseLimit}`}
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

        {breaches.map((b) => (
          <li className="alarm-item" key={`behaviour-${b.behaviourCode}`}>
            <div>
              <div className="alarm-drug">{behaviourLabel(b.behaviourCode)}</div>
              <div className="alarm-meta">
                {behaviourSummary(b)}
                {b.rule?.protocolSection && ` · Protocol §${b.rule.protocolSection}`}
                {b.rule?.ruleType === 'required' && ' · required by protocol'}
              </div>
            </div>
            {(b.rule?.threshold || b.rule?.rationale) && (
              <Disclosure tone="alarm" label="What the protocol requires">
                {b.rule?.threshold && <p>{b.rule.threshold}</p>}
                {b.rule?.rationale && <p>{b.rule.rationale}</p>}
              </Disclosure>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
