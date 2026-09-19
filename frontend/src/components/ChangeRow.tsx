import { useId, useState } from 'react';
import type { ProposedChange } from '../types/contract';
import type { DataQuery } from '../types/ui';
import { CHANGE_TAG, CHANGE_VERB, changedFields } from '../lib/entry';
import type { EditableField } from '../lib/entry';
import { Confidence } from './Confidence';
import { EntryCell } from './EntryCell';
import { ToolTrace } from './ToolTrace';

interface Props {
  change: ProposedChange;
  queries: DataQuery[];
  onAccept: () => void;
  onReject: () => void;
  onQuery: () => void;
  onEdit: (field: EditableField, value: string | null) => void;
  /** Set by the alert band's jump link so the row can announce itself once. */
  flash?: boolean;
  locked?: boolean;
}

export function ChangeRow({
  change,
  queries,
  onAccept,
  onReject,
  onQuery,
  onEdit,
  flash,
  locked,
}: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const changed = changedFields(change);
  const accepted = change.reviewStatus === 'accepted' || change.reviewStatus === 'edited';
  const openQuery = queries.find((q) => q.status === 'open') ?? null;

  return (
    <article
      className={`row${flash ? ' flash' : ''}`}
      id={`change-${change.changeId}`}
      data-status={change.reviewStatus}
      data-queried={openQuery !== null}
      data-prohibited={change.prohibitedHit !== null}
      aria-label={`${CHANGE_VERB[change.changeType]}: ${change.proposed.canonicalName ?? change.proposed.reportedText}`}
    >
      <div className="row-grid">
        <div>
          <span className="tag" data-type={change.changeType}>
            {CHANGE_TAG[change.changeType]}
          </span>
        </div>

        <EntryCell entry={change.current} absentLabel="Not in the log" />

        <EntryCell
          entry={change.proposed}
          absentLabel="—"
          atcClass={change.prohibitedHit?.className ?? null}
          editable={!locked}
          changed={changed}
          onEdit={onEdit}
        />

        <div>
          <Confidence value={change.agentConfidence} />
        </div>

        <div className="row-actions">
          <div className="action-pair">
            <button
              className="btn"
              data-kind="accept"
              aria-pressed={accepted}
              disabled={locked}
              onClick={onAccept}
            >
              {accepted ? 'Confirmed' : 'Confirm'}
            </button>
            <button
              className="btn"
              data-kind="reject"
              aria-pressed={change.reviewStatus === 'rejected'}
              disabled={locked}
              onClick={onReject}
            >
              {change.reviewStatus === 'rejected' ? 'Rejected' : 'Reject'}
            </button>
          </div>
          <button className="btn" data-kind="query" disabled={locked} onClick={onQuery}>
            {openQuery ? 'Add another query' : 'Raise query'}
          </button>
          {change.reviewStatus === 'edited' && <span className="edited-mark">Edited by you</span>}
        </div>
      </div>

      {openQuery && (
        <p className="query-note">
          <span className="mono">{openQuery.queryId}</span> open · {openQuery.text}
        </p>
      )}

      <div className="disclose">
        <button
          className="disclose-btn"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          <i aria-hidden="true" data-open={open} />
          {open ? 'Hide' : 'Show'} reasoning and {change.toolTrace.length} tool call
          {change.toolTrace.length === 1 ? '' : 's'}
        </button>
        {open && (
          <div id={panelId}>
            <ToolTrace change={change} />
          </div>
        )}
      </div>
    </article>
  );
}
