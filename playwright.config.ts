// Playwright e2e config. Two ordered projects share one dev server (API :4000 + Vite :5173, started by `npm run dev`,
// which seeds data/ on first run): `screens` captures the 16 rest-state screens first, then `loop` drives the flywheel and
// resets the demo back to the full seed when it is done, so data/ is left fully seeded in its rest state.
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
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'screens', testMatch: /screens\.spec\.ts/ },
    { name: 'loop', testMatch: /loop\.spec\.ts/, dependencies: ['screens'], timeout: 300_000 },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    // First run from a wiped data/: ensure-seed runs the full seed (~15 s) before the API starts; Vite answers earlier.
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
