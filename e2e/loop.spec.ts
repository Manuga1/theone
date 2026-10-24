// Drives the flywheel in the browser against the FULL seed (the default cohort must preview 611, so the small-scale
// reset is not used), following DEMO.md: buyer saves the default cohort → funnel → missing → expand (default modes:
// EHR reuse, exome / BP / food log "Collect if missing") → campaign → proposal → launch → study shows Invited > 0 and
// pre-authorised reuse-only acceptances → requests Gut microbiome → switch persona → the participant (ready-now) holds a
// REUSE-ONLY offer from the launched campaign (no tasks; fee = EHR + the three held variables) → accepts → paid at once
// (license + ledger row) → then the microbiome opportunity → reviews → accepts (new license row) → syncs the task
// (earnings rise by exactly the task's net) → revokes the new license (row stays) → back to buyer → the study's child
// campaign and the newly built dataset reflect it.
//
// Ordering / data: runs in the `loop` project after `screens` (playwright.config.ts). global-setup resets to the full seed
// before everything; afterAll here resets to the full seed again so data/ is left fully seeded in its rest state.
import { test, expect, type Page } from '@playwright/test';
import { resetDemo } from './global-setup';
import { apiGet, parseCount, parseMoneyCents, settle, trackErrors, usePersona } from './helpers';

type Ledger = { lifetimeEarningsCents: number; activeLicenses: number; entries: { kind: string; licenseId: number | null; licenseStatus: string | null; studyName: string; participantCents: number }[] };
type OppList = { items: { id: number; title: string; status: string; tab: string; compCents: number; requirements: string[]; reused: string[]; contributions: { id: number; compCents: number; status: string; name: string }[] }[] };
type OppDetail = { id: number; status: string; title: string; contributions: { id: number; compCents: number; status: string; name: string }[]; consent: { reusedCompCents: number } };

const MICRO_TITLE = 'Gut microbiome collection';
const COHORT_NAME = 'E2E flywheel cohort';
const CAMPAIGN_TITLE = `${COHORT_NAME} — enrichment campaign`; // B6 names the campaign (= the study the participant sees) after the cohort

async function lifetimeTile(page: Page): Promise<number> {
  const tile = page.locator('.stat').filter({ hasText: 'Lifetime earnings' }).locator('.stat__value');
  await expect(tile).toContainText('$');
  return parseMoneyCents((await tile.innerText()));
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  // Leave data/ in the full-seed rest state for the next run / demo.
  await resetDemo();
});

