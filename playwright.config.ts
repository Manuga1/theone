// Playwright e2e config. Five ordered projects share one dev server (API :4000 + Vite :5173, started by `npm run dev`,
// which seeds data/ on first run): `screens` captures the rest-state screens first (desktop + a phone pass), `mobile`
// (phone-width shell checks), `stage2` (vault mode, onboarding, audit verify), `notes` (quick log → sub-branch, uploads
// + reward, review → new branch, Apple Health import), then `loop` drives the flywheel and resets the demo back to the
// full seed when it is done, so data/ is left fully seeded in its rest state.
import { defineConfig } from '@playwright/test';

// Chromium 1243 is preinstalled here; never run `playwright install`.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'screens', testMatch: /screens\.spec\.ts/ },
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, dependencies: ['screens'] },
    { name: 'stage2', testMatch: /stage2\.spec\.ts/, dependencies: ['mobile'] },
    { name: 'notes', testMatch: /notes\.spec\.ts/, dependencies: ['stage2'] },
    { name: 'loop', testMatch: /loop\.spec\.ts/, dependencies: ['notes'], timeout: 300_000 },
    // Public site and demo honesty checks; read-only, so it runs after the loop has reset the demo to rest state.
    { name: 'public', testMatch: /public\.spec\.ts/, dependencies: ['loop'] },
  ],
  webServer: {
    command: 'npm run dev',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    reuseExistingServer: true,
    // First run from a wiped data/: ensure-seed runs the full seed (~15 s) before the API starts; Vite answers earlier.
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
