import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { ReconciliationSession } from './types/contract';
import type { ScheduledVisit, StudySummary } from './types/ui';
import { navigate, useRoute } from './router';
import { useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { Toasts, useToasts } from './components/Toast';
import { StudyPicker } from './screens/StudyPicker';
import { SessionList } from './screens/SessionList';
import { Reconciliation } from './screens/Reconciliation';
import { LiveCall } from './screens/LiveCall';
import { Audit } from './screens/Audit';
import { Documents } from './screens/Documents';
import { NewTrial } from './screens/NewTrial';
import { Participants } from './screens/Participants';
import { SignIn } from './screens/SignIn';

export default function App() {
  const route = useRoute();
  const { coordinator, signIn, signOut } = useAuth();
  const { toasts, push, dismiss } = useToasts();
  const [session, setSession] = useState<ReconciliationSession | null>(null);
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const sessionId = coordinator && 'sessionId' in route ? route.sessionId : null;

  /** The trial in view: named by the route, or inherited from the open session. */
  const studyId = 'studyId' in route ? route.studyId : session?.studyId ?? null;
  const study = studies.find((s) => s.studyId === studyId) ?? null;

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }
    let live = true;
    api.getSession(sessionId).then((next) => {
      if (!live) return;
      if (next) setSession(next);
      else {
        push(`Session ${sessionId} was not found. Showing your trials instead.`, 'warn');
        navigate({ name: 'studies' });
      }
    });
    return () => {
      live = false;
    };
  }, [sessionId, reloadKey, push]);

  useEffect(() => {
    if (!coordinator) return;
    api.listStudies().then(setStudies);
  }, [reloadKey, coordinator]);

  const onSessionChange = useCallback((next: ReconciliationSession) => {
    setSession(next);
    if (next.status === 'completed') setReloadKey((n) => n + 1);
  }, []);

  const onStartCall = useCallback(
    (visit: ScheduledVisit) => {
      push(
        `Placing a call to ${visit.subjectId} needs the telephony backend, which is not wired on this branch.`,
        'warn',
      );
    },
    [push],
  );

  function leave() {
    signOut();
    navigate({ name: 'studies' });
  }

  if (!coordinator) return <SignIn onSubmit={signIn} />;

  return (
    <AppShell
      route={route}
      study={study}
      session={session}
      coordinator={coordinator}
      onSignOut={leave}
    >
      {route.name === 'studies' && <StudyPicker coordinator={coordinator} />}
      {route.name === 'visits' && (
        <SessionList studyId={route.studyId} study={study} onStartCall={onStartCall} reloadKey={reloadKey} />
      )}
      {route.name === 'review' && (
        <Reconciliation
          session={session}
          coordinator={coordinator}
          onSessionChange={onSessionChange}
          onToast={push}
        />
      )}
      {route.name === 'newTrial' && (
        <NewTrial onToast={push} onCreated={() => setReloadKey((n) => n + 1)} />
      )}
      {route.name === 'participants' && (
        <Participants studyId={route.studyId} study={study} onToast={push} />
      )}
      {route.name === 'documents' && (
        <Documents
          studyId={route.studyId}
          study={study}
          onToast={push}
          onChanged={() => setReloadKey((n) => n + 1)}
        />
      )}
      {route.name === 'live' && <LiveCall sessionId={route.sessionId} session={session} />}
      {route.name === 'audit' && (
        <Audit sessionId={route.sessionId} session={session} reloadKey={reloadKey} />
      )}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </AppShell>
  );
}