test('flywheel: cohort → campaign → launch → request variable → participant accepts, contributes, revokes → buyer sees it', async ({ page }) => {
  const errs = trackErrors(page);
  await usePersona(page, 'buyer:1');

  let cohortId = 0;
  let studyId = 0;
  let microOppId = 0;
  let reuseOppId = 0;
  let taskNetCents = 0;
  let licenseFeeCents = 0;

  await test.step('B2: default cohort previews 611 and saves', async () => {
    await page.goto('/b/cohorts/new');
    await expect(page.locator('.funnel__ready-n')).toContainText('611');
    await page.getByPlaceholder('e.g. Type 2 diabetes + hypertension').fill(COHORT_NAME);
    await page.getByRole('button', { name: /Save cohort/ }).click();
    await page.waitForURL(/\/b\/cohorts\/(\d+)\/funnel/);
    cohortId = Number(page.url().match(/\/b\/cohorts\/(\d+)\/funnel/)![1]);
    expect(cohortId).toBeGreaterThan(1);
  });

  await test.step('B3 funnel → B4 missing', async () => {
    await expect(page.locator('.funnel__ready-label')).toHaveText('READY NOW');
    await expect(page.locator('.funnel__ready-n')).toContainText('611');
    await page.getByRole('button', { name: /Expand Cohort/ }).click();
    await page.waitForURL(`**/b/cohorts/${cohortId}/missing`);
    await expect(page.locator('h1')).toContainText('Where are the gaps?');
    await expect(page.locator('.big-num').first()).toContainText('611');
    await page.getByRole('button', { name: /Expand Cohort/ }).click();
    await page.waitForURL(`**/b/cohorts/${cohortId}/expand`);
  });

  await test.step('B6 expand: default modes (EHR reuse, the rest "Collect if missing"), create campaign', async () => {
    const estimate = page.locator('.card').filter({ hasText: 'Participants to contact' });
    await expect(estimate.locator('.estimate-rows').first()).toContainText('4,850');
    await expect(estimate).not.toContainText('updating…');
    // The modes stay at their defaults: a mode set to "Collect for all" would re-measure the ready-now members too, so no
    // reuse-only offer could exist (DEMO.md explains the alternative). The pickers are real selects (chevron visible).
    const bpRow = page.locator('tr').filter({ hasText: 'Blood pressure' }).first();
    const modeSelect = bpRow.locator('select');
    await expect(modeSelect).toHaveValue('collect_if_missing');
    await expect(modeSelect).toBeEnabled();
    const ehrSelect = page.locator('tr').filter({ hasText: 'EHR' }).first().locator('select');
    await expect(ehrSelect).toHaveValue('reuse');
    await page.getByRole('button', { name: /Create collection campaign/ }).click();
    await page.waitForURL(/\/b\/cohorts\/\d+\/proposal\?campaign=\d+/);
  });

  await test.step('Proposal → launch → study shows Invited > 0', async () => {
    await expect(page.locator('h1')).toContainText('Proposal');
    await expect(page.locator('tr').filter({ hasText: 'Blood pressure' }).first()).toContainText('Collect if missing');
    await page.getByRole('button', { name: /Launch pilot/ }).click();
    await page.waitForURL(/\/b\/studies\/(\d+)$/);
    studyId = Number(page.url().match(/\/b\/studies\/(\d+)$/)![1]);
    const invited = page.locator('.counter-list > div').filter({ hasText: 'Invited' }).locator('.v');
    await expect(invited).not.toHaveText('0');
    expect(parseCount(await invited.innerText())).toBeGreaterThan(0);
    // ready-now members who pre-authorised reuse-only licenses accepted at launch (license + ledger row each)
    const accepted = page.locator('.counter-list > div').filter({ hasText: /^Accepted/ }).first().locator('.v');
    await expect(accepted).not.toHaveText('0');
    expect(parseCount(await accepted.innerText())).toBeGreaterThan(0);
  });

  await test.step('B7 → request additional variable: Gut microbiome', async () => {
    await page.getByRole('link', { name: /Request additional variable/ }).click();
    await page.waitForURL(`**/b/studies/${studyId}/request-variable`);
    // The header also has a <select> (buyer org); the concept picker is the first select inside the Variable card.
    const concept = page.locator('.card').filter({ hasText: 'Existing concept' }).locator('select').first();
    await expect(concept).not.toHaveValue('');
    const microValue = await concept.locator('option').evaluateAll((opts) => (opts as HTMLOptionElement[]).find((o) => /gut microbiome/i.test(o.textContent ?? ''))?.value ?? '');
    expect(microValue, 'Gut microbiome option').not.toBe('');
    if ((await concept.inputValue()) !== microValue) await concept.selectOption(microValue);
    await expect(page.locator('.card').filter({ hasText: 'Live estimate' })).toContainText(/Gut microbiome/i);
    await expect(page.locator('.card').filter({ hasText: 'Live estimate' })).toContainText('Participants to contact');
    await page.getByRole('button', { name: /Request variable/ }).click();
    await page.waitForURL(new RegExp(`/b/studies/${studyId}$`));
    await expect(page.locator('.list__item').filter({ hasText: MICRO_TITLE })).toBeVisible();
  });

  await test.step('switch persona → P6: the launched campaign made a REUSE-ONLY offer → accept → paid at once', async () => {
    await page.getByRole('button', { name: 'View as participant' }).click();
    await page.waitForURL('**/p');
    await page.getByRole('link', { name: 'Opportunities' }).click();
    await page.waitForURL('**/p/opportunities');
    const opps = await apiGet<OppList>(page.request, '/participant/opportunities?tab=available');
    const reuse = opps.items.find((o) => o.title === CAMPAIGN_TITLE && o.tab === 'available');
    expect(reuse, 'reuse-only opportunity from the launched campaign').toBeTruthy();
    reuseOppId = reuse!.id;
    expect(reuse!.requirements, 'nothing to collect').toEqual([]);
    // the participant holds every variable: EHR (reuse) + exome / BP / food log (collect_if_missing, held → licensed at the reuse fee)
    expect(reuse!.reused).toEqual(expect.arrayContaining(['EHR history', 'Exome', 'Blood Pressure', 'Food log']));
    const detail = await apiGet<OppDetail>(page.request, `/participant/opportunities/${reuseOppId}`);
    expect(detail.consent.reusedCompCents).toBe(reuse!.compCents);
    const card = page.locator('.opp-card').filter({ hasText: CAMPAIGN_TITLE });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Uses your EHR history, Exome, Blood Pressure, Food log');
    await card.getByRole('button', { name: "I'm interested" }).click();
    await page.waitForURL(`**/p/opportunities/${reuseOppId}`);
    const before = await apiGet<Ledger>(page.request, '/participant/ledger');
    await page.getByRole('button', { name: 'Review consent' }).click();
    await expect(page.getByRole('button', { name: 'Terms reviewed' })).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText(/This opportunity is paid/)).toBeVisible();
    const after = await apiGet<Ledger>(page.request, '/participant/ledger');
    expect(after.entries[0]).toMatchObject({ kind: 'license_fee', studyName: CAMPAIGN_TITLE, licenseStatus: 'active', participantCents: reuse!.compCents });
    expect(after.lifetimeEarningsCents).toBe(before.lifetimeEarningsCents + reuse!.compCents);
    expect(after.activeLicenses).toBe(before.activeLicenses + 1);
    const past = await apiGet<OppList>(page.request, '/participant/opportunities?tab=past');
    expect(past.items.find((o) => o.id === reuseOppId)?.status).toBe('paid');
  });

  await test.step('P6 shows the microbiome opportunity', async () => {
    await page.goto('/p/opportunities');
    const card = page.locator('.opp-card').filter({ hasText: MICRO_TITLE });
    await expect(card).toBeVisible();
    const opps = await apiGet<OppList>(page.request, '/participant/opportunities?tab=available');
    const micro = opps.items.find((o) => o.title === MICRO_TITLE && o.tab === 'available');
    expect(micro, 'microbiome opportunity offered to the participant').toBeTruthy();
    microOppId = micro!.id;
    await card.getByRole('button', { name: "I'm interested" }).click();
    await page.waitForURL(`**/p/opportunities/${microOppId}`);
  });

  await test.step('P7: review consent → accept → new license row in earnings', async () => {
    await expect(page.locator('h1')).toContainText(MICRO_TITLE);
    const before = await apiGet<Ledger>(page.request, '/participant/ledger');
    const detail = await apiGet<OppDetail>(page.request, `/participant/opportunities/${microOppId}`);
    licenseFeeCents = detail.consent.reusedCompCents;
    await expect(page.getByRole('button', { name: 'Accept' })).toBeDisabled();
    await page.getByRole('button', { name: 'Review consent' }).click();
    await expect(page.getByRole('button', { name: 'Terms reviewed' })).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.locator('.card').filter({ hasText: 'Your tasks' })).toBeVisible();
    await expect(page.getByText('In progress').first()).toBeVisible();

    await page.getByRole('link', { name: 'Earnings' }).click();
    await page.waitForURL('**/p/earnings');
    const rows = page.locator('.card').filter({ hasText: 'Asset ledger' }).locator('tbody tr');
    await expect(rows).toHaveCount(before.entries.length + 1);
    await expect(rows.first()).toContainText(MICRO_TITLE);
    const after = await apiGet<Ledger>(page.request, '/participant/ledger');
    expect(after.entries[0]).toMatchObject({ kind: 'license_fee', studyName: MICRO_TITLE, licenseStatus: 'active', participantCents: licenseFeeCents });
    expect(after.lifetimeEarningsCents).toBe(before.lifetimeEarningsCents + licenseFeeCents);
    expect(after.activeLicenses).toBe(before.activeLicenses + 1);
    expect(await lifetimeTile(page)).toBe(after.lifetimeEarningsCents);
  });

  await test.step('Sync data on the task → earnings rise by exactly the task net', async () => {
    const earningsBefore = await lifetimeTile(page);
    const detail = await apiGet<OppDetail>(page.request, `/participant/opportunities/${microOppId}`);
    expect(detail.contributions).toHaveLength(1);
    taskNetCents = detail.contributions[0].compCents;
    expect(taskNetCents).toBeGreaterThan(0);

    await page.goto(`/p/opportunities/${microOppId}`);
    const taskRow = page.locator('.card').filter({ hasText: 'Your tasks' }).locator('tbody tr').first();
    await expect(taskRow).toContainText('Pending');
    await taskRow.getByRole('button', { name: /Sync data|Submit/ }).click();
    await expect(taskRow).toContainText('Verified');
    await expect(page.locator('.callout--green')).toContainText('All tasks verified');

    await page.goto('/p/earnings');
    const earningsAfter = await lifetimeTile(page);
    expect(earningsAfter - earningsBefore).toBe(taskNetCents);
    const rows = page.locator('.card').filter({ hasText: 'Asset ledger' }).locator('tbody tr');
    await expect(rows.first()).toContainText(MICRO_TITLE);
    const ledger = await apiGet<Ledger>(page.request, '/participant/ledger');
    expect(ledger.entries[0]).toMatchObject({ kind: 'contribution_payment', studyName: MICRO_TITLE, participantCents: taskNetCents });
  });

  await test.step('Revoke the new license → ledger row stays, marked Revoked', async () => {
    const ledgerBefore = await apiGet<Ledger>(page.request, '/participant/ledger');
    const licenseRow = ledgerBefore.entries.find((e) => e.kind === 'license_fee' && e.studyName === MICRO_TITLE)!;
    expect(licenseRow.licenseStatus).toBe('active');
    const rows = page.locator('.card').filter({ hasText: 'Asset ledger' }).locator('tbody tr');
    const rowCount = await rows.count();
    const row = rows.filter({ hasText: MICRO_TITLE }).filter({ has: page.getByRole('button', { name: 'Revoke' }) }).first();
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('button', { name: 'Revoke license' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke license' }).click();
    await expect(page.getByRole('button', { name: 'Revoke license' })).toBeHidden();
    await expect(rows).toHaveCount(rowCount);
    await expect(rows.filter({ hasText: MICRO_TITLE }).filter({ hasText: 'Revoked' })).toHaveCount(1);
    const ledgerAfter = await apiGet<Ledger>(page.request, '/participant/ledger');
    expect(ledgerAfter.entries).toHaveLength(ledgerBefore.entries.length);
    expect(ledgerAfter.entries.find((e) => e.licenseId === licenseRow.licenseId && e.kind === 'license_fee')!.licenseStatus).toBe('revoked');
    expect(ledgerAfter.lifetimeEarningsCents).toBe(ledgerBefore.lifetimeEarningsCents); // payments already made are kept
    expect(ledgerAfter.activeLicenses).toBe(ledgerBefore.activeLicenses - 1);
  });

  await test.step('switch back to buyer → study and dataset reflect the completion', async () => {
    await page.getByRole('button', { name: 'View as buyer' }).click();
    await page.waitForURL('**/b');
    await page.goto(`/b/studies/${studyId}`);
    await expect(page.locator('h1')).toContainText('E2E flywheel cohort');
    const childRow = page.locator('table').filter({ hasText: 'Campaign' }).locator('tr').filter({ hasText: MICRO_TITLE }).first();
    await expect(childRow).toBeVisible();
    const cells = await childRow.locator('td.num').allInnerTexts(); // Invited · Accepted · Completed · Quality
    expect(cells).toHaveLength(4);
    expect(parseCount(cells[2]), 'child campaign completed').toBeGreaterThan(0);
    expect(parseCount(cells[3]), 'child campaign quality accepted').toBeGreaterThan(0);
    await expect(page.locator('.list__item').filter({ hasText: MICRO_TITLE })).toContainText('active');

    // The completion built the study's first dataset; it carries the Microbiome variable.
    const open = page.getByRole('link', { name: /Open dataset/ });
    await expect(open).toBeVisible();
    await open.click();
    await page.waitForURL(/\/b\/datasets\/\d+$/);
    await expect(page.locator('h1')).toContainText('Cohort dataset');
    await expect(page.locator('tbody tr').filter({ hasText: /Microbiome/i }).first()).toBeVisible();
    await settle(page);
  });

  errs.assertNoErrors('loop');
});
