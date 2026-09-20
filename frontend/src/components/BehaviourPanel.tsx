import type { BehaviourReport } from '../types/contract';
import { Disclosure } from './Disclosure';
import {
  behaviourLabel,
  behaviourSummary,
  behaviourTone,
  instrumentPhrase,
} from '../lib/callFindings';

interface Props {
  reports: BehaviourReport[];
}

/**
 * The protocol's non-drug rules: alcohol, smoking, contraception, blood
 * donation, sun exposure.
 *
 * These are as reportable as a prohibited drug and were previously nobody's
 * job to ask about. Anything that actually breaches a rule has already been
 * raised in the alert above — this panel is the full record of what was asked,
 * including the questions that came back clean, because "we asked and they
 * said no" is the answer a monitor will want and an empty row cannot give.
 */
export function BehaviourPanel({ reports }: Props) {
  if (reports.length === 0) return null;

  const declined = reports.filter((r) => r.status === 'declined_to_answer').length;

  return (
    <section className="findings" aria-labelledby="behaviour-title">
      <header className="findings-head">
        <h2 id="behaviour-title">Protocol requirements</h2>
        <span className="dim">
          {declined > 0 ? `${declined} declined to answer` : `${reports.length} asked`}
        </span>
      </header>

      <ul className="findings-list">
        {reports.map((report) => {
          const instrument = instrumentPhrase(report);
          return (
            <li
              className="findings-item"
              data-tone={behaviourTone(report)}
              key={report.behaviourCode}
            >
              <div className="findings-main">
                <div className="findings-name">
                  {behaviourLabel(report.behaviourCode)}
                  {report.rule?.ruleType === 'required' && (
                    <span className="findings-tag">Required</span>
                  )}
                </div>
                <div className="findings-meta">
                  {behaviourSummary(report)}
                  {instrument && ` · ${instrument}`}
                  {report.rule?.protocolSection && ` · §${report.rule.protocolSection}`}
                </div>
              </div>

              {(report.reportedText || report.rule) && (
                <Disclosure label="Details">
                  {report.reportedText && <p className="quote">“{report.reportedText}”</p>}
                  {report.rule?.threshold && (
                    <p>
                      <strong>Protocol says:</strong> {report.rule.threshold}
                    </p>
                  )}
                  {report.rule?.rationale && <p>{report.rule.rationale}</p>}
                </Disclosure>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
