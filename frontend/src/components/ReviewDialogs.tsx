import { useState } from 'react';
import type { ProposedChange } from '../types/contract';
import type { Coordinator } from '../auth';
import { SIGNATURE_MEANING, type DeviationInput } from '../api/transport';
import { FIELD_LABEL, displayName, type EditableField } from '../lib/entry';
import { Dialog } from './Dialog';

/* ---------------------------------------------------------------- reason */

/** The reason codes an EDC offers; "Other" forces a free-text explanation. */
const REASON_CODES = [
  'Participant clarified at review',
  'Transcription error',
  'Source document correction',
  'Agent misheard the participant',
  'Other',
] as const;

export interface PendingEdit {
  change: ProposedChange;
  field: EditableField;
  value: string | null;
}

export function ReasonForChangeDialog({
  edit,
  onConfirm,
  onCancel,
}: {
  edit: PendingEdit;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState<string>(REASON_CODES[0]);
  const [note, setNote] = useState('');
  const needsNote = code === 'Other';
  const reason = needsNote ? note.trim() : note.trim() ? `${code} — ${note.trim()}` : code;

  return (
    <Dialog
      title="Reason for change"
      lede="Part 11 audit trails record who changed a value, when, and why. This reason is written to the trail and cannot be edited afterwards."
      confirmLabel="Save change"
      confirmDisabled={needsNote && note.trim() === ''}
      onConfirm={() => onConfirm(reason)}
      onCancel={onCancel}
    >
      <div className="dialog-readback">
        <b>{displayName(edit.change.proposed)}</b>
        <span>
          {FIELD_LABEL[edit.field]}: <span className="dim">{edit.change.proposed[edit.field] ?? 'not recorded'}</span>{' '}
          → <b>{edit.value ?? 'not recorded'}</b>
        </span>
      </div>

      <label className="field-row">
        <span>Reason</span>
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {REASON_CODES.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>

      <label className="field-row">
        <span>{needsNote ? 'Explanation (required)' : 'Note (optional)'}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={needsNote ? 'Say what happened and how you confirmed it.' : ''}
        />
      </label>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- query */

export function QueryDialog({
  change,
  onConfirm,
  onCancel,
}: {
  change: ProposedChange;
  onConfirm: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');

  return (
    <Dialog
      title="Raise a query"
      lede="A query blocks this row without accepting or discarding it. Use it for anything you need the participant, the pharmacy, or the data manager to answer before the visit."
      confirmLabel="Raise query"
      confirmDisabled={text.trim() === ''}
      onConfirm={() => onConfirm(text.trim())}
      onCancel={onCancel}
    >
      <div className="dialog-readback">
        <b>{displayName(change.proposed)}</b>
        <span className="dim">
          Heard: “{change.proposed.reportedText}”
        </span>
      </div>

      <label className="field-row">
        <span>What needs answering</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Ask the participant to bring the bottle to the visit so the product can be identified."
        />
      </label>
    </Dialog>
  );
}

/* ------------------------------------------------------------ deviation */

export function DeviationDialog({
  change,
  onConfirm,
  onCancel,
}: {
  change: ProposedChange;
  onConfirm: (input: DeviationInput) => void;
  onCancel: () => void;
}) {
  const hit = change.prohibitedHit!;
  const [description, setDescription] = useState(
    `Participant reported ${displayName(change.proposed)}` +
      `${change.proposed.dose ? ` ${change.proposed.dose}` : ''}` +
      `${change.proposed.frequency ? `, ${change.proposed.frequency.toLowerCase()}` : ''}` +
      `, which is prohibited under protocol §${hit.protocolSection}` +
      `${hit.className ? ` as a ${hit.className.toLowerCase()}` : ''}.`,
  );
  const [reportableToIrb, setReportable] = useState(true);
  const [notifyPi, setNotifyPi] = useState(true);

  return (
    <Dialog
      title="Log protocol deviation"
      lede="A prohibited medication is a deviation in a safety-based category. Filing it here creates the record the PI signs and the IRB report draws from."
      confirmLabel="Log deviation"
      confirmDisabled={description.trim() === ''}
      onConfirm={() =>
        onConfirm({
          category: 'Prohibited concomitant medication',
          protocolSection: hit.protocolSection,
          ruleId: hit.ruleId,
          description: description.trim(),
          reportableToIrb,
          notifyPi,
        })
      }
      onCancel={onCancel}
    >
      <div className="dialog-readback">
        <b>{displayName(change.proposed)}</b>
        <span className="dim">
          Prohibited concomitant medication · §{hit.protocolSection} · rule{' '}
          <span className="mono">{hit.ruleId}</span>
        </span>
      </div>

      <label className="field-row">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={reportableToIrb}
          onChange={(e) => setReportable(e.target.checked)}
        />
        <span>
          Reportable to the IRB — safety-based criteria that place a participant at greater risk
          normally are.
        </span>
      </label>

      <label className="check-row">
        <input type="checkbox" checked={notifyPi} onChange={(e) => setNotifyPi(e.target.checked)} />
        <span>Notify the principal investigator and the medical monitor.</span>
      </label>
    </Dialog>
  );
}

/* ------------------------------------------------------------ signature */

export function SignOffDialog({
  coordinator,
  count,
  onConfirm,
  onCancel,
}: {
  coordinator: Coordinator;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState('');
  const [attested, setAttested] = useState(false);
  const nameMatches = username.trim().toLowerCase() === coordinator.username;

  return (
    <Dialog
      title="Sign and promote"
      lede="Promoting writes to the medication log. Part 11 requires a signature carrying your printed name, the time, and what the signature means."
      confirmLabel={`Sign and promote ${count}`}
      confirmDisabled={!nameMatches || !attested}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="dialog-attest">{SIGNATURE_MEANING}</p>

      <div className="dialog-readback">
        <span>
          Signing as <b>{coordinator.displayName}</b>
        </span>
        <span className="dim">
          {coordinator.role} · <span className="mono">{coordinator.username}</span>
        </span>
      </div>

      <label className="field-row">
        <span>Re-enter your username to sign</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          aria-invalid={username.trim() !== '' && !nameMatches}
        />
      </label>

      <label className="check-row">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
        <span>
          I have reviewed {count} change{count === 1 ? '' : 's'} against the source and approve entry
          into the log.
        </span>
      </label>
    </Dialog>
  );
}
