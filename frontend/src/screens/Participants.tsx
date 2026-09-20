import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Disposition, DispositionReason, Participant, StudySummary } from '../types/ui';
import { formatDateTime } from '../lib/dates';
import { Dialog } from '../components/Dialog';
import { Disclosure } from '../components/Disclosure';

interface Props {
  studyId: string;
  study: StudySummary | null;
  onToast: (text: string, tone?: 'ok' | 'warn') => void;
}

/** CDISC DS terms. The sponsor counts these, so the wording is not ours. */
const REASONS: DispositionReason[] = [
  'WITHDRAWAL BY SUBJECT',
  'ADVERSE EVENT',
  'LOST TO FOLLOW-UP',
  'PHYSICIAN DECISION',
  'PROTOCOL DEVIATION',
  'DEATH',
  'COMPLETED',
  'SCREEN FAILURE',
  'OTHER',
];

const STATUS_LABEL: Record<Participant['status'], string> = {
  screening: 'In screening',
  enrolled: 'Enrolled',
  discontinued: 'Discontinued',
  screen_failed: 'Screen failure',
  completed: 'Completed',
};

const today = () => new Date().toISOString().slice(0, 10);

export function Participants({ studyId, study, onToast }: Props) {
  const [rows, setRows] = useState<Participant[] | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [leaving, setLeaving] = useState<Participant | null>(null);

  const load = useCallback(() => {
    api.listParticipants(studyId).then(setRows);
  }, [studyId]);
  useEffect(load, [load]);

  if (!rows) return <div className="view view-wide"><p className="skeleton">Loading participants…</p></div>;

  const active = rows.filter((p) => p.status === 'enrolled' || p.status === 'screening');

  return (
    <div className="view view-wide">
      <header className="phead">
        <div>
          <h1>Participants</h1>
          <p className="phead-sub">
            {study?.shortTitle ?? studyId} · {active.length} active of {rows.length}
          </p>
        </div>
        <div className="phead-right">
          <button className="btn btn-primary" onClick={() => setEnrolling(true)}>
            Enroll a participant
          </button>
        </div>
      </header>

      <hr className="rule" />

      {rows.length === 0 ? (
        <div className="empty">
          <h2>No participants yet</h2>
          <p>Enroll the first once their consent is signed.</p>
        </div>
      ) : (
        <div className="sessions">
          <div className="sessions-cols people-cols" aria-hidden="true">
            <span>Subject</span>
            <span>Screening</span>
            <span>Consent</span>
            <span>Status</span>
            <span />
          </div>
          {rows.map((p) => (
            <div className="srow people-row" key={p.subjectId} data-left={p.discontinuation !== null}>
              <div>
                <div className="srow-subject">{p.subjectId}</div>
                {p.enrolledDate && (
                  <div className="dim" style={{ fontSize: 'var(--t-11)' }}>
                    Enrolled {p.enrolledDate.slice(0, 10)}
                  </div>
                )}
              </div>
              <div className="mono dim">{p.screeningNumber ?? '—'}</div>
              <div>
                <div>{p.consentVersion ?? '—'}</div>
                <div className="dim" style={{ fontSize: 'var(--t-11)' }}>
                  {p.consentDate ? p.consentDate.slice(0, 10) : 'not recorded'}
                  {p.icfFilename ? ' · ICF on file' : ''}
                </div>
              </div>
              <div>
                <span className="pill" data-s={p.status === 'enrolled' ? 'completed' : 'not_started'}>
                  {STATUS_LABEL[p.status]}
                </span>
                {p.discontinuation && (
                  <Disclosure label={p.discontinuation.reason}>
                    {p.discontinuation.detail ?? p.discontinuation.reason} · recorded by{' '}
                    {p.discontinuation.recordedBy} on {formatDateTime(p.discontinuation.recordedAt)}.
                    {p.discontinuation.retainCollectedData
                      ? ' Data collected before this date is retained.'
                      : ' Participant did not agree to retention of data already collected.'}
                  </Disclosure>
                )}
              </div>
              <div className="srow-act">
                {p.discontinuation === null && (
                  <button className="btn" onClick={() => setLeaving(p)}>
                    Record exit
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {enrolling && (
        <EnrolDialog
          studyId={studyId}
          onDone={(p) => {
            setEnrolling(false);
            load();
            onToast(`${p.subjectId} enrolled on ${studyId}`);
          }}
          onCancel={() => setEnrolling(false)}
          onError={(m) => onToast(m, 'warn')}
        />
      )}

      {leaving && (
        <ExitDialog
          participant={leaving}
          onDone={(p) => {
            setLeaving(null);
            load();
            onToast(`${p.subjectId} · ${p.discontinuation?.reason} recorded`, 'warn');
          }}
          onCancel={() => setLeaving(null)}
          onError={(m) => onToast(m, 'warn')}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- enroll */

function EnrolDialog({
  studyId,
  onDone,
  onCancel,
  onError,
}: {
  studyId: string;
  onDone: (p: Participant) => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
  const [subjectId, setSubjectId] = useState('');
  const [screeningNumber, setScreeningNumber] = useState('');
  const [consentVersion, setConsentVersion] = useState('');
  const [consentDate, setConsentDate] = useState(today());
  const [icf, setIcf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = subjectId.trim() && screeningNumber.trim() && consentVersion.trim() && consentDate && icf;

  async function submit() {
    setBusy(true);
    try {
      onDone(
        await api.enrollParticipant(studyId, {
          subjectId: subjectId.trim(),
          screeningNumber: screeningNumber.trim(),
          consentVersion: consentVersion.trim(),
          consentDate,
          icfFilename: icf?.name ?? null,
        }),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Enrollment failed.');
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Enroll a participant"
      lede="Consent first, then the screening number, then the subject ID."
      confirmLabel={busy ? 'Enrolling…' : 'Enroll'}
      confirmDisabled={!ready || busy}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <Disclosure label="Why this order">
        Informed consent must be signed before any study procedure, including
        screening. The screening number is assigned at that point; the subject ID
        comes from randomization, once eligibility is confirmed — which is why a
        screen failure never receives one.
      </Disclosure>

      <label className="field-row">
        <span>Signed informed consent form</span>
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.docx"
          onChange={(e) => setIcf(e.target.files?.[0] ?? null)}
        />
        <span className="field-hint">
          {icf ? `${icf.name} attached` : 'Required — the enrollment is not defensible without it.'}
        </span>
      </label>

      <div className="form-grid two">
        <label className="field-row">
          <span>Consent version</span>
          <input value={consentVersion} placeholder="ICF v3.0" onChange={(e) => setConsentVersion(e.target.value)} />
        </label>
        <label className="field-row">
          <span>Date signed</span>
          <input type="date" value={consentDate} max={today()} onChange={(e) => setConsentDate(e.target.value)} />
        </label>
        <label className="field-row">
          <span>Screening number</span>
          <input value={screeningNumber} placeholder="SCR-0043" onChange={(e) => setScreeningNumber(e.target.value)} />
        </label>
        <label className="field-row">
          <span>Subject ID</span>
          <input value={subjectId} placeholder="S-043" onChange={(e) => setSubjectId(e.target.value)} />
          <span className="field-hint">From randomization. Never a name.</span>
        </label>
      </div>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- exit */

function ExitDialog({
  participant,
  onDone,
  onCancel,
  onError,
}: {
  participant: Participant;
  onDone: (p: Participant) => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
  const [reason, setReason] = useState<DispositionReason>('WITHDRAWAL BY SUBJECT');
  const [detail, setDetail] = useState('');
  const [date, setDate] = useState(today());
  const [retain, setRetain] = useState(true);
  const [busy, setBusy] = useState(false);
  const needsDetail = reason === 'OTHER';

  async function submit() {
    setBusy(true);
    try {
      const disposition: Omit<Disposition, 'recordedBy' | 'recordedAt'> = {
        reason,
        detail: detail.trim() || null,
        date,
        retainCollectedData: retain,
      };
      onDone(await api.discontinueParticipant(participant.studyId, participant.subjectId, disposition));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not record the exit.');
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Record exit · ${participant.subjectId}`}
      lede="This records a disposition event. Nothing is deleted."
      confirmLabel={busy ? 'Recording…' : 'Record exit'}
      confirmDisabled={busy || (needsDetail && detail.trim() === '')}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <Disclosure label="What happens to their data">
        The participant stays on the roster and every reconciliation already
        attached to them is kept. Withdrawing consent stops future collection; it
        does not retract data lawfully collected before that date. Deleting the
        record would break the audit trail the study depends on.
      </Disclosure>

      <label className="field-row">
        <span>Reason (CDISC DS term)</span>
        <select value={reason} onChange={(e) => setReason(e.target.value as DispositionReason)}>
          {REASONS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>

      <label className="field-row">
        <span>{needsDetail ? 'Verbatim term (required)' : 'Verbatim term (optional)'}</span>
        <input
          value={detail}
          placeholder="As recorded in the source, e.g. “Subject moved away”"
          onChange={(e) => setDetail(e.target.value)}
        />
        <span className="field-hint">
          Kept as DSTERM alongside the standard term, which is what gets counted.
        </span>
      </label>

      <label className="field-row">
        <span>Date of event</span>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
      </label>

      <label className="check-row">
        <input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} />
        <span>Participant agreed that data already collected may be retained.</span>
      </label>
    </Dialog>
  );
}
