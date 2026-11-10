// Participant logging flows from the 2026-11-10 founder notes, driven in the browser against the FULL seed (DEMO.md
// Part 3): quick log "I smoked a cigarette" → follow-up "What brand?" → "Marlboro" → filed under a NEW sub-branch the tree
// and the node show; a second Marlboro files on it without asking; metadata upload of knee_mri.dcm + lunch.jpg → MRI
// auto-filed under imaging, meal photo auto-filed with a $1 reward row (campaign-funded) on Earnings; a text the rules
// cannot place → Needs review → New branch… (group parent) → the leaf exists and carries "new"; the Apple Health
// export.xml import. Runs in the `notes` project after `stage2` and before `loop` (which resets the demo at its end).
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiGet, settle, trackErrors, usePersona } from './helpers';

type Ledger = { lifetimeEarningsCents: number; rewardsToday?: number; entries: { id: number; kind: string; title: string; participantCents: number }[]; groups?: { date: string; count: number; cents: number; entryIds: number[] }[] };
type Queue = { counts: Record<string, number>; items: { id: number; status: string; text: string | null; filename: string | null; conceptSlug: string | null; rewardCents: number }[] };
type Node = { slug: string; name: string; variants?: { slug: string; name: string; nObs: number; isNew: boolean }[]; classified?: { n: number; classifier: string } | null };

const successToast = (page: Page) => page.locator('.toast--success').last();

test.describe.configure({ mode: 'serial' });

test('N1 quick log: "I smoked a cigarette" → "What brand?" → Marlboro → a new sub-branch the tree and the node show', async ({ page }) => {
  await usePersona(page, 'participant');
  const errs = trackErrors(page);
  await page.goto('/p');
  await settle(page);
  const box = page.getByLabel('Quick log');
  await box.fill('I smoked a cigarette');
  await expect(page.getByText(/Will be filed under/)).toBeVisible();
  await box.press('Enter');
  // The categorical leaf clears the threshold but its follow-up attribute (brand) is missing → the server asks.
  const followUp = page.getByRole('group', { name: 'Follow-up question' });
  await expect(followUp).toContainText('What brand?');
  await expect(followUp).toContainText('creates its own sub-branch');
  await followUp.getByLabel('What brand?').fill('Marlboro');
  await followUp.getByRole('button', { name: 'Answer' }).click();
  await expect(successToast(page)).toContainText('Filed under Behavior › Tobacco › Cigarettes › marlboro (new branch)');
  await expect(followUp).toBeHidden();

  // The second cigarette of that brand files on the existing sub-branch without a question.
  await box.fill('another marlboro after dinner');
  await box.press('Enter');
  await expect(successToast(page)).toContainText('Filed under Behavior › Tobacco › Cigarettes › marlboro');
  await expect(successToast(page)).not.toContainText('(new branch)');

  const node = await apiGet<Node>(page.request, '/participant/nodes/behavior.tobacco.cigarettes');
  expect(node.variants?.map((v) => [v.slug, v.nObs, v.isNew])).toEqual([['behavior.tobacco.cigarettes.brand.marlboro', 2, true]]);

  // Signature tree: the Cigarettes leaf carries the sub-branch count; the node shows the breakdown with the "new" badge.
  await page.goto('/p/signature/behavior');
  await settle(page);
  const leaf = page.locator('[data-slug="behavior.tobacco.cigarettes"]');
  await expect(leaf).toBeVisible();
  await expect(leaf).toContainText('Cigarettes');
  await expect(leaf.locator('.ctree__meta[title="1 sub-branch"]')).toHaveText(/1/);
  await expect(leaf).toContainText('just now');
  await leaf.click();
  await page.waitForURL(/\/p\/node\/behavior\.tobacco\.cigarettes$/);
  await expect(page.locator('h1')).toContainText('Cigarettes');
  const variant = page.locator('.variant').filter({ hasText: 'marlboro' });
  await expect(variant).toBeVisible();
  await expect(variant.locator('.pill--new')).toHaveText('new');
  await expect(page.getByText(/classified by rules/)).toBeVisible();
  await settle(page);
  errs.assertNoErrors('N1');
});

