import { useCallback, useEffect, useState } from 'react';

/**
 * Theme choice. Light is the working default — every EDC a coordinator uses is
 * light, and screens get printed into the trial master file. "system" follows
 * the OS; an explicit choice is remembered on this machine.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'conmed.theme';

function read(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Set before first paint so the page never flashes the wrong palette. */
export function initTheme(): void {
  apply(read());
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => read());

  useEffect(() => {
    apply(choice);
    try {
      if (choice === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // A theme that cannot be persisted still applies for this session.
    }
  }, [choice]);

  const cycle = useCallback(() => {
    setChoice((current) => (current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'));
  }, []);

  return { choice, setChoice, cycle };
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'Theme: system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};
