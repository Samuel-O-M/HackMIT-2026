import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { ReconciliationSession } from './types/contract';
import type { ScheduledVisit, StudySummary } from './types/ui';
import { navigate, useRoute } from './router';
import { useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { Toasts, useToasts } from './components/Toast';
import { StudyPicker } from './screens/StudyPicker';
import { placeCall, VOICE_BASE, waitForCallSession } from './api/telephony';
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

  // Read inside async callbacks (the session loader) without re-running them.
  const routeNameRef = useRef(route.name);
  routeNameRef.current = route.name;

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
      if (next) {
        setSession(next);
        return;
      }
      // A session the fixtures do not know is a call that is happening now. The
      // live transcript reads it straight from the voice server, so there is
      // nothing to load here — and it must not bounce the coordinator away.
      setSession(null);
      if (routeNameRef.current !== 'live') {
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
    async (visit: ScheduledVisit) => {
      push(`Calling ${visit.subjectId}…`);
      try {
        const call = await placeCall(visit.subjectId, coordinator?.username);
        if (call.status === 'failed') {
          // The reason is the useful part: no handset listening, or a number
          // outside the range the guard will dial.
          push(call.reason ?? `Could not reach ${visit.subjectId}.`, 'warn');
          return;
        }
        push(`Ringing ${visit.subjectId} on ${call.to ?? 'the number on file'}.`);
        // Open the transcript the moment the handset answers — the session id
        // does not exist before then, so there is nothing to show until it does.
        waitForCallSession(call.callId).then((liveSessionId) => {
          if (liveSessionId) navigate({ name: 'live', sessionId: liveSessionId });
          else push(`No answer from ${visit.subjectId}.`, 'warn');
        });
      } catch (err) {
        push(
          err instanceof Error
            ? `${err.message} Is the voice server running on ${VOICE_BASE}?`
            : 'Could not reach the voice server.',
          'warn',
        );
      }
    },
    [push, coordinator],
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