test('N2 upload: knee_mri.dcm + lunch.jpg → MRI auto-filed under imaging, meal photo auto-filed with a $1 reward row on Earnings', async ({ page }) => {
  await usePersona(page, 'participant');
  const errs = trackErrors(page);
  const before = await apiGet<Ledger>(page.request, '/participant/ledger');
  await page.goto('/p/sources');
  await settle(page);
  await expect(page.getByText('Ingestion inbox')).toBeVisible();
  // Only metadata leaves the browser (name, size, type, sha256, a text sample); the bytes are synthetic placeholders.
  await page.getByTestId('upload-input').setInputFiles([
    { name: 'knee_mri.dcm', mimeType: 'application/dicom', buffer: Buffer.alloc(64 * 1024, 7) },
    { name: 'lunch.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(48 * 1024, 255) },
  ]);
  await expect(successToast(page)).toContainText('2 files received: 2 filed automatically · +$1.00 reward');
  const mriRow = page.getByTestId('inbox-row').filter({ hasText: 'knee_mri.dcm' });
  await expect(mriRow).toHaveAttribute('data-status', 'auto_filed');
  await expect(mriRow).toContainText('MRI (musculoskeletal)');
  const lunchRow = page.getByTestId('inbox-row').filter({ hasText: 'lunch.jpg' });
  await expect(lunchRow).toHaveAttribute('data-status', 'auto_filed');
  await expect(lunchRow).toContainText('Food log');
  await expect(lunchRow).toContainText('$1.00');
  await page.getByRole('tab', { name: /Auto-filed/ }).click();
  await expect(page.getByTestId('inbox-row').filter({ hasText: 'lunch.jpg' })).toBeVisible();
  await expect(page.getByTestId('inbox-row').filter({ hasText: 'knee_mri.dcm' })).toBeVisible();

  const queue = await apiGet<Queue>(page.request, '/participant/ingest');
  expect(queue.items.find((i) => i.filename === 'knee_mri.dcm')).toMatchObject({ status: 'auto_filed', conceptSlug: 'imaging.mri.mri_musculoskeletal', rewardCents: 0 });
  expect(queue.items.find((i) => i.filename === 'lunch.jpg')).toMatchObject({ status: 'auto_filed', conceptSlug: 'behavior.nutrition.food_log', rewardCents: 100 });

  // Earnings: the reward is a ledger row (90/10 through postLedger) that names the funding campaign.
  const after = await apiGet<Ledger>(page.request, '/participant/ledger');
  expect(after.lifetimeEarningsCents).toBe(before.lifetimeEarningsCents + 100);
  expect(after.entries).toHaveLength(before.entries.length + 1);
  const reward = after.entries.find((e) => !before.entries.some((b) => b.id === e.id))!;
  expect(reward).toMatchObject({ kind: 'contribution_payment', title: 'Logging reward: Food log (per food photo)', participantCents: 100 });
  await page.goto('/p/earnings');
  await settle(page);
  await expect(page.locator('.stat').filter({ hasText: 'Lifetime earnings' })).toContainText(`$${(after.lifetimeEarningsCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  await expect(page.locator('.stat').filter({ hasText: 'Licensed uses' })).toContainText('+$1.00 logging today');
  await expect(page.getByTestId('rewards-today')).toHaveText('$1.00');
  const foodRule = page.locator('.table--rewards tbody tr').filter({ hasText: 'Food log' });
  await expect(foodRule).toContainText('per food photo');
  await expect(foodRule).toContainText('Metabolic Monitoring Study');
  await expect(foodRule).toContainText('1 · $1.00');
  const day = page.getByTestId('ledger-day');
  await expect(day).toHaveCount(1);
  await expect(day).toContainText('Logging rewards · 1 item');
  await expect(day).toContainText('$1.00');
  await day.click();
  const micro = page.locator('tr.ledger-micro');
  await expect(micro).toHaveCount(1);
  await expect(micro).toContainText('Logging reward: Food log (per food photo)');
  await expect(micro).toContainText('Metabolic Monitoring Study');
  await settle(page);
  errs.assertNoErrors('N2');
});

test('N3 review: a text the rules cannot place waits in Needs review → New branch… under a group → the new leaf shows "new"', async ({ page }) => {
  await usePersona(page, 'participant');
  const errs = trackErrors(page);
  await page.goto('/p');
  await settle(page);
  const box = page.getByLabel('Quick log');
  await box.fill('temperature 38.5 C');
  await box.press('Enter');
  await expect(page.locator('.toast--info').last()).toContainText('Sent to your inbox for review');
  // Home badge counts it (the seeded yerba-mate proposal + this one).
  await expect(page.locator('.home-badges')).toContainText('2 to review');

  await page.goto('/p/sources');
  await settle(page);
  await page.getByRole('tab', { name: /Needs review/ }).click();
  await expect(page.getByRole('tab', { name: /Needs review/ })).toContainText('(2)');
  const row = page.getByTestId('inbox-row').filter({ hasText: 'temperature 38.5 C' });
  await expect(row).toHaveAttribute('data-status', 'needs_review');
  await row.click();
  const review = page.locator('.review-box');
  await expect(review).toContainText('No branch matched');
  await review.getByRole('button', { name: 'New branch…' }).click();
  const form = page.getByTestId('new-branch-form');
  await form.getByLabel('New branch name').fill('Body temperature');
  await form.getByLabel('Value kind').selectOption('continuous');
  await form.getByLabel('Unit').fill('°C');
  await form.getByLabel('Search branches').fill('Vitals');
  const group = form.locator('[role="option"][data-slug="clinical.vitals"]');
  await expect(group).toContainText('group');
  await group.click();
  await expect(form).toContainText('creates a new variable in this group');
  await form.getByRole('button', { name: 'Create branch' }).click();
  await expect(successToast(page)).toContainText('temperature 38.5 C: new branch Clinical › Vitals & preventive › Body temperature');
  await page.getByRole('tab', { name: /Accepted/ }).click();
  const accepted = page.getByTestId('inbox-row').filter({ hasText: 'temperature 38.5 C' });
  await expect(accepted).toHaveAttribute('data-status', 'accepted');
  await expect(accepted).toContainText('Body temperature');

  const queue = await apiGet<Queue>(page.request, '/participant/ingest');
  expect(queue.items.find((i) => i.text === 'temperature 38.5 C')).toMatchObject({ status: 'accepted', conceptSlug: 'clinical.vitals.body_temperature' });
  expect(queue.counts.needs_review).toBe(1); // the seeded yerba-mate proposal still waits

  // The tree carries the leaf, created in the last 30 days; logging to it now files without review.
  await page.goto('/p/signature/clinical');
  await settle(page);
  const leaf = page.locator('[data-slug="clinical.vitals.body_temperature"]');
  await expect(leaf).toContainText('Body temperature');
  await expect(leaf.locator('.pill--new')).toHaveText('new');
  await page.goto('/p');
  await settle(page);
  await page.getByLabel('Quick log').fill('body temperature 37.2 °C');
  await page.getByLabel('Quick log').press('Enter');
  await expect(successToast(page)).toContainText('Filed under Clinical › Vitals & preventive › Body temperature: 37.2 °C');
  await settle(page);
  errs.assertNoErrors('N3');
});

test('N4 Apple Health: importing export.xml files the records under the matching leaves and connects the card', async ({ page }) => {
  await usePersona(page, 'participant');
  const errs = trackErrors(page);
  await page.goto('/p/sources');
  await settle(page);
  const card = page.locator('.source-card').filter({ hasText: 'Apple Health' }).first();
  await expect(card.getByRole('button', { name: 'Import export.xml' }).first()).toBeVisible();
  await page.getByTestId('apple-health-input').first().setInputFiles({ name: 'export.xml', mimeType: 'text/xml', buffer: readFileSync('tests/fixtures/apple-health-sample.xml') });
  await expect(successToast(page)).toContainText(/Apple Health: \d+ of \d+ records imported/);
  await expect(successToast(page)).toContainText(/Heart rate \d+/i);
  await expect(page.getByTestId('inbox-row').filter({ hasText: 'export.xml' })).toHaveAttribute('data-status', 'auto_filed');
  await settle(page);
  errs.assertNoErrors('N4');
});
