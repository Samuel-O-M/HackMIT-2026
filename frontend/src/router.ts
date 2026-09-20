import { useEffect, useState } from 'react';

/**
 * Hash routing, hand-rolled. Four routes do not justify a dependency, and the
 * hash keeps the demo working from a file:// build if the dev server dies.
 */

export type Route =
  | { name: 'studies' }
  | { name: 'visits'; studyId: string }
  | { name: 'newTrial' }
  | { name: 'documents'; studyId: string }
  | { name: 'participants'; studyId: string }
  | { name: 'review'; sessionId: string }
  | { name: 'live'; sessionId: string }
  | { name: 'audit'; sessionId: string };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const segments = path.split('/').filter(Boolean);

  if (segments[0] === 'new-trial') return { name: 'newTrial' };

  if (segments[0] === 'study' && segments[1]) {
    if (segments[2] === 'documents') return { name: 'documents', studyId: segments[1] };
    if (segments[2] === 'participants') return { name: 'participants', studyId: segments[1] };
    return { name: 'visits', studyId: segments[1] };
  }

  if (segments[0] === 'session' && segments[1]) {
    const sessionId = segments[1];
    if (segments[2] === 'live') return { name: 'live', sessionId };
    if (segments[2] === 'audit') return { name: 'audit', sessionId };
    return { name: 'review', sessionId };
  }
  return { name: 'studies' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'visits':
      return `#/study/${route.studyId}`;
    case 'newTrial':
      return '#/new-trial';
    case 'documents':
      return `#/study/${route.studyId}/documents`;
    case 'participants':
      return `#/study/${route.studyId}/participants`;
    case 'review':
      return `#/session/${route.sessionId}`;
    case 'live':
      return `#/session/${route.sessionId}/live`;
    case 'audit':
      return `#/session/${route.sessionId}/audit`;
    default:
      return '#/';
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
