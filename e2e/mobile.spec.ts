// Responsive shell at phone width (390×844): the participant app shows the top bar + bottom nav, cards stack without
// horizontal overflow, and the buyer app does not break. Runs against the seeded rest state like screens.spec.ts.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { settle, trackErrors, usePersona, type Persona } from './helpers';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const PAGES: { id: string; persona: Persona; path: string; heading: RegExp }[] = [
  { id: 'M-home', persona: 'participant', path: '/p', heading: /Good (morning|afternoon|evening)/ },
  { id: 'M-sources', persona: 'participant', path: '/p/sources', heading: /Grow Your Health Asset/ },
  { id: 'M-signature', persona: 'participant', path: '/p/signature', heading: /Your Health Signature/ },
  { id: 'M-timeline', persona: 'participant', path: '/p/timeline', heading: /Your Health Timeline/ },
  { id: 'M-node', persona: 'participant', path: '/p/node/physiology.cardiovascular.blood_pressure', heading: /Blood pressure/i },
  { id: 'M-buyer', persona: 'buyer:1', path: '/b', heading: /Welcome back/ },
];

for (const p of PAGES) {
  test(`${p.id} renders at phone width without overflow`, async ({ page }) => {
    await usePersona(page, p.persona);
    const errs = trackErrors(page);
    await page.goto(p.path);
    await settle(page);
    await expect(page.getByText(p.heading).first()).toBeVisible();
    // Mobile shell: sidebar hidden, bottom nav shown; desktop header buttons hidden.
    await expect(page.locator('.shell__nav')).toBeHidden();
    await expect(page.locator('.shell__bottomnav')).toBeVisible();
    await expect(page.locator('.shell__topbar')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${p.id}: horizontal overflow`).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${SHOTS}/${p.id}.png`, fullPage: true });
    errs.assertNoErrors(p.id);
  });
}

test('M-quicklog: the quick-log box previews a branch and the bottom nav navigates', async ({ page }) => {
  await usePersona(page, 'participant');
  await page.goto('/p');
  await settle(page);
  const box = page.getByLabel('Quick log');
  await expect(box).toBeVisible();
  await box.fill('blood pressure 128/82 this morning');
  await expect(page.getByText(/Will be filed under|No obvious branch yet/)).toBeVisible();
  await page.locator('.shell__bottomnav').getByText('Sources').click();
  await expect(page.getByText('Grow Your Health Asset')).toBeVisible();
  await expect(page.getByLabel('Upload files')).toBeVisible();
});
