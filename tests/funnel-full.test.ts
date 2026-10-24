// Full-scale assertions against the real seeded database (FULL=1 npm run test:full, after `npm run seed`).
// Reads data/graph.sqlite (or $DATA_DIR/graph.sqlite) — never seeds.
import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../server/db/driver';
import { GRAPH_PATH } from '../server/db/paths';
import { evaluateCohort, invalidateCohortCache, previewFor } from '../server/services/cohort';
import { buildEstimate, estimatedAfter } from '../server/services/estimate';
import { FULL_TARGETS } from '../server/seed/tiers';
import { FULL_MARKETPLACE_TARGETS } from '../server/seed/marketplace';
import { listStudies, studyCoverage, studyCounters } from '../server/services/campaign';
import { datasetDetail } from '../server/services/dataset';
import { DEFAULT_CRITERIA } from '../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES } from '../shared/ontology';

const FULL = process.env.FULL === '1';

describe.skipIf(!FULL)('full-scale funnel (FULL=1)', () => {
  let db: Db;
  beforeAll(() => {
    if (!existsSync(GRAPH_PATH)) throw new Error(`${GRAPH_PATH} not found — run \`npm run seed\` first`);
    db = new Db(GRAPH_PATH);
    const total = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participant')!.n;
    if (total !== FULL_TARGETS.total) throw new Error(`database is not full scale (${total} participants) — run \`npm run seed\``);
  });

  it('the seven funnel counts are exact (611 incl. Alex)', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, skipCache: true }, db);
    expect(ev.funnel.map((f) => f.n)).toEqual(FULL_TARGETS.funnel);
    expect(ev.readyNow).toBe(611);
    expect(db.get("SELECT 1 FROM pv WHERE pid = (SELECT id FROM participant WHERE is_detailed = 1) AND base AND m0 AND m1 AND m2 AND m3")).toBeTruthy();
  });
  it('headline tiles 128,420 / 112,810 / 48,921 / 121,304 and recontactable base 8,422', () => {
    const n = (sql: string) => db.get<{ n: number }>(sql)!.n;
    expect(n('SELECT COUNT(*) AS n FROM participant')).toBe(FULL_TARGETS.total);
    expect(n("SELECT COUNT(*) AS n FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE k.slug = 'clinical.encounters.ehr_history' AND c.span_days >= 365 AND c.n_obs > 0")).toBe(FULL_TARGETS.ehr1y);
    expect(n("SELECT COUNT(*) AS n FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE k.slug = 'biology.genomics.exome' AND c.n_obs > 0")).toBe(FULL_TARGETS.exome);
    expect(n('SELECT COUNT(*) AS n FROM consent_setting WHERE recontact_opt_in = 1')).toBe(FULL_TARGETS.recontact);
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, db);
    expect(ev.recontactBase).toBe(FULL_TARGETS.recontactBase);
  });
  it('matrix groups 1,529 / 697 / 571 / 622 (+ 1,100 / 1,690) and "requires history" 2,092', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, db);
    const eligible = Object.fromEntries(ev.groups.map((g) => [g.key, g.eligible]));
    expect(eligible).toEqual(FULL_TARGETS.matrix);
    expect(ev.notRecruitable).toEqual([{ label: 'Not recruitable — requires history: EHR ≥ 3 y', n: 2092 }]);
    const after = estimatedAfter(ev.readyNow, ev.groups);
    expect(after.point).toBeGreaterThanOrEqual(2300);
    expect(after.point).toBeLessThanOrEqual(2650);
    expect(after.low).toBeGreaterThanOrEqual(2300);
    expect(after.high).toBeLessThanOrEqual(2700);
  });
  it('heatmap bars: EHR 100 / Labs 92 / Exome 50 / BP 74 / Diet 40 / CGM 16 / Imaging 36 (BP and Diet include the verified protocol data of the 2,841 started study members)', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, db);
    expect(ev.bars.map((b) => Math.round(b.pct))).toEqual([100, 92, 50, 74, 40, 16, 36]);
    expect(ev.heatmap.rows[0]).toMatchObject({ label: 'Complete cohort', n: 611 });
  });
  it('estimate triple 4,850 / 2,920 / 2,560 with pool ≥ 4,850; cost lines ±10 %; 6–8 weeks', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, variables: DEFAULT_CAMPAIGN_VARIABLES }, db);
    const e = buildEstimate({ targetN: 2500, readyNow: ev.readyNow, groups: ev.groups, variables: DEFAULT_CAMPAIGN_VARIABLES });
    expect(e.pool).toBeGreaterThanOrEqual(4850);
    expect([e.contacts, e.accepted, e.completed]).toEqual([4850, 2920, 2560]);
    const line = (k: string) => e.costLines.find((l) => l.key === k)!.cents;
    const within = (got: number, want: number) => Math.abs(got - want) <= want * 0.1;
    expect(within(line('participant_comp'), 318_000_00)).toBe(true);
    expect(within(line('devices_testing'), 94_000_00)).toBe(true);
    expect(within(line('data_preparation'), 42_000_00)).toBe(true);
    expect(within(line('platform_recruitment'), 86_000_00)).toBe(true);
    expect([e.weeksLow, e.weeksHigh]).toEqual([6, 8]);
    // the seeded BioPharma campaign carries the same estimate and the 8,422 eligible count
    const c = db.get<{ eligible_n: number; estimate_json: string }>("SELECT eligible_n, estimate_json FROM campaign WHERE name = 'Metabolic Monitoring Study'")!;
    expect(c.eligible_n).toBe(8422);
    expect(JSON.parse(c.estimate_json).contacts).toBe(4850);
  });
  it('B7 counters: 8,422 / 4,850 / 3,011 / 2,841 / 2,421 / 2,378, 122 need replacement; coverage BP 96 / Nutrition 91 / Exome 100 / EHR 100', () => {
    const study = listStudies(1, db).find((s) => s.name === 'Metabolic Monitoring Study')!;
    const c = studyCounters(study.id, db, false);
    expect(c).toEqual({ eligible: 8422, invited: FULL_MARKETPLACE_TARGETS.invited, accepted: FULL_MARKETPLACE_TARGETS.accepted, started: FULL_MARKETPLACE_TARGETS.started, completed: FULL_MARKETPLACE_TARGETS.completed, qualityAccepted: FULL_MARKETPLACE_TARGETS.quality, needReplacement: FULL_MARKETPLACE_TARGETS.needReplacement });
    const cov = Object.fromEntries(studyCoverage(study.id, db, false).map((v) => [v.slug, Math.round(v.pct)]));
    expect(cov['physiology.cardiovascular.blood_pressure']).toBe(96);
    expect(cov['behavior.nutrition.food_log']).toBe(91);
    expect(cov['biology.genomics.exome']).toBe(100);
    expect(cov['clinical.encounters.ehr_history']).toBe(100);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM license')!.n).toBe(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM enrollment')!.n + 1); // + Alex's reuse-only #1842
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ledger_entry WHERE kind = 'license_fee'")!.n).toBe(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM license')!.n);
    expect(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ledger_entry WHERE kind = 'contribution_payment'")!.n).toBe(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM contribution WHERE status = 'verified'")!.n);
  });
  it('B8 dataset v2 over 2,841 started members: Labs 8 % / Medications 2 % / Imaging 12 % / BP 4 % / Nutrition 9 % / EHR, Exome, Demographics 0 %', () => {
    const study = listStudies(1, db).find((s) => s.name === 'Metabolic Monitoring Study')!;
    const ds = datasetDetail(1, study.datasetId!, 'variables', db);
    expect(ds.version).toBe(2);
    expect(ds.memberCount).toBe(2841);
    expect(ds.rowLevelN).toBe(2378);
    const miss = Object.fromEntries(ds.variables.map((v) => [v.label, Math.round(v.missingPct)]));
    expect(miss).toMatchObject({ Demographics: 0, EHR: 0, Labs: 8, Exome: 0, 'Blood pressure': 4, Nutrition: 9, Medications: 2, Imaging: 12 });
  });
  it('a red-lined org gets zeros', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 4 }, db);
    expect(ev.total).toBe(0);
    expect(ev.consent.blocked).toBe(true);
  });
  it('uncached preview runs in < 300 ms at full scale', () => {
    invalidateCohortCache(db);
    evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, skipCache: true }, db); // warm the page cache once
    const times: number[] = [];
    for (let i = 0; i < 3; i++) times.push(previewFor(DEFAULT_CRITERIA, 1, db).timingMs, evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, skipCache: true }, db).timingMs);
    const uncached = times.filter((t) => t > 0);
    expect(uncached.length).toBeGreaterThan(0);
    expect(Math.min(...uncached)).toBeLessThan(300);
    expect(uncached.sort((a, b) => a - b)[Math.floor(uncached.length / 2)]).toBeLessThan(300);
  });
});
