import type { AdherenceReport } from '../types/contract';
import { Disclosure } from './Disclosure';
import { adherenceTone, extentLabel, missedPhrase, reasonLabel } from '../lib/callFindings';

interface Props {
  reports: AdherenceReport[];
}

/**
 * What the participant said about actually taking their medication.
 *
 * The diff above answers "what is on the list". This answers "is any of it
 * being swallowed", which the list cannot show and the study cannot do
 * without: an efficacy signal read against doses that were never taken is not
 * a signal.
 *
 * Deliberately quiet. A coordinator acts on this at the visit, not now, and
 * nothing here should compete with the prohibited-medication alert.
 */
export function AdherencePanel({ reports }: Props) {
  if (reports.length === 0) return null;

  // The study drug first, then anything needing attention, then the rest.
  const ordered = [...reports].sort((a, b) => {
    if (a.isStudyDrug !== b.isStudyDrug) return a.isStudyDrug ? -1 : 1;
    const rank = { attention: 0, note: 1, quiet: 2 } as const;
    return rank[adherenceTone(a)] - rank[adherenceTone(b)];
  });
  const needingAttention = reports.filter((r) => adherenceTone(r) === 'attention').length;

  return (
    <section className="findings" aria-labelledby="adherence-title">
      <header className="findings-head">
        <h2 id="adherence-title">Adherence</h2>
        <span className="dim">
          {needingAttention > 0
            ? `${needingAttention} to discuss`
            : `${reports.length} confirmed`}
        </span>
      </header>

      <ul className="findings-list">
        {ordered.map((report, i) => {
          const missed = missedPhrase(report);
          return (
            <li
              className="findings-item"
              data-tone={adherenceTone(report)}
              key={`${report.canonicalName ?? 'unnamed'}-${i}`}
            >
              <div className="findings-main">
                <div className="findings-name">
                  {report.canonicalName ?? 'Unnamed medication'}
                  {report.isStudyDrug && <span className="findings-tag">Study drug</span>}
                </div>
                <div className="findings-meta">
                  {extentLabel(report.extent)}
                  {missed && ` · missed ${missed}`}
                  {report.reasons.length > 0 &&
                    ` · ${report.reasons.map(reasonLabel).join(', ')}`}
                </div>
              </div>
              {report.reportedText && (
                <Disclosure label="What they said">
                  <p className="quote">“{report.reportedText}”</p>
                </Disclosure>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
