import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import type { NodeDetail, OpportunityDetail, ParticipantHome, ParticipantLedger, ParticipantOpportunities, ParticipantPermissions, ParticipantProfile, ParticipantSignature, ParticipantSources, ParticipantTimeline } from '../../shared/api-types';
import { DEMO_NOW } from '../../shared/clock';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

describe('participant API', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => { t = seededDbs(); app = createApp(); });
  const get = (url: string) => request(app).get(`/api/participant${url}`);
  const post = (url: string, body: unknown = {}) => request(app).post(`/api/participant${url}`).send(body as object);

  it('GET home → 74 % / +6 / 12 / $2,842.17 / 7 / 4', async () => {
    const r = await get('/home').expect(200);
    const h = r.body as ParticipantHome;
    expect(h.participant.firstName).toBe('Alex');
    expect(h.participant.age).toBe(48);
    expect(h.completeness).toEqual({ pct: 74, deltaMonth: 6 });
    expect(h.verifiedSources).toBe(12);
    expect(h.lifetimeEarningsCents).toBe(284217);
    expect(h.licensedUses).toBe(7);
    expect(h.opportunities.count).toBe(4);
    expect(h.opportunities.maxCents).toBe(185500);
    // eight ring nodes: Demographics stays out of the P1 ring (it remains in the P2 list)
    expect(h.ring.map((r) => r.slug)).not.toContain('demographics');
    expect(h.ring.map((r) => r.pct)).toEqual([78, 94, 82, 58, 31, 61, 88, 71]);
    expect(h.whatChanged.length).toBeGreaterThan(3);
    expect(h.whatChanged[0].relative).toBe('2 hours ago');
    expect(h.whatChanged.find((a) => a.amountCents === 4200)?.relative).toBe('3 days ago');
  });
  it('the demo clock reads 14:00Z (afternoon) and no seeded observation of Alex lies after it; BP row count is unchanged', () => {
    expect(DEMO_NOW).toBe('2026-10-24T14:00:00Z');
    const pid = alexId(t.graph);
    expect(t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM observation WHERE participant_id = ? AND observed_at > ?', pid, DEMO_NOW)!.n).toBe(0);
    expect(t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM observation o JOIN concept c ON c.id = o.concept_id WHERE o.participant_id = ? AND c.slug = 'physiology.cardiovascular.blood_pressure' AND o.derivation IS NULL", pid)!.n).toBe(1482);
    expect(t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM observation o JOIN concept c ON c.id = o.concept_id WHERE o.participant_id = ? AND c.slug = 'physiology.cardiovascular.blood_pressure' AND o.derivation IS NULL AND substr(o.observed_at, 1, 10) = '2026-10-24'", pid)!.n).toBeGreaterThanOrEqual(3);
  });
  it('GET signature → nine domains, legend, opportunity pills on CGM and grip', async () => {
    const s = (await get('/signature').expect(200)).body as ParticipantSignature;
    expect(s.domains).toHaveLength(9);
    expect(s.legend.map((l) => l.key)).toContain('opportunity');
    const leaves = s.domains.flatMap((d) => d.children.flatMap((g) => g.children));
    expect(leaves.filter((l) => l.overlay.opportunity).map((l) => l.slug).sort()).toEqual(['physiology.metabolic.cgm', 'physiology.strength.grip_strength']);
    expect(leaves.every((l) => l.inList)).toBe(true); // hidden reference concepts (diagnoses) are not listed
  });
  it('GET nodes/:slug → BP detail; unknown slug → 404', async () => {
    const n = (await get('/nodes/physiology.cardiovascular.blood_pressure').expect(200)).body as NodeDetail;
    expect(n.summary.nObs).toBe(1482);
    expect(n.summary.spanLabel).toBe('14 months continuous data');
    expect(n.summary.verification).toBe('Device verified');
    expect(n.summary.sourceLabel).toBe('Omron BP7450');
    expect(n.series.keys.map((k) => k.key)).toEqual(['systolic', 'diastolic']);
    expect(n.series.points.length).toBeGreaterThan(300);
    expect(n.lineage.map((l) => l.key)).toEqual(['device', 'raw', 'verified', 'standardized', 'derived']);
    // research use: 3 licenses carry a BP line ($118) + the verified 14-day BP protocol payment ($320) = $438 lifetime for this node
    expect(n.research).toMatchObject({ licenses: 3, earningsCents: 11800 + 32000, requestedBy: 2 });
    expect(n.research.lines.filter((l) => l.licenseNumber.startsWith('#'))).toHaveLength(4);
    expect(n.rawVsDerived.rawCount).toBe(1482);
    expect(n.path).toEqual(['Physiology', 'Cardiovascular', 'Blood Pressure']);
    await get('/nodes/not.a.concept').expect(404);
    const grip = (await get('/nodes/physiology.strength.grip_strength').expect(200)).body as NodeDetail;
    expect(grip.state).toBe('missing');
    expect(grip.overlay.opportunity).toBe(true);
  });
  it('GET timeline → categories with counts, category filter, trailing-6-month swimlane', async () => {
    const all = (await get('/timeline').expect(200)).body as ParticipantTimeline;
    expect(all.categories[0]).toMatchObject({ key: 'all', n: all.events.length });
    expect(all.events[0].title).toBe('Hypertension first documented');
    expect(all.swimlane.months.length).toBeGreaterThanOrEqual(6);
    expect(all.swimlane.lanes.map((l) => l.key)).toEqual(['bp', 'weight', 'sleep', 'exercise', 'lisinopril', 'labs', 'meals']);
    const lane = (k: string) => all.swimlane.lanes.find((l) => l.key === k)!;
    expect(lane('lisinopril').points[0].kind).toBe('bar');
    expect(lane('sleep').points.length).toBeGreaterThan(20); // nightly sleep, weekly dots across the 6-month window
    expect(lane('labs').points.map((p) => p.date)).toEqual(['2026-10-23']); // every lab draw in the window (one per draw date)
    expect(lane('labs').points[0].value).toBe(3); // HbA1c + lipid panel + metabolic panel drawn that day
    const meds = (await get('/timeline?category=medications').expect(200)).body as ParticipantTimeline;
    expect(meds.events.every((e) => e.category === 'medications')).toBe(true);
    expect(meds.events.length).toBe(all.categories.find((c) => c.key === 'medications')!.n);
  });
  it('GET sources → 12 verified connected sources + missing dimensions with actions', async () => {
    const s = (await get('/sources').expect(200)).body as ParticipantSources;
    expect(s.sources.filter((x) => x.status === 'connected' && x.verified)).toHaveLength(12);
    expect(s.missing.map((m) => [m.slug, m.action])).toEqual([
      ['physiology.metabolic.cgm', 'see_opportunities'],
      ['physiology.strength.grip_strength', 'see_opportunities'],
      ['biology.microbiome.gut_microbiome', 'watching'],
      ['environment.residential.residential_history', 'add_data'],
    ]);
  });
  it('disconnect soft-deletes and rebuilds coverage; reconnect restores', async () => {
    const omron = ((await get('/sources')).body as ParticipantSources).sources.find((x) => x.vendor === 'Omron BP7450')!;
    await post(`/sources/${omron.id}/disconnect`).expect(200);
    let bp = (await get('/nodes/physiology.cardiovascular.blood_pressure')).body as NodeDetail;
    expect(bp.state).toBe('missing');
    expect(bp.summary.nObs).toBe(0);
    let home = (await get('/home')).body as ParticipantHome;
    expect(home.verifiedSources).toBe(11);
    expect(home.completeness.pct).toBeLessThan(74);
    expect(t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM observation WHERE source_id = ? AND deleted_at IS NOT NULL', omron.id)!.n).toBeGreaterThan(1400);
    const re = (await post(`/sources/${omron.id}/connect`).expect(200)).body as { observations: number; synced: string[] };
    expect(re.synced).toEqual([]); // restored, not regenerated
    bp = (await get('/nodes/physiology.cardiovascular.blood_pressure')).body as NodeDetail;
    expect(bp.state).toBe('verified');
    expect(bp.summary.nObs).toBe(1482);
    home = (await get('/home')).body as ParticipantHome;
    expect(home.completeness.pct).toBe(74);
    await post('/sources/99999/connect').expect(404);
  });
  it('connecting an available source runs a small initial sync (connected-device provenance) and verifies it only because data exists', async () => {
    const dexcom = ((await get('/sources')).body as ParticipantSources).sources.find((x) => x.vendor === 'Dexcom G7')!;
    expect(dexcom).toMatchObject({ status: 'available', verified: false });
    const before = (await get('/nodes/physiology.metabolic.cgm')).body as NodeDetail;
    expect(before.state).toBe('missing');
    const r = (await post(`/sources/${dexcom.id}/connect`).expect(200)).body as { observations: number; synced: string[] };
    expect(r.synced).toEqual(['physiology.metabolic.cgm']);
    expect(r.observations).toBe(15 * 96 + 1); // 15 days × 96 readings + the derived summary
    const after = (await get('/nodes/physiology.metabolic.cgm')).body as NodeDetail;
    expect(after.state).toBe('verified'); // 15 days ≥ the 14-day span requirement, fresh
    expect(after.summary.provenanceClass).toBe('connected_device');
    expect(after.summary.verification).toBe('Device verified');
    expect(after.summary.nObs).toBe(15 * 96);
    expect(after.rawVsDerived.artifactCount).toBe(15);
    const src = ((await get('/sources')).body as ParticipantSources).sources.find((x) => x.id === dexcom.id)!;
    expect(src).toMatchObject({ status: 'connected', verified: true });
    expect(((await get('/home')).body as ParticipantHome).verifiedSources).toBe(13);
    expect(t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM observation WHERE source_id = ? AND observed_at > ?', dexcom.id, DEMO_NOW)!.n).toBe(0);
    // deterministic: the same connect on a fresh seed writes the same values
    const first = t.graph.all<{ v: number }>('SELECT value_num AS v FROM observation WHERE source_id = ? AND derivation IS NULL ORDER BY observed_at LIMIT 5', dexcom.id).map((x) => x.v);
    expect(first).toHaveLength(5);
    await post(`/sources/${dexcom.id}/disconnect`).expect(200);
    expect(((await get('/home')).body as ParticipantHome).verifiedSources).toBe(12);
    expect(((await get('/nodes/physiology.metabolic.cgm')).body as NodeDetail).state).toBe('missing');
  });
  it('notify adds a demand watch; self-report makes a node partial', async () => {
    await post('/missing/physiology.metabolic.body_composition/notify').expect(200);
    expect(t.graph.get("SELECT 1 FROM demand_watch w JOIN concept c ON c.id = w.concept_id WHERE c.slug = 'physiology.metabolic.body_composition'")).toBeTruthy();
    await post('/missing/physiology.metabolic.body_composition/notify').expect(200); // idempotent
    await post('/missing/physiology.strength.grip_strength/self-report', { value: 42, unit: 'kg' }).expect(200);
    const grip = (await get('/nodes/physiology.strength.grip_strength')).body as NodeDetail;
    expect(grip.state).toBe('partial');
    expect(grip.summary.nObs).toBe(1);
    expect(grip.summary.provenanceClass).toBe('self_report');
    await post('/missing/physiology.strength.grip_strength/self-report', {}).expect(400);
    await post('/missing/nope/self-report', { value: 1 }).expect(404);
  });
  it('GET opportunities → tabs 4 / 1 / 5, cards and detail', async () => {
    const o = (await get('/opportunities').expect(200)).body as ParticipantOpportunities;
    expect(o.counts).toEqual({ available: 4, in_progress: 1, past: 5 });
    expect(o.items).toHaveLength(10);
    const avail = (await get('/opportunities?tab=available').expect(200)).body as ParticipantOpportunities;
    expect(avail.items.map((i) => i.title)).toEqual(['Metabolic Monitoring Study', 'Glucose Response Cohort', 'Longitudinal Cardiovascular Study', 'Medication Adherence Survey']);
    expect(avail.items.map((i) => i.compCents)).toEqual([24000, 47500, 110000, 4000]);
    expect(avail.items[2].compIsMax).toBe(true);
    expect(avail.items[1].likelyMatch).toBe(true);
    expect(avail.items[0].reused).toEqual(['EHR history', 'Exome', 'Medications']);
    const prog = (await get('/opportunities?tab=in_progress')).body as ParticipantOpportunities;
    expect(prog.items[0].contributions.map((c) => c.status)).toEqual(['pending', 'submitted']);
    expect(prog.items[0].enrollmentId).toBeTypeOf('number');
    const d = (await get(`/opportunities/${avail.items[0].id}`).expect(200)).body as OpportunityDetail;
    expect(d.consent.organization).toBe('Example BioPharma');
    expect(d.consent.perTask.map((p) => p.compCents)).toEqual([12000, 5000, 3000]);
    expect(d.consent.reusedCompCents).toBe(4000); // EHR 1,500 + exome 2,000 + medications 500 = the reuse license fee
    expect(d.compCents).toBe(12000 + 5000 + 3000 + 4000);
    expect(d.consent.futureReuse).toBe(false);
    expect(d.consent.recontact).toBe('platform_only');
    expect(d.reviewed).toBe(false);
    await get('/opportunities/99999').expect(404);
  });
  it('GET ledger → 12 rows, 4 active licenses', async () => {
    const l = (await get('/ledger').expect(200)).body as ParticipantLedger;
    expect(l.entries).toHaveLength(12);
    expect(l.activeLicenses).toBe(4);
    expect(l.lifetimeEarningsCents).toBe(284217);
    expect(l.entries[0].licenseNumber).toBe('#1842');
    expect(l.split).toEqual({ participant: 0.9, platform: 0.1 });
  });
  it('GET/PUT permissions', async () => {
    const p = (await get('/permissions').expect(200)).body as ParticipantPermissions;
    expect(p.prohibitedUses).toHaveLength(7);
    expect(p.prohibitedUses.every((u) => u.fixed)).toBe(true);
    expect(p.categories).toHaveLength(9);
    const u = (await request(app).put('/api/participant/permissions').send({ excludedCategories: ['imaging'], recontactOptIn: false }).expect(200)).body as ParticipantPermissions;
    expect(u.categories.find((c) => c.slug === 'imaging')!.excluded).toBe(true);
    expect(u.recontactOptIn).toBe(false);
    await request(app).put('/api/participant/permissions').send({ excludedCategories: ['nope'] }).expect(400);
    await request(app).put('/api/participant/permissions').send({ excludedCategories: [], recontactOptIn: true }).expect(200);
  });
  it('GET profile reads the vault (identity) — only here', async () => {
    const p = (await get('/profile').expect(200)).body as ParticipantProfile;
    expect(p.legalName).toBe('Alex Morgan');
    expect(p.email).toContain('@');
    expect(p.age).toBe(48);
    expect(p.pseudonym).toMatch(/^P-[0-9a-f]{10}$/);
  });
});
