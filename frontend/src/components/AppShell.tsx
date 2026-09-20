import type { ReactNode } from 'react';
import type { ReconciliationSession } from '../types/contract';
import type { StudySummary } from '../types/ui';
import { hrefFor, type Route } from '../router';
import type { Coordinator } from '../auth';
import { PRODUCT_NAME, SITE_LABEL } from '../brand';
import { THEME_OPTIONS, useTheme } from '../theme';

interface Props {
  route: Route;
  study: StudySummary | null;
  session: ReconciliationSession | null;
  coordinator: Coordinator;
  onSignOut: () => void;
  children: ReactNode;
}

/** Where this participant's reconciliation has got to. The trial is named in
 *  the group above, so repeating it here would say nothing. */
const SESSION_STATE: Record<ReconciliationSession['status'], string> = {
  in_progress: 'Call in progress',
  awaiting_review: 'Awaiting review',
  completed: 'Promoted to log',
  no_contact: 'Needs another call',
};

function NavLink({
  to,
  current,
  label,
  count,
  alarm,
}: {
  to: Route;
  current: boolean;
  label: string;
  count?: number;
  alarm?: boolean;
}) {
  return (
    <a className="rail-link" href={hrefFor(to)} aria-current={current ? 'page' : undefined}>
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rail-count" data-alarm={Boolean(alarm)}>
          {count}
        </span>
      )}
    </a>
  );
}

export function AppShell({ route, study, session, coordinator, onSignOut, children }: Props) {
  const { choice, setChoice } = useTheme();
  const sessionId = 'sessionId' in route ? route.sessionId : session?.sessionId ?? null;
  const studyId = study?.studyId ?? session?.studyId ?? null;
  const prohibited = session?.changes.filter((c) => c.prohibitedHit !== null).length ?? 0;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <div className="rail-mark">
          <b>{PRODUCT_NAME}</b>
          <span>{SITE_LABEL}</span>
        </div>

        <div className="rail-nav rail-nav-top">
          <a
            className="rail-all"
            href={hrefFor({ name: 'studies' })}
            aria-current={route.name === 'studies' ? 'page' : undefined}
          >
            <span className="rail-all-dot" aria-hidden="true" />
            <span>All trials</span>
          </a>
        </div>

        {/* Everything below belongs to one trial: its schedule and its documents. */}
        {studyId && (
          <section className="rail-group" aria-labelledby="rail-trial">
            <h2 className="rail-group-title" id="rail-trial">
              Trial
            </h2>
            <div className="rail-context">
              <b>{studyId}</b>
              {study && <span>{study.investigationalProduct}</span>}
            </div>
            <div className="rail-nav">
              <NavLink
                to={{ name: 'visits', studyId }}
                current={route.name === 'visits'}
                label="Visits"
                count={study?.awaitingReview ?? 0}
              />
              <NavLink
                to={{ name: 'participants', studyId }}
                current={route.name === 'participants'}
                label="Participants"
              />
              <NavLink
                to={{ name: 'documents', studyId }}
                current={route.name === 'documents'}
                label="Documents"
                count={study && !study.hasProtocol ? 1 : 0}
                alarm
              />
            </div>
          </section>
        )}

        {/* One participant inside that trial. Nested, because a session only
            exists within a trial — and the counts here mean different things. */}
        {sessionId && (
          <section className="rail-group" data-nested="true" aria-labelledby="rail-participant">
            <h2 className="rail-group-title" id="rail-participant">
              Participant
            </h2>
            <div className="rail-context">
              <b>{session?.subjectId ?? sessionId}</b>
              {session && <span>{SESSION_STATE[session.status]}</span>}
            </div>
            <div className="rail-nav">
              <NavLink
                to={{ name: 'review', sessionId }}
                current={route.name === 'review'}
                label="Review"
                count={prohibited}
                alarm
              />
              <NavLink
                to={{ name: 'live', sessionId }}
                current={route.name === 'live'}
                label="Transcript"
              />
              <NavLink
                to={{ name: 'audit', sessionId }}
                current={route.name === 'audit'}
                label="History"
              />
            </div>
          </section>
        )}

        <div className="rail-foot">
          <div className="rail-who">
            <b>{coordinator.displayName}</b>
            <span>{coordinator.role}</span>
          </div>
          <fieldset className="seg">
            <legend className="sr-only">Theme</legend>
            {THEME_OPTIONS.map((option) => (
              <label className="seg-opt" key={option.value}>
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={choice === option.value}
                  onChange={() => setChoice(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <button className="btn-quiet rail-signout" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
