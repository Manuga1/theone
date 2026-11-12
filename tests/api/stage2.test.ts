// 2026-11-10 notes, stage 2: logging rewards (rules, daily cap, funding memo, ledger groups), the daily check-in and
// streak, vault mode (opportunities off, accept 403, rewards off, cohort + B1 exclude), onboarding (steps, restart) and
// the audit chain over HTTP (every governance write appends, verify, tamper → brokenAt). CLASSIFIER=rules.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { DEMO_TODAY } from '../../shared/clock';
import {
  PERSONA_HEADER, type AuditLog, type AuditVerify, type BuyerHome, type CheckIn, type CheckInResult, type Dataset, type LoggingRewards, type NodeDetail, type OnboardingState, type OntologyResponse,
  type ParticipantHome, type ParticipantLedger, type ParticipantOpportunities, type ParticipantPermissions, type ParticipantSources, type QuickLogResult, type ReviewResult, type UploadResult,
} from '../../shared/api-types';
import { evaluateCohort, invalidateCohortCache } from '../../server/services/cohort';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

process.env.CLASSIFIER = 'rules';

describe('stage 2: rewards, check-in, vault mode, onboarding, audit chain', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  let pid: number;
  const buyer = { [PERSONA_HEADER]: 'buyer:1' };
  beforeAll(() => { t = seededDbs(); app = createApp(); pid = alexId(t.graph); });
  const get = (url: string) => request(app).get(`/api/participant${url}`);
  const post = (url: string, body: unknown = {}) => request(app).post(`/api/participant${url}`).send(body as object);
  const put = (url: string, body: unknown) => request(app).put(`/api/participant${url}`).send(body as object);
  const audits = (kind: string) => t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_event WHERE participant_id = ? AND kind = ?', pid, kind)!.n;

  it('GET /rewards → the three seeded rules, nothing earned yet, a 5-day streak', async () => {
    const r = (await get('/rewards').expect(200)).body as LoggingRewards;
    expect(r.enabled).toBe(true);
    expect(r.disabledReason).toBeNull();
    expect(r.rules.map((x) => [x.conceptSlug, x.cents, x.dailyCapCents, x.fundedBy.kind, x.fundedBy.name])).toEqual([
      ['behavior.nutrition.food_log', 100, null, 'campaign', 'Metabolic Monitoring Study'],
      ['physiology.cardiovascular.blood_pressure', 25, 100, 'platform', 'Platform'],
      ['outcomes.patient_reported.symptom_survey', 500, null, 'campaign', 'Wearable Sleep Study'],
    ]);
    expect(r.rules.every((x) => x.today.count === 0 && x.today.cents === 0)).toBe(true);
    expect(r).toMatchObject({ todayCents: 0, weekCents: 0, streakDays: 5 });
    const home = (await get('/home')).body as ParticipantHome;
    expect(home.checkIn).toEqual({ done: false, promptCount: expect.any(Number), streakDays: 5 });
    expect(home.rewardsToday).toEqual({ cents: 0, count: 0 });
    expect(home.vaultOnly).toBe(false);
    expect(home.onboardingCompleted).toBe(true);
    // lifetime earnings untouched by the stage-2 seed
    expect(home.lifetimeEarningsCents).toBe(284217);
  });
  it('a filed BP reading earns $0.25 (platform); the 4th reading hits the $1 daily cap; a lunch photo earns $1 funded by the campaign', async () => {
    const earnings = (await get('/ledger')).body as ParticipantLedger;
    const first = (await post('/log', { text: 'bp 128/82' }).expect(200)).body as QuickLogResult;
    expect(first.status).toBe('filed');
    expect(first.rewardCents).toBe(25);
    expect(first.message).toMatch(/\+\$0\.25/);
    for (const text of ['bp 127/80 at 9am', 'bp 125/79 at noon']) expect(((await post('/log', { text })).body as QuickLogResult).rewardCents).toBe(25);
    const fourth = (await post('/log', { text: 'bp 124/78 at 8pm' })).body as QuickLogResult;
    expect(fourth.rewardCents).toBe(25); // 4 × 25 = the $1 cap exactly
    const fifth = (await post('/log', { text: 'bp 126/80 at 9pm' })).body as QuickLogResult;
    expect(fifth.status).toBe('filed');
    expect(fifth.rewardCents).toBe(0); // capped
    const photo = (await post('/ingest/files', { files: [{ name: 'lunch-bowl.jpg', bytes: 1_200_000, mime: 'image/jpeg' }] }).expect(200)).body as UploadResult;
    expect(photo).toMatchObject({ autoFiled: 1, rewardCents: 100 });
    const rewards = (await get('/rewards')).body as LoggingRewards;
    expect(rewards.todayCents).toBe(200);
    expect(rewards.weekCents).toBe(200);
    expect(rewards.rules.find((x) => x.conceptSlug === 'physiology.cardiovascular.blood_pressure')!.today).toEqual({ count: 5, cents: 100 });
    expect(rewards.rules.find((x) => x.conceptSlug === 'behavior.nutrition.food_log')!.today).toEqual({ count: 1, cents: 100 });
    // every reward is a ledger row through postLedger (90/10 via fromNet) with the funding memo, grouped per day
    const ledger = (await get('/ledger')).body as ParticipantLedger;
    expect(ledger.lifetimeEarningsCents).toBe(earnings.lifetimeEarningsCents + 200);
    expect(ledger.rewardsToday).toBe(200);
    expect(ledger.groups).toEqual([{ date: DEMO_TODAY, label: 'Logging rewards · 5 items', cents: 200, count: 5, entryIds: expect.any(Array) }]);
    const rows = ledger.entries.filter((e) => ledger.groups![0].entryIds.includes(e.id));
    expect(rows).toHaveLength(5);
    expect(rows.find((e) => e.participantCents === 100)).toMatchObject({ kind: 'contribution_payment', title: 'Logging reward: Food log (per food photo)', studyName: 'Metabolic Monitoring Study', orgName: 'Example BioPharma', dataIncluded: ['Food log'] });
    expect(rows.find((e) => e.participantCents === 100)!.purpose).toMatch(/funded by Metabolic Monitoring Study/);
    expect(rows.find((e) => e.participantCents === 25)).toMatchObject({ studyName: 'Platform', grossCents: 28, platformCents: 3 });
    expect(rows.find((e) => e.participantCents === 25)!.purpose).toMatch(/funded by the platform/);
    expect(ledger.audit).toMatchObject({ ok: true });
    expect(ledger.audit!.headHash).toMatch(/^[0-9a-f]{64}$/);
    const home = (await get('/home')).body as ParticipantHome;
    expect(home.rewardsToday).toEqual({ cents: 200, count: 5 });
    expect(home.whatChanged[0].amountCents).toBe(100);
  });
  it('GET /checkin asks only for daily leaves not logged today; POST files the answers as check-in items and keeps the streak', async () => {
    const c = (await get('/checkin').expect(200)).body as CheckIn;
    expect(c).toMatchObject({ date: DEMO_TODAY, done: false, streakDays: 5, rewardCents: 0 });
    const slugs = c.prompts.map((p) => p.conceptSlug);
    expect(slugs).not.toContain('clinical.medications.adherence_today'); // logged this morning
    expect(slugs).not.toContain('behavior.nutrition.caffeine'); // two espressos this morning
    expect(slugs).not.toContain('physiology.cardiovascular.blood_pressure'); // cuff readings today (+ the logs above)
    expect(slugs).toEqual(expect.arrayContaining(['behavior.sleep.bedtime_log', 'behavior.exercise.session', 'behavior.tobacco.cigarettes', 'physiology.metabolic.weight']));
    expect(c.prompts.find((p) => p.conceptSlug === 'behavior.exercise.session')).toMatchObject({ valueKind: 'categorical', options: expect.arrayContaining(['run', 'none']) });
    expect(c.prompts.find((p) => p.conceptSlug === 'behavior.sleep.bedtime_log')).toMatchObject({ valueKind: 'continuous', unit: 'h' });
    const r = (await post('/checkin', { answers: [
      { id: 'behavior.sleep.bedtime_log', value: '23:30' },
      { id: 'behavior.exercise.session', value: 'yoga' },
      { id: 'behavior.tobacco.cigarettes', value: 'no' },
      { id: 'physiology.metabolic.weight', value: '182 lb' },
    ] }).expect(200)).body as CheckInResult;
    expect(r).toMatchObject({ filed: 4, rewardCents: 0, streakDays: 5 });
    expect(r.items.every((i) => i.kind === 'checkin' && i.status === 'auto_filed')).toBe(true);
    const bed = (await get('/nodes/behavior.sleep.bedtime_log')).body as NodeDetail;
    expect(bed.lastLoggedAt?.slice(0, 10)).toBe(DEMO_TODAY);
    expect(t.graph.get<{ v: number }>("SELECT value_num AS v FROM observation o JOIN concept c ON c.id = o.concept_id WHERE c.slug = 'behavior.sleep.bedtime_log' ORDER BY o.observed_at DESC LIMIT 1")!.v).toBe(23.5);
    const yoga = (await get('/nodes/behavior.exercise.session')).body as NodeDetail;
    expect(yoga.variants?.map((v) => v.name)).toEqual(['run', 'yoga']); // the answer created the yoga sub-branch
    expect(t.graph.get<{ v: number }>("SELECT value_num AS v FROM observation o JOIN concept c ON c.id = o.concept_id WHERE c.slug = 'physiology.metabolic.weight' ORDER BY o.observed_at DESC LIMIT 1")!.v).toBe(82.6);
    const after = (await get('/checkin')).body as CheckIn;
    expect(after.done).toBe(true);
    expect(after.prompts.map((p) => p.conceptSlug)).not.toContain('behavior.sleep.bedtime_log');
    expect(t.graph.get<{ done: number; a: string }>('SELECT done, answers_json AS a FROM checkin_day WHERE participant_id = ? AND date = ?', pid, DEMO_TODAY)).toMatchObject({ done: 1 });
    expect(((await get('/home')).body as ParticipantHome).checkIn).toMatchObject({ done: true, streakDays: 5 });
    await post('/checkin', {}).expect(400);
    await post('/checkin', { answers: [{ id: 'nope', value: 1 }] }).expect(400);
    await post('/checkin', { answers: [{ id: 'behavior.mood.daily_mood', value: 9 }] }).expect(400);
    // an empty answer files nothing
    expect(((await post('/checkin', { answers: [{ id: 'behavior.tobacco.cigarettes', value: null }] })).body as CheckInResult).filed).toBe(0);
  });
  it('vault mode: PUT /permissions {vaultOnly} audits; opportunities empty with a reason; accept 403; no rewards; cohort engine and B1 exclude the participant', async () => {
    const tilesBefore = ((await request(app).get('/api/buyer/home').set(buyer)).body as BuyerHome).tiles;
    invalidateCohortCache(t.graph);
    const baseBefore = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, skipCache: true }, t.graph).recontactBase;
    const opp = ((await get('/opportunities?tab=available')).body as ParticipantOpportunities).items[0];
    await post(`/opportunities/${opp.id}/view`).expect(200);
    await post(`/opportunities/${opp.id}/review`).expect(200);

    const p = (await put('/permissions', { vaultOnly: true }).expect(200)).body as ParticipantPermissions;
    expect(p.vaultOnly).toBe(true);
    expect(audits('vault_mode_changed')).toBe(1);
    const o = (await get('/opportunities').expect(200)).body as ParticipantOpportunities;
    expect(o.items).toEqual([]);
    expect(o.counts).toEqual({ available: 0, in_progress: 0, past: 0 });
    expect(o.disabledReason).toMatch(/vault mode/);
    const home = (await get('/home')).body as ParticipantHome;
    expect(home.vaultOnly).toBe(true);
    expect(home.opportunities).toEqual({ count: 0, maxCents: 0 });
    const denied = await post(`/opportunities/${opp.id}/accept`).expect(403);
    expect(denied.body.error).toMatch(/vault mode/);
    const rewards = (await get('/rewards')).body as LoggingRewards;
    expect(rewards.enabled).toBe(false);
    expect(rewards.disabledReason).toMatch(/vault mode/);
    const log = (await post('/log', { text: 'took a food photo of dinner' })).body as QuickLogResult;
    expect(log.rewardCents).toBe(0);
    const photo = (await post('/ingest/files', { files: [{ name: 'dinner-plate.jpg', bytes: 900_000, mime: 'image/jpeg' }] })).body as UploadResult;
    expect(photo).toMatchObject({ autoFiled: 1, rewardCents: 0 });
    // buyer side: the consent predicate drops vault-only participants; B1 tiles exclude them
    const tiles = ((await request(app).get('/api/buyer/home').set(buyer)).body as BuyerHome).tiles;
    expect(tiles.availableParticipants).toBe(tilesBefore.availableParticipants - 1);
    expect(tiles.recontactable).toBe(tilesBefore.recontactable - 1);
    expect(evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, skipCache: true }, t.graph).recontactBase).toBe(baseBefore - 1);
    // switching back restores everything and audits again
    await put('/permissions', { vaultOnly: false }).expect(200);
    expect(audits('vault_mode_changed')).toBe(2);
    expect(((await get('/opportunities?tab=available')).body as ParticipantOpportunities).items.length).toBe(4);
    expect(((await request(app).get('/api/buyer/home').set(buyer)).body as BuyerHome).tiles).toEqual(tilesBefore);
    expect(((await get('/rewards')).body as LoggingRewards).enabled).toBe(true);
    await put('/permissions', { vaultOnly: false }).expect(200); // no-op: no third event
    expect(audits('vault_mode_changed')).toBe(2);
  });
  it('onboarding: Alex is onboarded; restart → identity → consent → mode → done, every step audited', async () => {
    const s0 = (await get('/onboarding').expect(200)).body as OnboardingState;
    expect(s0).toMatchObject({ completed: true, step: 'done', vaultOnly: false });
    expect(s0.identity).toMatchObject({ status: 'verified', legalName: 'Alex Morgan' });
    expect(s0.consent.prohibitedUses).toHaveLength(11);
    const s1 = (await post('/onboarding', { step: 'restart' }).expect(200)).body as OnboardingState;
    expect(s1).toMatchObject({ completed: false, step: 'identity' });
    expect(((await get('/home')).body as ParticipantHome).onboardingCompleted).toBe(false);
    await post('/onboarding', { step: 'identity' }).expect(400);
    const s2 = (await post('/onboarding', { step: 'identity', confirm: true }).expect(200)).body as OnboardingState;
    expect(s2.step).toBe('consent');
    const s3 = (await post('/onboarding', { step: 'consent', recontactOptIn: true, commercialOk: false, excludedCategories: ['imaging'] }).expect(200)).body as OnboardingState;
    expect(s3.step).toBe('mode');
    expect(s3.consent).toMatchObject({ recontactOptIn: true, commercialOk: false, excludedCategories: ['imaging'] });
    const s4 = (await post('/onboarding', { step: 'mode', vaultOnly: false }).expect(200)).body as OnboardingState;
    expect(s4.step).toBe('done');
    expect(s4.completed).toBe(false);
    const s5 = (await post('/onboarding', { step: 'done' }).expect(200)).body as OnboardingState;
    expect(s5).toMatchObject({ completed: true, step: 'done' });
    expect(t.graph.get<{ o: string }>('SELECT onboarded_at AS o FROM participant WHERE id = ?', pid)!.o).toBe('2026-10-24T14:00:00Z');
    for (const k of ['onboarding_restarted', 'onboarding_identity', 'onboarding_consent', 'onboarding_mode', 'onboarding_completed']) expect(audits(k), k).toBe(1);
    await post('/onboarding', { step: 'bogus' }).expect(400);
    await put('/permissions', { commercialOk: true, excludedCategories: [] }).expect(200);
  });
  it('GET /audit lists the participant chain with anchors and a passing verification; governance writes append; tampering is detected over HTTP', async () => {
    const a = (await get('/audit').expect(200)).body as AuditLog;
    expect(a.total).toBeGreaterThan(30);
    expect(a.events.length).toBeGreaterThan(30);
    expect(a.events[0].id).toBeGreaterThan(a.events[1].id); // newest first
    expect(a.headHash).toBe(a.verify.headHash);
    expect(a.verify).toMatchObject({ ok: true, brokenAt: null });
    expect(a.anchors.length).toBeGreaterThan(5);
    expect(a.anchors[0]).toMatchObject({ status: 'simulated', events: expect.any(Number) });
    expect(a.anchors[0].note).toMatch(/public chain/);
    expect(a.anchors.map((x) => x.date)).not.toContain(DEMO_TODAY); // today's root is anchored at the end of the day
    expect(a.explanation).toMatch(/never written on-chain/);
    const kinds = new Set(a.events.map((e) => e.kind));
    for (const k of ['ledger_license_fee', 'ledger_contribution_payment', 'consent_granted', 'license_created', 'branch_created', 'vault_mode_changed', 'permissions_changed', 'onboarding_completed']) expect(kinds.has(k), k).toBe(true);
    // governance writes
    const sources = (await get('/sources')).body as ParticipantSources;
    const scale = sources.sources.find((s) => s.vendor === 'Withings Body+')!;
    expect(scale).toMatchObject({ kindGroup: 'device', health: 'ok', importFormats: ['.csv', '.json'] });
    expect(sources.sources.find((s) => s.kind === 'apple_health')).toMatchObject({ status: 'available', health: 'never_synced', importFormats: ['export.xml'], kindGroup: 'wearable' });
    expect(sources.sources.find((s) => s.vendor === 'Color Genomics')).toMatchObject({ kindGroup: 'genomics', health: 'ok' });
    await post(`/sources/${scale.id}/disconnect`).expect(200);
    expect(audits('source_disconnected')).toBe(1);
    expect(((await get('/sources')).body as ParticipantSources).sources.find((s) => s.id === scale.id)).toMatchObject({ health: 'needs_attention' });
    await post(`/sources/${scale.id}/connect`).expect(200);
    const ledger = (await get('/ledger')).body as ParticipantLedger;
    const active = ledger.entries.find((e) => e.canRevoke)!;
    await post(`/licenses/${active.licenseId}/revoke`).expect(200);
    expect(audits('license_revoked')).toBe(1);
    await request(app).delete('/api/participant/categories/environment').expect(200);
    expect(audits('category_deleted')).toBe(1);
    // a review that creates a branch is audited
    const weak = (await post('/log', { text: 'temperature 38.1 C' })).body as QuickLogResult;
    expect(weak.status).toBe('needs_review');
    const branch = (await post(`/ingest/${weak.item.id}/review`, { action: 'create_branch', newConcept: { name: 'Body temperature', parentSlug: 'clinical.vitals', valueKind: 'continuous', unit: '°C' } }).expect(200)).body as ReviewResult;
    expect(branch.createdConcept?.slug).toBe('clinical.vitals.body_temperature');
    expect(audits('branch_created')).toBe(4); // espresso + run (seed) + yoga (check-in) + body temperature (review)
    const v = (await post('/audit/verify').expect(200)).body as AuditVerify;
    expect(v.ok).toBe(true);
    expect(v.events).toBe(t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_event')!.n);
    // tamper with the oldest license event → broken at that row, the ledger page says so
    const victim = t.graph.get<{ id: number; payload_json: string }>("SELECT id, payload_json FROM audit_event WHERE kind = 'license_created' ORDER BY id LIMIT 1")!;
    t.graph.run('UPDATE audit_event SET payload_json = ? WHERE id = ?', victim.payload_json.replace(/"participantCents":\d+/, '"participantCents":1'), victim.id);
    const broken = (await post('/audit/verify').expect(200)).body as AuditVerify;
    expect(broken).toMatchObject({ ok: false, brokenAt: victim.id });
    expect(((await get('/audit')).body as AuditLog).verify.brokenAt).toBe(victim.id);
    t.graph.run('UPDATE audit_event SET payload_json = ? WHERE id = ?', victim.payload_json, victim.id);
    expect(((await post('/audit/verify')).body as AuditVerify).ok).toBe(true);
  });
  it('buyer: the dataset provenance tab carries the classifier-filed share; GET /buyer/ontology marks concepts created in the last 30 days', async () => {
    const studies = (await request(app).get('/api/buyer/studies').set(buyer)).body as { studies: { datasetId: number | null }[] };
    const dsId = studies.studies.find((s) => s.datasetId)!.datasetId!;
    const d = (await request(app).get(`/api/buyer/datasets/${dsId}?tab=provenance`).set(buyer).expect(200)).body as Dataset;
    expect(d.provenance.length).toBeGreaterThan(0);
    for (const p of d.provenance) expect(p.classified).toMatchObject({ pct: expect.any(Number) });
    const o = (await request(app).get('/api/buyer/ontology').set(buyer).expect(200)).body as OntologyResponse;
    const leaves = o.domains.flatMap((x) => x.children.flatMap((g) => g.children));
    expect(leaves.find((l) => l.slug === 'clinical.vitals.body_temperature')?.isNew).toBe(true);
    expect(leaves.find((l) => l.slug === 'physiology.cardiovascular.blood_pressure')?.isNew).toBe(false);
  });
});
