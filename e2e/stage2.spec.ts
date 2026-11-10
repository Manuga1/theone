// Stage-2 participant flows from the 2026-11-10 notes: vault mode (toggle on Permissions → Home badge, Opportunities
// empty state, toggle back), onboarding (Profile → Restart → identity → consent → mode → done → Home) and the
// tamper-evident audit card (Verify → intact). Routes the API does not serve yet make their test skip, not fail, so the
// spec is safe to run while the backend stage lands. Runs in the `stage2` project after `mobile`; every test restores
// the state it changed.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API, PERSONA_HEADER, settle, trackErrors, usePersona } from './helpers';

const H = { [PERSONA_HEADER]: 'participant' };
async function served(request: APIRequestContext, path: string): Promise<boolean> {
  const res = await request.get(`${API}${path}`, { headers: H });
  return res.status() !== 404;
}
async function setVault(request: APIRequestContext, vaultOnly: boolean): Promise<void> {
  const res = await request.put(`${API}/participant/permissions`, { headers: H, data: { vaultOnly } });
  expect(res.ok(), `PUT permissions vaultOnly=${vaultOnly} → ${res.status()}`).toBeTruthy();
}

test.describe.configure({ mode: 'serial' });

test('S2-vault: the vault-only switch hides opportunities, badges Home, and switches back', async ({ page, request }) => {
  await usePersona(page, 'participant');
  const errs = trackErrors(page);
  await page.goto('/p/permissions');
  await settle(page);
  const sw = page.getByRole('switch', { name: 'Vault only' });
  await expect(sw).toBeVisible();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  try {
    await sw.click();
    await expect(page.locator('.toast--success')).toContainText('Permissions updated');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('vault-pill')).toContainText('On');

    await page.goto('/p/opportunities');
    await settle(page);
    await expect(page.getByTestId('vault-reason')).toBeVisible();
    await expect(page.locator('.opp-card')).toHaveCount(0);

    await page.goto('/p');
    await settle(page);
    await expect(page.getByText('Vault mode', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.stat').filter({ hasText: 'Lifetime earnings' })).toHaveCount(0);
    await expect(page.locator('.stat').filter({ hasText: 'Vault mode' })).toContainText('On');
  } finally {
    await setVault(request, false);
  }
  await page.goto('/p/opportunities');
  await settle(page);
  await expect(page.locator('.opp-card').first()).toBeVisible();
  await expect(page.getByTestId('vault-reason')).toHaveCount(0);
  errs.assertNoErrors('S2-vault');
});

test('S2-onboarding: Restart onboarding gates /p and the four steps lead back to Home', async ({ page, request }) => {
  test.skip(!(await served(request, '/participant/onboarding')), 'GET /participant/onboarding is not served by this API yet');
  await usePersona(page, 'participant');
  const errs = trackErrors(page);
  await page.goto('/p/profile');
  await settle(page);
  await page.getByTestId('restart-onboarding').click();
  await page.waitForURL(/\/p\/onboarding/);
  // Gate: any /p/* screen redirects to the flow while onboarding is incomplete.
  await page.goto('/p/timeline');
  await page.waitForURL(/\/p\/onboarding/);
  await page.getByTestId('onboarding-confirm-identity').click();
  await page.getByTestId('onboarding-consent-next').click();
  await page.getByTestId('mode-earn').click();
  await page.getByTestId('onboarding-mode-next').click();
  await page.getByTestId('onboarding-finish').click();
  await page.waitForURL(/\/p$/);
  await expect(page.getByText(/Good (morning|afternoon|evening)/)).toBeVisible();
  await page.goto('/p/profile');
  await settle(page);
  await expect(page.getByText('completed', { exact: true })).toBeVisible();
  errs.assertNoErrors('S2-onboarding');
});

test('S2-audit: the tamper-evident log verifies intact and lists daily anchors', async ({ page, request }) => {
  test.skip(!(await served(request, '/participant/audit')), 'GET /participant/audit is not served by this API yet');
  await usePersona(page, 'participant');
  const errs = trackErrors(page);
  await page.goto('/p/earnings');
  await settle(page);
  await expect(page.getByTestId('audit-head')).toBeVisible();
  await page.getByTestId('audit-verify').click();
  await expect(page.getByTestId('audit-verify-result')).toContainText(/Chain intact/);
  await expect(page.getByTestId('audit-status')).toContainText('intact');
  await expect(page.getByText('Daily anchors')).toBeVisible();
  errs.assertNoErrors('S2-audit');
});
