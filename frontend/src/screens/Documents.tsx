import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type {
  ProtocolDocument,
  StudySummary,
  SupportingDocument,
  SupportingDocumentKind,
} from '../types/ui';
import { formatDateTime } from '../lib/dates';
import { FileDrop } from '../components/FileDrop';
import { Disclosure } from '../components/Disclosure';

interface Props {
  studyId: string;
  study: StudySummary | null;
  onToast: (text: string, tone?: 'ok' | 'warn') => void;
  onChanged: () => void;
}

const SUPPORTING: {
  kind: SupportingDocumentKind;
  title: string;
  why: string;
  accept: string;
  hint: string;
}[] = [
  {
    kind: 'medication_log',
    title: 'Baseline medication log',
    why: 'The concomitant medications already on file for enrolled participants. This is the “in the medication log” side of every diff — without it there is nothing to reconcile against, only a list of what was said on the call.',
    accept: '.csv,.xlsx,.xls,.json',
    hint: 'CSV or Excel export from the EDC · CM domain',
  },
  {
    kind: 'visit_schedule',
    title: 'Visit schedule',
    why: 'Which participants are due and when, so calls can be placed ahead of each visit. Without it the trial opens with an empty visit list.',
    accept: '.csv,.xlsx,.xls,.json',
    hint: 'CSV or Excel export from the CTMS',
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Everything a site needs loaded before it can reconcile medications for a
 * trial. The protocol is the one that gates prohibited screening; the other two
 * decide whether there is anything to reconcile against and anyone to call.
 */
export function Documents({ studyId, study, onToast, onChanged }: Props) {
  const [protocol, setProtocol] = useState<ProtocolDocument | null>(null);
  const [supporting, setSupporting] = useState<SupportingDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return Promise.all([api.getProtocol(studyId), api.listSupportingDocuments(studyId)]);
  }, [studyId]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    load().then(([doc, docs]) => {
      if (!live) return;
      setProtocol(doc);
      setSupporting(docs);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [load]);

  async function uploadProtocol(file: File) {
    if (!/\.(pdf|docx?)$/i.test(file.name)) {
      setError(`${file.name} is not a protocol document. Upload the PDF or Word file.`);
      return;
    }
    setError(null);
    setBusyKind('protocol');
    try {
      const next = await api.uploadProtocol(studyId, file);
      setProtocol(next);
      onToast(`${next.filename} loaded · ${next.rules.length} prohibited rules in force`);
      onChanged();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The upload failed.');
    } finally {
      setBusyKind(null);
    }
  }

  async function uploadSupporting(kind: SupportingDocumentKind, file: File) {
    setError(null);
    setBusyKind(kind);
    try {
      const next = await api.uploadSupportingDocument(studyId, kind, file);
      setSupporting((list) => [...list.filter((d) => d.kind !== kind), next]);
      onToast(`${next.filename} loaded`);
      onChanged();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The upload failed.');
    } finally {
      setBusyKind(null);
    }
  }

  if (loading) {
    return (
      <div className="view view-wide">
        <p className="skeleton">Loading documents…</p>
      </div>
    );
  }

  const loadedCount = (protocol ? 1 : 0) + supporting.length;

  return (
    <div className="view view-wide">
      <header className="phead">
        <div>
          <h1>Documents</h1>
          <p className="phead-sub">
            {study ? study.shortTitle : studyId} · {loadedCount} of 3 loaded
          </p>
        </div>
      </header>

      <hr className="rule" />

      {!protocol && (
        <section className="alarm" aria-labelledby="no-protocol">
          <header className="alarm-head">
            <h2 id="no-protocol">No protocol loaded</h2>
            <span className="dim">Prohibited screening is off for this trial</span>
          </header>
          <div className="alarm-item alarm-simple">
            <Disclosure tone="alarm" label="What this means">
              The agent can still resolve what a participant reports and record it, but it cannot
              tell you whether any of it is prohibited until the protocol is loaded. Every call
              placed for {studyId} until then needs the prohibited check done by hand.
            </Disclosure>
          </div>
        </section>
      )}

      {protocol && (
        <section className="panel doc">
          <div className="panel-head">
            <h2>{protocol.filename}</h2>
            <span className="dim">{protocol.status === 'active' ? 'In force' : protocol.status}</span>
          </div>
          <div className="doc-facts">
            <div className="fact">
              <dt>Protocol number</dt>
              <dd className="mono">{protocol.protocolNumber}</dd>
            </div>
            <div className="fact">
              <dt>Version</dt>
              <dd>{protocol.amendment}</dd>
            </div>
            <div className="fact">
              <dt>Effective</dt>
              <dd>{protocol.effectiveDate}</dd>
            </div>
            <div className="fact">
              <dt>Conmed section</dt>
              <dd className="mono">§{protocol.conmedSection ?? '—'}</dd>
            </div>
            <div className="fact">
              <dt>Size</dt>
              <dd>
                {formatBytes(protocol.sizeBytes)}
                {protocol.pageCount ? ` · ${protocol.pageCount} pp` : ''}
              </dd>
            </div>
            <div className="fact">
              <dt>Loaded by</dt>
              <dd>
                {protocol.uploadedBy} · {formatDateTime(protocol.uploadedAt)}
              </dd>
            </div>
          </div>
          {protocol.sourceUrl && (
            <div className="doc-open">
              <a className="btn" href={protocol.sourceUrl} target="_blank" rel="noreferrer">
                Open the document
              </a>
              <span className="dim">
                §{protocol.conmedSection} is the section these rules come from
              </span>
            </div>
          )}
        </section>
      )}

      {protocol && protocol.rules.length > 0 && (
        <section className="panel rules">
          <div className="panel-head">
            <h2>Prohibited medication rules</h2>
            <span className="dim">
              {protocol.rules.length} in force · read from §{protocol.conmedSection}
            </span>
          </div>
          <ul>
            {protocol.rules.map((rule) => (
              <li className="rule-row" key={rule.ruleId}>
                <div className="rule-id">
                  <span className="mono">{rule.ruleId}</span>
                  <span className="rule-match">
                    {rule.matchedOn === 'class' ? 'By class' : 'By drug'}
                  </span>
                </div>
                <div className="rule-body">
                  <b>{rule.label}</b>
                  {rule.threshold && <span className="rule-threshold">{rule.threshold}</span>}
                  <Disclosure>{rule.rationale}</Disclosure>
                </div>
                <span className="rule-section mono">§{rule.protocolSection}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FileDrop
        title={protocol ? 'Load a new amendment' : 'Load the Clinical Study Protocol'}
        lede={
          protocol
            ? 'Supersedes the version in force and re-reads the prohibited list.'
            : 'The prohibited list is read from its concomitant medications section.'
        }
        accept=".pdf,.doc,.docx"
        busy={busyKind === 'protocol'}
        busyLabel="Reading the protocol…"
        chooseLabel="Choose a file"
        hint="PDF or Word · the full protocol, not an excerpt"
        error={busyKind === null ? error : null}
        onFile={uploadProtocol}
      />

      <h2 className="section-head">Supporting documents</h2>

      {SUPPORTING.map((slot) => {
        const loaded = supporting.find((d) => d.kind === slot.kind) ?? null;
        return (
          <section className="panel doc" key={slot.kind}>
            <div className="panel-head">
              <h2>{slot.title}</h2>
              <span className="dim">{loaded ? 'Loaded' : 'Not loaded'}</span>
            </div>
            <div className="doc-body">
              <Disclosure label="What this is for">{slot.why}</Disclosure>
              {loaded && (
                <div className="doc-loaded">
                  <b>{loaded.filename}</b>
                  <span className="dim">
                    {formatBytes(loaded.sizeBytes)}
                    {loaded.recordCount != null ? ` · ${loaded.recordCount} records` : ''} ·{' '}
                    {loaded.uploadedBy} · {formatDateTime(loaded.uploadedAt)}
                  </span>
                </div>
              )}
            </div>
            <FileDrop
              title=""
              lede=""
              accept={slot.accept}
              busy={busyKind === slot.kind}
              busyLabel="Loading…"
              chooseLabel={loaded ? 'Replace file' : 'Choose a file'}
              hint={slot.hint}
              error={busyKind === null && error ? error : null}
              onFile={(file) => uploadSupporting(slot.kind, file)}
            />
          </section>
        );
      })}
    </div>
  );
}
