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

        {studyId && (
          <div className="rail-study">
            <span className="rail-study-label">Monitoring</span>
            <b>{studyId}</b>
            {study && <span>{study.investigationalProduct}</span>}
          </div>
        )}

        {studyId && (
          <div className="rail-nav">
            <NavLink
              to={{ name: 'visits', studyId }}
              current={route.name === 'visits'}
              label="Visits"
              count={study?.awaitingReview ?? 0}
            />
            <NavLink
              to={{ name: 'documents', studyId }}
              current={route.name === 'documents'}
              label="Documents"
              count={study && !study.hasProtocol ? 1 : 0}
              alarm
            />
          </div>
        )}

        {sessionId && (
          <>
            <div className="rail-study rail-context">
              <span className="rail-study-label">Reviewing</span>
              <b>{session?.subjectId ?? sessionId}</b>
              {session?.endedAt === null && <span>Call in progress</span>}
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
                label="Call"
              />
              <NavLink
                to={{ name: 'audit', sessionId }}
                current={route.name === 'audit'}
                label="Audit"
              />
            </div>
          </>
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
