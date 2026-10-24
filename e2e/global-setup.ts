// Runs once after the webServer is up: waits for the API behind the Vite proxy to report ready + seeded (the first run
// from a wiped data/ seeds before the API listens), then resets the demo to the FULL seed so both specs start from the
// rest state regardless of what an earlier (possibly aborted) loop run left behind. Set E2E_SKIP_RESET=1 to skip the reset.
import { request, type FullConfig } from '@playwright/test';

export const API = 'http://localhost:5173/api';

export async function waitForApi(timeoutMs = 240_000): Promise<void> {
  const ctx = await request.newContext();
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      try {
        const res = await ctx.get(`${API}/health`, { timeout: 5_000 });
        if (res.ok()) {
          const h = (await res.json()) as { ready: boolean; seeded: boolean };
          if (h.ready && h.seeded) return;
        }
      } catch {
        /* API not listening yet */
      }
      if (Date.now() > deadline) throw new Error('API did not become ready + seeded in time');
      await new Promise((r) => setTimeout(r, 1_000));
    }
  } finally {
    await ctx.dispose();
  }
}

/** POST /api/demo/reset (full scale) — rebuilds data/ in-process in ~15 s and leaves the server running. */
export async function resetDemo(): Promise<void> {
  const ctx = await request.newContext();
  try {
    const res = await ctx.post(`${API}/demo/reset`, { data: {}, timeout: 180_000 });
    if (!res.ok()) throw new Error(`demo reset failed: ${res.status()} ${await res.text()}`);
    const body = (await res.json()) as { seeded: boolean; participants: number; ms: number };
    if (!body.seeded) throw new Error('demo reset produced an unseeded database');
    console.log(`[e2e] demo reset: ${body.participants.toLocaleString('en-US')} participants in ${body.ms} ms`);
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  await waitForApi();
  if (process.env.E2E_SKIP_RESET !== '1') await resetDemo();
}
