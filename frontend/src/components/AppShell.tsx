import type { ReactNode } from 'react';
import type { ReconciliationSession } from '../types/contract';
import { hrefFor, type Route } from '../router';
import { usingFixtures } from '../api';
import { SITE_CONTEXT, type Coordinator } from '../auth';
import { THEME_LABEL, useTheme } from '../theme';

interface Props {
  route: Route;
  session: ReconciliationSession | null;
  awaitingReview: number;
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
  disabled,
}: {
  to: Route;
  current: boolean;
  label: string;
  count?: number;
  alarm?: boolean;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="rail-link" aria-disabled="true">
        <span>{label}</span>
      </span>
    );
  }
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

export function AppShell({
  route,
  session,
  awaitingReview,
  coordinator,
  onSignOut,
  children,
}: Props) {
  const { choice, cycle } = useTheme();
  const sessionId = 'sessionId' in route ? route.sessionId : session?.sessionId ?? null;
  const prohibited = session?.changes.filter((c) => c.prohibitedHit !== null).length ?? 0;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <div className="rail-mark">
          <b>Conmed Reconciliation</b>
          <span>
            {SITE_CONTEXT.study} · {SITE_CONTEXT.site}
          </span>
        </div>

        <div className="rail-nav">
          <NavLink
            to={{ name: 'sessions' }}
            current={route.name === 'sessions'}
            label="Visits"
            count={awaitingReview}
          />
          <NavLink
            to={sessionId ? { name: 'review', sessionId } : { name: 'sessions' }}
            current={route.name === 'review'}
            label="Review"
            count={prohibited}
            alarm
            disabled={!sessionId}
          />
          <NavLink
            to={sessionId ? { name: 'live', sessionId } : { name: 'sessions' }}
            current={route.name === 'live'}
            label="Call"
            disabled={!sessionId}
          />
          <NavLink
            to={sessionId ? { name: 'audit', sessionId } : { name: 'sessions' }}
            current={route.name === 'audit'}
            label="Audit"
            disabled={!sessionId}
          />
        </div>

        <div className="rail-foot">
          <div className="rail-who">
            <b>{coordinator.displayName}</b>
            <span>{coordinator.role}</span>
          </div>
          <button className="btn-quiet rail-theme" onClick={cycle}>
            {THEME_LABEL[choice]}
          </button>
          <button className="btn-quiet rail-signout" onClick={onSignOut}>
            Sign out
          </button>
          <span className="rail-env">
            {usingFixtures ? 'Fixture data · no backend' : 'Live backend'}
          </span>
        </div>
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
