import type { CallEnding } from '../types/contract';
import { behaviourLabel, outcomeAction, outcomeLabel } from '../lib/callFindings';

interface Props {
  ending?: CallEnding;
  onCallAgain?: () => void;
}

/**
 * How the call ended, when that changes what the rest of the screen means.
 *
 * A completed call needs no banner — the findings speak for themselves, and a
 * notice on every screen is a notice nobody reads. This appears only when the
 * call did not go to plan, because then the absence of findings is not a
 * finding, and a coordinator reading the page without knowing that would draw
 * the wrong conclusion from a blank one.
 */
export function CallEndingNote({ ending, onCallAgain }: Props) {
  if (!ending || ending.outcome === 'completed' || ending.outcome === 'in_progress') return null;

  const action = outcomeAction(ending);
  // A callback request is a job for someone, not a problem with the call.
  const tone = ending.outcome === 'reschedule_requested' ? 'note' : 'attention';
  const canRetry =
    onCallAgain &&
    ['reschedule_requested', 'no_answer', 'participant_unavailable', 'abandoned'].includes(
      ending.outcome,
    );

  return (
    <section className="ending" data-tone={tone} role="note" aria-labelledby="ending-title">
      <div className="ending-main">
        <h2 id="ending-title" className="ending-title">
          {outcomeLabel(ending.outcome)}
          {ending.attempt > 1 && (
            <span className="ending-attempt">attempt {ending.attempt}</span>
          )}
        </h2>
        {action && <p className="ending-action">{action}</p>}
        {ending.detail && <p className="ending-detail">“{ending.detail}”</p>}
        {ending.notAsked.length > 0 && (
          <p className="ending-detail">
            Not asked on this call: {ending.notAsked.map(behaviourLabel).join(', ').toLowerCase()}.
          </p>
        )}
      </div>
      {canRetry && (
        <button className="btn" onClick={onCallAgain}>
          Call again
        </button>
      )}
    </section>
  );
}
