import type { SymptomReport } from '../types/contract';
import { Disclosure } from './Disclosure';

interface Props {
  reports: SymptomReport[];
}

/**
 * Symptoms the participant reported, and whether the drug's label lists them.
 *
 * The panel exists because of a gap in the evidence: comparing clinician- to
 * patient-reported adverse events, some symptoms are under-reported by
 * clinicians by more than fiftyfold. Between visits, nobody asks. This is what
 * the call heard when it did.
 *
 * A symptom NOT on the label is the one to look at, so it is the one the
 * screen marks — the opposite of the instinct to highlight the recognised
 * ones. An expected side effect is background; an unexpected one is signal.
 *
 * Nothing here is an adverse-event determination. The coordinator and the
 * investigator make that call; the screen is careful not to look like it
 * already has.
 */
export function SymptomPanel({ reports }: Props) {
  if (reports.length === 0) return null;

  const unlabelled = reports.filter((r) => r.onLabel === false).length;

  return (
    <section className="findings" aria-labelledby="symptom-title">
      <header className="findings-head">
        <h2 id="symptom-title">Symptoms reported</h2>
        <span className="dim">
          {unlabelled > 0
            ? `${unlabelled} not on the product label`
            : `${reports.length} reported`}
        </span>
      </header>

      <ul className="findings-list">
        {reports.map((report, i) => (
          <li
            className="findings-item"
            data-tone={report.onLabel === false ? 'attention' : 'quiet'}
            key={`${report.symptom}-${report.canonicalName ?? ''}-${i}`}
          >
            <div className="findings-main">
              <div className="findings-name">
                {report.symptom}
                {report.onLabel === false && <span className="findings-tag">Not on label</span>}
                {report.isStudyDrug && <span className="findings-tag">Study drug</span>}
              </div>
              <div className="findings-meta">
                {report.canonicalName ?? 'Not attributed to a specific medication'}
                {report.severity && ` · reported as ${report.severity}`}
                {report.since && ` · since ${report.since}`}
                {report.onLabel === null && ' · label not checked'}
              </div>
            </div>

            {(report.reportedText || report.labelSource) && (
              <Disclosure label="Details">
                {report.reportedText && <p className="quote">“{report.reportedText}”</p>}
                {report.labelSource && (
                  <p>
                    <strong>Label checked:</strong> {report.labelSource}
                  </p>
                )}
                <p className="dim">
                  Reported on the call. Not an adverse-event determination — causality and
                  grading are the investigator's to assign.
                </p>
              </Disclosure>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
