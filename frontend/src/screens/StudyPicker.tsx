import { useEffect, useState } from 'react';
import { api } from '../api';
import type { StudySummary } from '../types/ui';
import type { Coordinator } from '../auth';
import { navigate } from '../router';

interface Props {
  coordinator: Coordinator;
}

/**
 * The first screen after sign-in. A coordinator runs several trials at once and
 * works one at a time — and a prohibited-medication rule only means something
 * relative to one protocol, so the study is chosen before anything is reviewed.
 */
export function StudyPicker({ coordinator }: Props) {
  const [studies, setStudies] = useState<StudySummary[] | null>(null);

  useEffect(() => {
    let live = true;
    api.listStudies().then((rows) => {
      if (live) setStudies(rows);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!studies) {
    return (
      <div className="view view-wide">
        <p className="skeleton">Loading trials…</p>
      </div>
    );
  }

  const ordered = [...studies].sort(
    (a, b) => b.awaitingReview - a.awaitingReview || b.visitsToday - a.visitsToday,
  );
  const totalAwaiting = studies.reduce((n, s) => n + s.awaitingReview, 0);

  return (
    <div className="view view-wide">
      <header className="phead">
        <div>
          <h1>Good morning, {coordinator.displayName.split(' ')[0]}</h1>
          <p className="phead-sub">
            {studies.length} trial{studies.length === 1 ? '' : 's'} at {coordinator.site}
            {totalAwaiting > 0
              ? ` · ${totalAwaiting} reconciliation${totalAwaiting === 1 ? '' : 's'} awaiting review`
              : ' · nothing awaiting review'}
          </p>
        </div>
        <div className="phead-right">
          <button className="btn btn-primary" onClick={() => navigate({ name: 'newTrial' })}>
            Open a trial
          </button>
        </div>
      </header>

      <hr className="rule" />

      <ul className="studies">
        {ordered.map((study) => {
          const needsAttention = study.awaitingReview > 0 || study.prohibitedFindings > 0;
          return (
            <li key={study.studyId}>
              <button
                className="study"
                data-attention={needsAttention}
                onClick={() => navigate({ name: 'visits', studyId: study.studyId })}
              >
                <div className="study-id">
                  <b>{study.studyId}</b>
                  <span className="mono">{study.nctId}</span>
                  <span className="study-phase">{study.phase}</span>
                </div>

                <div className="study-main">
                  <h2>{study.shortTitle}</h2>
                  <p className="study-sub">
                    {study.investigationalProduct} · {study.indication}
                  </p>
                  <p className="study-pi">
                    {study.principalInvestigator} · {study.enrolledAtSite} enrolled at this site
                  </p>
                </div>

                <div className="study-rules">
                  <span className="study-rules-label">
                    {study.hasProtocol
                      ? `Prohibited · ${study.protocolRuleCount} rules`
                      : 'Prohibited'}
                  </span>
                  {study.hasProtocol ? (
                    <ul>
                      {study.prohibitedHighlights.map((rule) => (
                        <li key={rule}>{rule}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="study-noprotocol">
                      No protocol loaded — screening off until the document is uploaded
                    </p>
                  )}
                </div>

                <div className="study-counts">
                  {study.awaitingReview > 0 && (
                    <span className="count" data-tone="attention">
                      <b>{study.awaitingReview}</b> awaiting review
                    </span>
                  )}
                  {study.prohibitedFindings > 0 && (
                    <span className="count" data-tone="alarm">
                      <b>{study.prohibitedFindings}</b> prohibited
                    </span>
                  )}
                  {study.callsInProgress > 0 && (
                    <span className="count" data-tone="live">
                      <b>{study.callsInProgress}</b> call in progress
                    </span>
                  )}
                  <span className="count">
                    <b>{study.visitsToday}</b> visit{study.visitsToday === 1 ? '' : 's'} today
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
