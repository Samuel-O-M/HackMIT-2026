import type { ReactNode } from 'react';
import type { ConmedEntry } from '../types/contract';
import { isApproximate } from '../lib/dates';
import {
  FIELD_LABEL,
  displayName,
  isSingleAdministration,
  isUnresolved,
  startLine,
  stopLine,
} from '../lib/entry';
import type { EditableField } from '../lib/entry';
import { InlineEdit } from './InlineEdit';
import { TranscriptPeek } from './TranscriptPeek';

interface Props {
  entry: ConmedEntry | null;
  /** ATC class, when the protocol check resolved one. Never invented. */
  atcClass?: string | null;
  /** Shown when there is nothing on this side, e.g. the log side of an add. */
  absentLabel: string;
  editable?: boolean;
  changed?: Set<string>;
  onEdit?: (field: EditableField, value: string | null) => void;
  /** Where in the call this entry came from; lets the verbatim quote open its transcript. */
  source?: { sessionId: string; changeId: string };
}

function Field({
  entry,
  field,
  editable,
  changed,
  onEdit,
}: {
  entry: ConmedEntry;
  field: EditableField;
  editable: boolean;
  changed: boolean;
  onEdit?: (field: EditableField, value: string | null) => void;
}) {
  return (
    <span className="field" data-changed={changed}>
      {editable && onEdit ? (
        <InlineEdit
          value={entry[field]}
          label={FIELD_LABEL[field]}
          onCommit={(next) => onEdit(field, next)}
        />
      ) : (
        entry[field] ?? <span className="cell-empty">—</span>
      )}
    </span>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="line">
      <span className="line-label">{label}</span>
      <span className="line-body">{children}</span>
    </p>
  );
}

/**
 * One side of the diff. Lines rather than a definition list: a coordinator
 * scans a regimen as a phrase ("400 mg, oral, twice daily"), not as a form.
 */
export function EntryCell({
  entry,
  absentLabel,
  atcClass,
  editable = false,
  changed,
  onEdit,
  source,
}: Props) {
  if (!entry) {
    return (
      <div className="cell">
        <p className="cell-empty">{absentLabel}</p>
      </div>
    );
  }

  const unresolved = isUnresolved(entry);
  const has = (field: string) => changed?.has(field) ?? false;

  return (
    <div className="cell">
      <div className="drug-head">
        <span className="drug">{displayName(entry)}</span>
        {unresolved ? (
          <span className="unresolved">Unresolved · no RxNorm match</span>
        ) : (
          <span className="rxcui" title="Coded drug name — maps to CMDECOD in the SDTM CM domain">
            <span className="code-label">CMDECOD</span>
            <span className="mono">RxCUI {entry.rxcui}</span>
          </span>
        )}
      </div>

      <Line label="Regimen">
        <Field entry={entry} field="dose" editable={editable} changed={has('dose')} onEdit={onEdit} />
        <span className="sep">·</span>
        <Field entry={entry} field="route" editable={editable} changed={has('route')} onEdit={onEdit} />
        <span className="sep">·</span>
        <Field
          entry={entry}
          field="frequency"
          editable={editable}
          changed={has('frequency')}
          onEdit={onEdit}
        />
      </Line>

      <Line label="For">
        <Field
          entry={entry}
          field="indication"
          editable={editable}
          changed={has('indication')}
          onEdit={onEdit}
        />
      </Line>

      <Line label="Dates">
        <span>
          {startLine(entry)}
          {isApproximate(entry.startDatePrecision) && entry.startDate && (
            <span className="approx"> ({entry.startDatePrecision})</span>
          )}
        </span>
        <span className="sep">·</span>
        <span className="field" data-changed={has('stopDate') || has('ongoing')}>
          {stopLine(entry)}
          {!entry.ongoing &&
            !isSingleAdministration(entry) &&
            isApproximate(entry.stopDatePrecision) &&
            entry.stopDate && <span className="approx"> ({entry.stopDatePrecision})</span>}
        </span>
      </Line>

      {atcClass && (
        <Line label="Class">
          <span>{atcClass}</span>
        </Line>
      )}

      {editable && (
        <TranscriptPeek source={source} reportedText={entry.reportedText}>
          <span className="code-label">CMTRT</span> Heard: <q>{entry.reportedText}</q>
        </TranscriptPeek>
      )}
    </div>
  );
}
