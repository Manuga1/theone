// Visits all 16 mockup screens (P1–P8 participant, B1–B8 buyer) plus the 2026-11-10 notes' screens (P5 inbox incl. the
// Needs review tab, P9 Onboarding, P10 Permissions with the vault switch, P8 Earnings with rewards + audit) at 1440×900
// against the FULL seed in its rest state, asserts one key seeded value per screen, asserts no console/page errors, and
// saves e2e/screenshots/<id>.png. A phone pass (390×844) repeats Home, Sources and Signature as <id>-phone.png.
// Runs in the `screens` project before `mobile`/`stage2`/`notes`/`loop` (see playwright.config.ts); global-setup resets
// the demo to the full seed.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { apiGet, settle, trackErrors, usePersona, type Persona } from './helpers';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

type Screen = {
  id: string;
  persona: Persona;
  /** Route, or a resolver that reads the seeded state (first available opportunity, current dataset). */
  path: string | ((page: Page) => Promise<string>);
  /** Assertions on the rendered page. */
  check: (page: Page) => Promise<void>;
};

const text = (page: Page, s: string | RegExp) => page.getByText(s).first();

const SCREENS: Screen[] = [
  {
    id: 'P1', persona: 'participant', path: '/p',
    check: async (page) => {
      await expect(page.locator('.stat').filter({ hasText: 'Data completeness' })).toContainText('74%');
      await expect(page.locator('.stat').filter({ hasText: 'Verified sources' })).toContainText('12');
      await expect(page.locator('.stat').filter({ hasText: 'Lifetime earnings' })).toContainText('$2,842');
      await expect(page.locator('.stat').filter({ hasText: 'Available opportunities' })).toContainText('4');
      await expect(text(page, 'Your Health Signature')).toBeVisible();
      // Notes: quick log box, inbox badge (seeded yerba-mate proposal), 5-day streak, daily check-in with prompts.
      await expect(page.getByLabel('Quick log')).toBeVisible();
      await expect(page.locator('.home-badges')).toContainText('1 to review');
      await expect(page.locator('.home-badges .streak')).toContainText('5');
      await expect(page.locator('.card').filter({ hasText: 'Daily check-in' })).toContainText('quick questions');
      await expect(page.locator('.card').filter({ hasText: 'Daily check-in' }).getByRole('button', { name: 'Submit check-in' })).toBeVisible();
    },
  },
  {
    id: 'P2', persona: 'participant', path: '/p/signature',
    check: async (page) => {
      await expect(text(page, /Genomics/)).toBeVisible();
      await expect(text(page, /Gut microbiome/i)).toBeVisible();
      // Notes: open the Behavior domain — Caffeine carries the seeded espresso sub-branch count and a value-kind glyph.
      await page.locator('.ctree__domain').filter({ hasText: 'Behavior' }).click();
      const caffeine = page.locator('[data-slug="behavior.nutrition.caffeine"]');
      await expect(caffeine.locator('.ctree__meta[title="1 sub-branch"]')).toHaveText(/1/);
      await expect(caffeine.locator('.vk')).toHaveAttribute('aria-label', 'Category');
    },
  },
  {
    id: 'P3', persona: 'participant', path: '/p/node/physiology.cardiovascular.blood_pressure',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText(/Blood pressure/i);
      await expect(text(page, '1,482')).toBeVisible();
    },
  },
  {
    id: 'P4', persona: 'participant', path: '/p/timeline',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Your Health Timeline');
      await expect(text(page, 'Hypertension first documented')).toBeVisible();
    },
  },
  {
    id: 'P5', persona: 'participant', path: '/p/sources',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Grow Your Health Asset');
      await expect(text(page, /Gut microbiome/i)).toBeVisible();
      // Notes: dropzone + ingestion inbox (3 auto-filed, 1 needs review), classifier line, Apple Health import card.
      await expect(page.getByLabel('Upload files')).toBeVisible();
      await expect(page.getByRole('tab', { name: /^All/ })).toContainText('(4)');
      await expect(page.getByRole('tab', { name: /Needs review/ })).toContainText('(1)');
      await expect(page.getByRole('tab', { name: /Auto-filed/ })).toContainText('(3)');
      await expect(page.getByTestId('inbox-row')).toHaveCount(4);
      await expect(page.locator('.card').filter({ hasText: 'Ingestion inbox' })).toContainText(/Classified by rules|Classified by Claude/);
      await expect(page.locator('.source-card').filter({ hasText: 'Apple Health' }).getByRole('button', { name: 'Import export.xml' }).first()).toBeVisible();
    },
  },
  {
    id: 'P5-review', persona: 'participant', path: '/p/sources',
    check: async (page) => {
      await page.getByRole('tab', { name: /Needs review/ }).click();
      const row = page.getByTestId('inbox-row').filter({ hasText: 'had a yerba mate after lunch' });
      await expect(row).toHaveAttribute('data-status', 'needs_review');
      await expect(row).toContainText('Caffeine'); // best guess: the leaf; the proposal adds the "Yerba Mate" sub-branch
      await expect(row).toContainText('83%');
      await row.click();
      const review = page.locator('.review-box');
      await expect(review).toContainText(/sub-branch/);
      await expect(review.getByRole('button', { name: 'Create branch "Yerba Mate"' })).toBeVisible();
      await expect(review.getByRole('button', { name: 'File under…' })).toBeVisible();
      await expect(review.getByRole('button', { name: 'Discard' })).toBeVisible();
    },
  },
  {
    id: 'P6', persona: 'participant', path: '/p/opportunities',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Earn by contributing to research');
      await expect(text(page, 'Metabolic Monitoring Study')).toBeVisible();
      await expect(page.locator('.opp-card')).toHaveCount(4);
      await expect(text(page, '$240')).toBeVisible();
    },
  },
  {
    id: 'P7', persona: 'participant',
    path: async (page) => {
      const opps = await apiGet<{ items: { id: number; tab: string }[] }>(page.request, '/participant/opportunities?tab=available');
      const first = opps.items.find((o) => o.tab === 'available');
      expect(first, 'an available opportunity').toBeTruthy();
      return `/p/opportunities/${first!.id}`;
    },
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Metabolic Monitoring Study');
      await expect(text(page, 'Review & consent')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Review consent' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Accept' })).toBeDisabled();
    },
  },
  {
    id: 'P8', persona: 'participant', path: '/p/earnings',
    check: async (page) => {
      await expect(page.locator('.stat').filter({ hasText: 'Lifetime earnings' })).toContainText('$2,842.17');
      await expect(page.locator('.stat').filter({ hasText: 'Licensed uses' })).toContainText('7');
      await expect(page.locator('table tbody tr').first()).toBeVisible();
      // Notes: logging rewards (3 seeded rules, 5-day streak, $0.00 today) and the tamper-evident audit card.
      const rewards = page.locator('.card').filter({ hasText: 'Logging rewards' });
      await expect(rewards.locator('.table--rewards tbody tr')).toHaveCount(3);
      await expect(rewards).toContainText('5-day streak');
      await expect(page.getByTestId('rewards-today')).toHaveText('$0.00');
      await expect(rewards.locator('.table--rewards tbody tr').filter({ hasText: 'Food log' })).toContainText('Metabolic Monitoring Study');
      const audit = page.locator('.card').filter({ hasText: 'Tamper-evident log' });
      await expect(audit.getByTestId('audit-head')).toBeVisible();
      await expect(audit.getByTestId('audit-verify')).toBeVisible();
      await expect(audit).toContainText('Daily anchors');
    },
  },
  {
    id: 'P9', persona: 'participant', path: '/p/onboarding',
    check: async (page) => {
      // Alex is seeded onboarded: the flow opens on its last step; every step is reachable (Restart is on Profile and here).
      await expect(page.locator('h1')).toContainText('Welcome to your health asset');
      await expect(page.locator('.onboard__steps')).toContainText(/identity/i);
      await expect(page.getByTestId('onboarding-finish')).toContainText('Open my health asset');
      await expect(page.getByRole('button', { name: /Restart/ })).toBeVisible();
    },
  },
  {
    id: 'P10', persona: 'participant', path: '/p/permissions',
    check: async (page) => {
      const sw = page.getByRole('switch', { name: 'Vault only' });
      await expect(sw).toBeVisible();
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('vault-pill')).toContainText('Off');
      await expect(page.locator('.card').filter({ hasText: 'Vault mode' }).first()).toContainText('nothing sold');
    },
  },
  {
    id: 'B1', persona: 'buyer:1', path: '/b',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Welcome back, Example BioPharma');
      await expect(page.locator('.stat').filter({ hasText: 'Available participants' })).toContainText('128,420');
      await expect(page.locator('.stat').filter({ hasText: 'Longitudinal profiles' })).toContainText('112,810');
      await expect(page.locator('.stat').filter({ hasText: 'Genomics available' })).toContainText('48,921');
    },
  },
  {
    id: 'B2', persona: 'buyer:1', path: '/b/cohorts/new',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Cohort Builder');
      await expect(page.locator('.funnel__ready-n')).toContainText('611');
    },
  },
  {
    id: 'B3', persona: 'buyer:1', path: '/b/cohorts/1/funnel',
    check: async (page) => {
      await expect(page.locator('.funnel__ready-label')).toHaveText('READY NOW');
      await expect(page.locator('.funnel__ready-n')).toContainText('611');
      await expect(page.locator('.funnel__stage').first()).toContainText('128,420');
    },
  },
  {
    id: 'B4', persona: 'buyer:1', path: '/b/cohorts/1/missing',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Where are the gaps?');
      await expect(text(page, 'Current complete cohort')).toBeVisible();
      await expect(page.locator('.big-num').first()).toContainText('611');
    },
  },
  {
    id: 'B5', persona: 'buyer:1', path: '/b/cohorts/1/coverage',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Data coverage by variable');
      await expect(text(page, '100%')).toBeVisible();
    },
  },
  {
    id: 'B6', persona: 'buyer:1', path: '/b/cohorts/1/expand',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Expand your cohort');
      const rows = page.locator('.estimate-rows');
      await expect(rows.first()).toContainText('4,850');
      await expect(rows.first()).toContainText('2,920');
      await expect(rows.first()).toContainText('2,560');
    },
  },
  {
    id: 'B7', persona: 'buyer:1', path: '/b/studies/1',
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Metabolic Monitoring Study');
      const counters = page.locator('.counter-list');
      await expect(counters).toContainText('4,850');
      await expect(counters).toContainText('2,378');
    },
  },
  {
    id: 'B8', persona: 'buyer:1',
    path: async (page) => {
      const ds = await apiGet<{ datasets: { id: number; status: string }[] }>(page.request, '/buyer/datasets', 'buyer:1');
      const current = ds.datasets.find((d) => d.status === 'current');
      expect(current, 'a current dataset').toBeTruthy();
      return `/b/datasets/${current!.id}`;
    },
    check: async (page) => {
      await expect(page.locator('h1')).toContainText('Cohort dataset');
      await expect(page.locator('.sub').first()).toContainText('2,841');
      await expect(page.locator('.sub').first()).toContainText('2,378');
    },
  },
];

