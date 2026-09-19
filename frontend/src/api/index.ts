import { mockTransport } from './mockTransport';
import { makeHttpTransport } from './httpTransport';
import type { Transport } from './transport';

/**
 * The single swap point.
 *
 * With no VITE_API_BASE set the app runs entirely on fixtures, which is what
 * the demo needs on conference wifi. Set VITE_API_BASE and every screen talks
 * to the real backend with no component changes.
 */
const base = import.meta.env.VITE_API_BASE as string | undefined;

export const api: Transport = base ? makeHttpTransport(base) : mockTransport;

export const usingFixtures = !base;

export type { CallEvent, Transport, Unsubscribe } from './transport';
