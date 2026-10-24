// Shared e2e helpers: persona bootstrap, console-error capture, API reads through the Vite proxy, money parsing.
import { expect, type Page, type APIRequestContext } from '@playwright/test';

export const API = 'http://localhost:5173/api';
export const PERSONA_KEY = 'hda.persona';
export const PERSONA_HEADER = 'x-demo-persona';

export type Persona = 'participant' | `buyer:${number}`;

/** Store the persona before any script runs so the first render already uses it (client/src/api.ts reads localStorage). */
export async function usePersona(page: Page, persona: Persona): Promise<void> {
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, [PERSONA_KEY, persona] as const);
}

/** Collects console errors and uncaught page errors; call `assertNoErrors()` at the end of a screen. */
export function trackErrors(page: Page): { errors: string[]; assertNoErrors: (label: string) => void } {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`); });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  return {
    errors,
    assertNoErrors: (label: string) => expect(errors, `${label}: console/page errors`).toEqual([]),
  };
}

export async function apiGet<T>(request: APIRequestContext, path: string, persona: Persona = 'participant'): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: { [PERSONA_HEADER]: persona } });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** "$2,842.17" → 284217; "$90" → 9000. */
export function parseMoneyCents(text: string): number {
  const m = text.replace(/,/g, '').match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!m) throw new Error(`no money in "${text}"`);
  return Math.round(Number(m[1]) * 100);
}

/** "4,850" → 4850; "<20" → 19 (k-floored small count). */
export function parseCount(text: string): number {
  const t = text.trim();
  if (t.startsWith('<')) return Number(t.slice(1).replace(/,/g, '')) - 1;
  const m = t.replace(/,/g, '').match(/\d+/);
  if (!m) throw new Error(`no count in "${text}"`);
  return Number(m[0]);
}

/** Wait until no API request has been in flight for a moment (pages fetch on mount and after `changed` signals). */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}