for (const s of SCREENS) {
  test(`${s.id} ${typeof s.path === 'string' ? s.path : '(resolved)'}`, async ({ page }) => {
    const errs = trackErrors(page);
    await usePersona(page, s.persona);
    const path = typeof s.path === 'string' ? s.path : await s.path(page);
    await page.goto(path);
    await s.check(page);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/${s.id}.png`, fullPage: true });
    errs.assertNoErrors(s.id);
  });
}

// Phone pass (390×844, mobile-first shell from the notes): Home, Sources and Signature render the same seeded values
// with the top bar + bottom nav instead of the sidebar and without horizontal overflow; saved as <id>-phone.png.
test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const id of ['P1', 'P5', 'P2']) {
    const s = SCREENS.find((x) => x.id === id)!;
    test(`${s.id}-phone ${s.path as string}`, async ({ page }) => {
      const errs = trackErrors(page);
      await usePersona(page, s.persona);
      await page.goto(s.path as string);
      await s.check(page);
      await expect(page.locator('.shell__nav')).toBeHidden();
      await expect(page.locator('.shell__bottomnav')).toBeVisible();
      await settle(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${s.id}-phone: horizontal overflow`).toBeLessThanOrEqual(390);
      await page.screenshot({ path: `${SHOTS}/${s.id}-phone.png`, fullPage: true });
      errs.assertNoErrors(`${s.id}-phone`);
    });
  }
});
