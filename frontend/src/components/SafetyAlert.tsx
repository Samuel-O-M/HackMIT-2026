import type { ProposedChange, SafetyFlag } from '../types/contract';
import { displayName, hasSeriousSymptom } from '../lib/entry';

interface Props {
  changes: ProposedChange[];
  /** Symptoms tied to no medication. */
  flags?: SafetyFlag[];
  onJump: (changeId: string) => void;
}

/**
 * A symptom the participant described that matches the agent's red-flag list.
 * The agent does not judge it and gives no advice; this is here so a person
 * looks at it promptly instead of finding it while reviewing row by row.
 * Same weight as a prohibited finding, and above the diff for the same reason.
 */
export function SafetyAlert({ changes, flags = [], onJump }: Props) {
  const flagged = changes.filter(hasSeriousSymptom);

  // The planner flags a symptom and the row carries it too; show it once.
  const shown = flagged.map((c) => (c.proposed.sideEffectsNote ?? '').toLowerCase()).filter(Boolean);
  const general = flags.filter((f) => {
    const d = f.detail.toLowerCase();
    return !shown.some((n) => d.includes(n) || n.includes(d));
  });

  const total = flagged.length + general.length;
  if (total === 0) return null;

  return (
    <section className="alarm" aria-labelledby="safety-title">
      <header className="alarm-head">
        <h2 id="safety-title">
          Possible serious symptom reported{total === 1 ? '' : ` (${total})`}
        </h2>
        <span className="dim">Follow up promptly</span>
      </header>
      <ul className="alarm-list">
        {flagged.map((change) => (
          <li className="alarm-item alarm-safety" key={change.changeId}>
            <div>
              <div className="alarm-drug">{displayName(change.proposed)}</div>
              <div className="alarm-meta">
                Participant said: <q className="said">{change.proposed.sideEffectsNote ?? 'see transcript'}</q>
                {' · '}not assessed by the agent, which gave no advice
              </div>
            </div>
            <button className="alarm-jump" onClick={() => onJump(change.changeId)}>
              Go to change
            </button>
          </li>
        ))}
        {general.map((flag, i) => (
          <li className="alarm-item alarm-safety" key={`flag-${i}`}>
            <div>
              <div className="alarm-drug">Not tied to one medication</div>
              <div className="alarm-meta">
                {flag.detail}
                {' · '}not assessed by the agent, which gave no advice
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
