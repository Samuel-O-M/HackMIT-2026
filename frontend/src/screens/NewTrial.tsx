import { useState } from 'react';
import { api } from '../api';
import type { NewStudyInput, ProtocolExtraction, Study } from '../types/ui';
import { extractProtocolDetails, hasProtocolExtractor } from '../agents/protocolExtractor';
import { navigate } from '../router';
import { FileDrop } from '../components/FileDrop';
import { Disclosure } from '../components/Disclosure';
import { ExtractedInput } from '../components/ExtractedInput';

interface Props {
  onToast: (text: string, tone?: 'ok' | 'warn') => void;
  onCreated: () => void;
}

const PHASES = ['Phase 1', 'Phase 2', 'Phase 3'] as const;

type Draft = Record<keyof NewStudyInput, string>;

const EMPTY: Draft = {
  studyId: '',
  nctId: '',
  shortTitle: '',
  investigationalProduct: '',
  indication: '',
  phase: '',
  principalInvestigator: '',
};

/**
 * Opening a trial starts with the protocol, not with a form. The agent reads
 * the trial's identity off the document and the coordinator confirms it — the
 * same propose-then-confirm shape as the reconciliation diff, for the same
 * reason: retyping from a 170-page PDF is where transcription errors come from.
 */
export function NewTrial({ onToast, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [extraction, setExtraction] = useState<ProtocolExtraction | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(next: File) {
    if (!/\.(pdf|docx?)$/i.test(next.name)) {
      setError(`${next.name} is not a protocol document. Upload the PDF or Word file.`);
      return;
    }
    setError(null);
    setReading(true);
    setFile(next);
    try {
      const result = await extractProtocolDetails(next);
      setExtraction(result);
      setDraft({
        studyId: result.studyId.value ?? '',
        nctId: result.nctId.value ?? '',
        shortTitle: result.shortTitle.value ?? '',
        investigationalProduct: result.investigationalProduct.value ?? '',
        indication: result.indication.value ?? '',
        phase: result.phase.value ?? '',
        principalInvestigator: result.principalInvestigator.value ?? '',
      });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The protocol could not be read.');
    } finally {
      setReading(false);
    }
  }

  const required: (keyof Draft)[] = ['studyId', 'nctId', 'shortTitle', 'investigationalProduct', 'phase'];
  const missing = required.filter((key) => draft[key].trim() === '');

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const study = (await api.createStudy({
        studyId: draft.studyId.trim(),
        nctId: draft.nctId.trim(),
        shortTitle: draft.shortTitle.trim(),
        investigationalProduct: draft.investigationalProduct.trim(),
        indication: draft.indication.trim(),
        phase: draft.phase as Study['phase'],
        principalInvestigator: draft.principalInvestigator.trim(),
      } satisfies NewStudyInput)) as Study;

      if (file) await api.uploadProtocol(study.studyId, file, extraction);

      onCreated();
      onToast(`${study.studyId} opened at this site · protocol loaded`);
      navigate({ name: 'documents', studyId: study.studyId });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The trial could not be created.');
      setSaving(false);
    }
  }

  return (
    <div className="view view-wide view-narrow">
      <header className="phead">
        <div>
          <h1>Open a trial</h1>
          <p className="phead-sub">
            The trial's details and prohibited list are read from its protocol.
          </p>
        </div>
        <div className="phead-right">
          <button className="btn" onClick={() => navigate({ name: 'studies' })}>
            Cancel
          </button>
        </div>
      </header>

      <hr className="rule" />

      {!extraction ? (
        <FileDrop
          title="Upload the Clinical Study Protocol"
          lede="Drop it here and the details below are filled in for you to check."
          accept=".pdf,.doc,.docx"
          busy={reading}
          busyLabel="Reading the protocol…"
          chooseLabel="Choose the protocol"
          hint="PDF or Word · the full protocol, not an excerpt"
          error={error}
          onFile={read}
        />
      ) : (
        <>
          <section className="extract-banner" data-stub={extraction.source === 'stub'}>
            <b>
              {extraction.source === 'agent'
                ? `Read from ${file?.name}`
                : 'Extraction agent not wired'}
            </b>
            <Disclosure label="What this means">
              {extraction.notes ??
                'Check every field against the document before confirming. Nothing here is written until you do.'}
              {extraction.source === 'stub' && !hasProtocolExtractor() && (
                <p className="extract-seam">
                  Wire it by calling <span className="mono">registerProtocolExtractor()</span> in{' '}
                  <span className="mono">src/agents/protocolExtractor.ts</span>.
                </p>
              )}
            </Disclosure>
          </section>

          <section className="panel form-panel">
            <div className="panel-head">
              <h2>Trial details</h2>
              <span className="dim">{file?.name}</span>
            </div>
            <div className="form-grid">
              <ExtractedInput
                label="Protocol number"
                field={extraction.studyId}
                value={draft.studyId}
                placeholder="e.g. R2810-ONC-1540"
                onChange={(v) => setDraft({ ...draft, studyId: v })}
              />
              <ExtractedInput
                label="ClinicalTrials.gov ID"
                field={extraction.nctId}
                value={draft.nctId}
                placeholder="NCT…"
                onChange={(v) => setDraft({ ...draft, nctId: v })}
              />
              <ExtractedInput
                label="Short title"
                field={extraction.shortTitle}
                value={draft.shortTitle}
                onChange={(v) => setDraft({ ...draft, shortTitle: v })}
              />
              <ExtractedInput
                label="Investigational product"
                field={extraction.investigationalProduct}
                value={draft.investigationalProduct}
                onChange={(v) => setDraft({ ...draft, investigationalProduct: v })}
              />
              <ExtractedInput
                label="Indication"
                field={extraction.indication}
                value={draft.indication}
                onChange={(v) => setDraft({ ...draft, indication: v })}
              />
              <ExtractedInput
                label="Phase"
                field={extraction.phase}
                value={draft.phase}
                options={PHASES}
                onChange={(v) => setDraft({ ...draft, phase: v })}
              />
              <ExtractedInput
                label="Principal investigator at this site"
                field={extraction.principalInvestigator}
                value={draft.principalInvestigator}
                placeholder="Not in the protocol — enter it"
                onChange={(v) => setDraft({ ...draft, principalInvestigator: v })}
              />
            </div>
          </section>

          {extraction.rules.length > 0 && (
            <section className="panel rules">
              <div className="panel-head">
                <h2>Prohibited medication rules</h2>
                <span className="dim">
                  {extraction.rules.length} found
                  {extraction.conmedSection.value ? ` in §${extraction.conmedSection.value}` : ''}
                </span>
              </div>
              <ul>
                {extraction.rules.map((rule) => (
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

          {error && (
            <p className="drop-error" role="alert">
              {error}
            </p>
          )}

          <div className="form-actions">
            <span className="promote-note" data-blocking={missing.length > 0}>
              {missing.length > 0
                ? `${missing.length} required field${missing.length === 1 ? '' : 's'} still empty`
                : 'Ready to open'}
            </span>
            <button
              className="btn btn-primary"
              disabled={missing.length > 0 || saving}
              onClick={create}
            >
              {saving ? 'Opening…' : 'Open this trial'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
