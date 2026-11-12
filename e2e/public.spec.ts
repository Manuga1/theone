// Public site and demo honesty checks: the landing, researcher, join, privacy and protocol pages say what Padma is
// today, never carry a synthetic population number or an earnings figure, and link into the demo only once. The demo
// shows its "simulated data" banner at every width, and admin controls appear only with ?admin.
// Runs with no VITE_* form or contact variables set, so the forms show their "opens soon" state.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { BRAND } from '../shared/brand';
import { settle, trackErrors, usePersona } from './helpers';

const SHOTS = 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

/** Seeded synthetic headline numbers that must never appear on a public or printable page. */
const SYNTHETIC_NUMBERS = ['128,420', '128420', '112,810', '48,921', '121,304', '18,422', '8,912', '4,850', '2,842'];
const SHEETS = ['lifestyle-14', 'sleep-stress-14', 'home-bp-addon'];

async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** Links into the product demo: /p, /p/..., /b, /b/... (not /privacy or /protocols). */
async function demoLinkCount(page: Page): Promise<number> {
  const hrefs = await page.locator('a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
  return hrefs.filter((h) => /^\/(p|b)(\/|\?|#|$)/.test(h)).length;
}

function expectNoSyntheticNumbers(text: string, label: string): void {
  for (const n of SYNTHETIC_NUMBERS) expect(text.includes(n), `${label}: contains synthetic number ${n}`).toBe(false);
  expect(/\b611\b/.test(text), `${label}: contains synthetic number 611`).toBe(false);
}

test.describe('public site', () => {
  test('landing: brand, status line, both paths, banned uses, no demo numbers', async ({ page }) => {
    const errs = trackErrors(page);
    await page.goto('/');
    await settle(page);
    await expect(page.getByTestId('status-line').first()).toHaveText(BRAND.statusLine);
    await expect(page.getByTestId('footer-status')).toHaveText(BRAND.statusLine);
    await expect(page.getByTestId('path-researchers')).toBeVisible();
    await expect(page.getByTestId('path-join')).toBeVisible();
    expect(await page.getByTestId('banned-uses').locator('li').count()).toBeGreaterThanOrEqual(11);
    const text = await bodyText(page);
    expect(text).toContain(BRAND.notAffiliated);
    expectNoSyntheticNumbers(text, 'landing');
    await page.screenshot({ path: `${SHOTS}/S-landing.png`, fullPage: true });
    errs.assertNoErrors('landing');
  });

  test('researchers: three offers, closed pilot form, exactly one link into the demo', async ({ page }) => {
    const errs = trackErrors(page);
    await page.goto('/researchers');
    await settle(page);
    for (const k of ['referral', 'pilot', 'design']) await expect(page.getByTestId(`offer-${k}`)).toBeVisible();
    await expect(page.getByTestId('pilot-form')).toHaveAttribute('data-mode', 'closed');
    await expect(page.getByTestId('pilot-form')).toHaveText('Pilot enquiries open soon.');
    const demoLinks = await demoLinkCount(page);
    expect(demoLinks, 'links into the demo').toBe(1);
    await expect(page.getByTestId('demo-link')).toHaveAttribute('href', '/b');
    const text = await bodyText(page);
    expect(text.includes('$'), 'researchers: no prices').toBe(false);
    expectNoSyntheticNumbers(text, 'researchers');
    errs.assertNoErrors('researchers');
  });

  test('join: closed sign-up form, no money, no link into the demo', async ({ page }) => {
    const errs = trackErrors(page);
    await page.goto('/join');
    await settle(page);
    await expect(page.getByTestId('registry-form')).toHaveAttribute('data-mode', 'closed');
    await expect(page.getByTestId('registry-form')).toHaveText('Sign-ups open soon.');
    expect(await demoLinkCount(page), 'join: links into the demo').toBe(0);
    const text = await bodyText(page);
    expect(text.includes('$'), 'join: contains a dollar sign').toBe(false);
    expectNoSyntheticNumbers(text, 'join');
    await expect(page.locator('a[href="/privacy"]').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/S-join.png`, fullPage: true });
    errs.assertNoErrors('join');
  });

  test('privacy: the registry notice with version, eligibility and no health questions', async ({ page }) => {
    const errs = trackErrors(page);
    await page.goto('/privacy');
    await settle(page);
    const notice = page.getByTestId('registry-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('not yet a company');
    await expect(notice).toContainText('We do not ask for health information');
    await expect(notice).toContainText('Mississippi');
    await expect(page.getByTestId('notice-version')).toContainText('version');
    expectNoSyntheticNumbers(await bodyText(page), 'privacy');
    errs.assertNoErrors('privacy');
  });

  for (const slug of SHEETS) {
    test(`protocol sheet ${slug}: watermark on screen and in print, no population numbers`, async ({ page }) => {
      const errs = trackErrors(page);
      await page.goto(`/protocols/${slug}`);
      await settle(page);
      await expect(page.getByTestId('protocol-sheet')).toBeVisible();
      await expect(page.getByTestId('watermark')).toContainText(BRAND.watermark);
      const text = await bodyText(page);
      expectNoSyntheticNumbers(text, slug);
      expect(text).toContain('Service fee: quoted per study');
      await page.emulateMedia({ media: 'print' });
      await expect(page.getByTestId('watermark')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/S-sheet-${slug}.png`, fullPage: true });
      errs.assertNoErrors(slug);
    });
  }

  test('protocols index links all three sheets', async ({ page }) => {
    await page.goto('/protocols');
    await settle(page);
    for (const slug of SHEETS) await expect(page.getByTestId(`sheet-link-${slug}`)).toBeVisible();
  });
});

test.describe('demo honesty', () => {
  for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
    test(`banner on participant and buyer demo (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [persona, path] of [['participant', '/p'], ['buyer:1', '/b']] as const) {
        await usePersona(page, persona);
        await page.goto(path);
        await settle(page);
        const banner = page.getByTestId('demo-banner');
        await expect(banner, `${path} ${vp.name}`).toBeVisible();
        await expect(banner).toContainText(BRAND.demoBanner);
      }
    });
  }

  test('participant money carries the illustrative label', async ({ page }) => {
    await usePersona(page, 'participant');
    for (const path of ['/p', '/p/earnings', '/p/opportunities']) {
      await page.goto(path);
      await settle(page);
      expect(await page.getByTestId('illustrative').count(), `${path}: illustrative caption`).toBeGreaterThan(0);
    }
  });

  test('admin controls hidden without ?admin and shown with it', async ({ browser }) => {
    const plain = await browser.newContext();
    const page = await plain.newPage();
    await usePersona(page, 'buyer:1');
    await page.goto('/b');
    await settle(page);
    await expect(page.getByRole('button', { name: /Reset demo/ })).toHaveCount(0);
    await expect(page.locator('.shell__nav').getByText('Admin', { exact: true })).toHaveCount(0);
    await expect(page.locator('.shell__nav').getByText('Analytics', { exact: true })).toHaveCount(0);
    await page.goto('/b/admin');
    await settle(page);
    await expect(page).toHaveURL(/\/b$/);
    await page.goto('/b/studies/1');
    await settle(page);
    await expect(page.getByRole('button', { name: /Advance 7 days/ })).toHaveCount(0);
    await plain.close();

    const adminCtx = await browser.newContext();
    const admin = await adminCtx.newPage();
    await usePersona(admin, 'buyer:1');
    await admin.goto('/b?admin=1');
    await settle(admin);
    await expect(admin.getByRole('button', { name: /Reset demo/ }).first()).toBeVisible();
    await expect(admin.locator('.shell__nav').getByText('Admin', { exact: true })).toBeVisible();
    await admin.goto('/b/studies/1');
    await settle(admin);
    await expect(admin.getByRole('button', { name: /Advance 7 days/ })).toBeVisible();
    await adminCtx.close();
  });
});
