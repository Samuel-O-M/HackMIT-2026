import { useCallback, useEffect, useState } from 'react';
import { SITE_LABEL } from './brand';

/**
 * Demo sign-in.
 *
 * The credential check runs in the browser against a constant, so it is a
 * gate, not security — anyone can read the password out of the bundle. It
 * exists so the demo opens on a sign-in screen and so audit entries carry a
 * real coordinator name. When a backend arrives, `signIn` becomes a POST and
 * `restore` becomes a token check; nothing else in the app changes.
 */

export interface Coordinator {
  username: string;
  displayName: string;
  role: string;
  site: string;
}

const DEMO_USERNAME = 'ayushim';
const DEMO_PASSWORD = 'password';

const DEMO_COORDINATOR: Coordinator = {
  username: 'ayushim',
  displayName: 'Ayushi Mehrotra',
  role: 'Clinical research coordinator',
  site: SITE_LABEL,
};

const STORAGE_KEY = 'conmed.coordinator';

/** sessionStorage throws in some embedding contexts; never let that break a render. */
function read(): Coordinator | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Coordinator) : null;
  } catch {
    return null;
  }
}

function write(coordinator: Coordinator | null): void {
  try {
    if (coordinator) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(coordinator));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // A session that cannot be persisted still works until the tab is closed.
  }
}

/** Module-level so non-React code — the api layer — can attribute audit entries. */
let signedIn: Coordinator | null = read();

export function currentCoordinator(): Coordinator | null {
  return signedIn;
}

export type SignInResult = { ok: true; coordinator: Coordinator } | { ok: false; reason: string };

export function attemptSignIn(username: string, password: string): SignInResult {
  const name = username.trim().toLowerCase();
  if (name === '' || password === '') {
    return { ok: false, reason: 'Enter your username and password.' };
  }
  if (name !== DEMO_USERNAME || password !== DEMO_PASSWORD) {
    return { ok: false, reason: 'That username and password combination was not recognized.' };
  }
  signedIn = DEMO_COORDINATOR;
  write(signedIn);
  return { ok: true, coordinator: signedIn };
}

export function signOut(): void {
  signedIn = null;
  write(null);
}

export function useAuth() {
  const [coordinator, setCoordinator] = useState<Coordinator | null>(() => currentCoordinator());

  // Signing out in one tab should not leave another tab holding an open session.
  useEffect(() => {
    const sync = () => setCoordinator(currentCoordinator());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const submit = useCallback((username: string, password: string): SignInResult => {
    const result = attemptSignIn(username, password);
    if (result.ok) setCoordinator(result.coordinator);
    return result;
  }, []);

  const leave = useCallback(() => {
    signOut();
    setCoordinator(null);
  }, []);

  return { coordinator, signIn: submit, signOut: leave };
}

/** Shown only while running on fixtures, so it disappears against a real backend. */
export const DEMO_HINT = `${DEMO_USERNAME} / ${DEMO_PASSWORD}`;
