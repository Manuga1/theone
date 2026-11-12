// Admin mode for the demo. `?admin` or `?admin=<token>` in the URL switches it on for this browser tab (sessionStorage
// 'hda.admin'); `?admin=off` switches it off. Without it the destructive demo controls (Reset demo, Advance 7 days) and
// the Admin / Analytics screens are hidden. On a hosted deployment the server also wants the token: api.ts sends the
// stored value in the ADMIN_HEADER header when it is a token rather than a bare flag.
import { useSyncExternalStore } from 'react';

export const ADMIN_KEY = 'hda.admin';
/** Stored for a bare `?admin` (or `?admin=1`): shows the controls, sends no token. */
const FLAG = '1';
const FLAG_VALUES = new Set(['', '1', 'true', 'on', 'yes']);
const OFF_VALUES = new Set(['0', 'false', 'off', 'no']);

const listeners = new Set<() => void>();

function read(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY);
  } catch {
    return null;
  }
}
function write(v: string | null): void {
  try {
    if (v === null) sessionStorage.removeItem(ADMIN_KEY);
    else sessionStorage.setItem(ADMIN_KEY, v);
  } catch {
    /* storage unavailable: admin mode simply stays off */
  }
  listeners.forEach((l) => l());
}

/**
 * Read `?admin` from the current URL once, before the first render. A token is kept in sessionStorage and then removed
 * from the address bar (it would otherwise sit in screen shares and browser history); the bare flag stays visible.
 */
export function captureAdminFromUrl(): void {
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return;
  }
  if (!url.searchParams.has('admin')) return;
  const raw = (url.searchParams.get('admin') ?? '').trim();
  const lower = raw.toLowerCase();
  if (OFF_VALUES.has(lower)) {
    write(null);
    return;
  }
  if (FLAG_VALUES.has(lower)) {
    // a bare flag never replaces a token entered earlier in this tab
    if (read() === null) write(FLAG);
    return;
  }
  write(raw);
  url.searchParams.set('admin', FLAG);
  try {
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* ignore */
  }
}

export function isAdmin(): boolean {
  return read() !== null;
}
/** The admin token to send to the API, or null when admin mode is off or was switched on without a token. */
export function adminToken(): string | null {
  const v = read();
  return v !== null && v !== FLAG ? v : null;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Reactive `isAdmin()` for components. */
export function useAdmin(): boolean {
  return useSyncExternalStore(subscribe, isAdmin, () => false);
}
