import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA, type CohortCriteria } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES } from '../../shared/ontology';
import { evaluateCohort, previewFor, kfloorN, orgConsent, groupKey, groupLabel } from '../../server/services/cohort';
import { participantMatches } from '../../server/services/match';
import { expectedFunnel, expectedTiles, scaledTiers } from '../../server/seed/tiers';
import { seededDbs, alexId, TEST_SCALE, type TestDbs } from '../helpers/db';

describe('cohort engine (scale 0.05, in-memory)', () => {
  let t: TestDbs;
  beforeAll(() => { t = seededDbs(); });

  it('funnel equals the tier arithmetic at this scale', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, t.graph);
    expect(ev.funnel.map((f) => f.n)).toEqual(expectedFunnel(scaledTiers(TEST_SCALE)));
    expect(ev.funnel).toHaveLength(7);
    expect(ev.readyNow).toBe(ev.funnel[6].n);
    expect(ev.recontactBase).toBe(expectedTiles(scaledTiers(TEST_SCALE)).recontactBase);
    expect(ev.notRecruitable[0].n).toBe(ev.funnel[2].n - ev.funnel[3].n);
  });
  it('matrix groups cover every non-ready member with sufficient EHR; keys / labels are stable', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, t.graph);
    expect(ev.groups.map((g) => g.key)).toEqual(['nutrition_only', 'bp_only', 'exome_only', 'exome_nutrition', 'bp_nutrition', 'exome_bp_nutrition']);
    expect(ev.groups.reduce((a, g) => a + g.eligible, 0)).toBe(ev.funnel[3].n - ev.readyNow);
    for (const g of ev.groups) expect(g.recruitable).toBeLessThanOrEqual(g.eligible);
    expect(groupKey(['physiology.cardiovascular.blood_pressure', 'behavior.nutrition.food_log'])).toBe('bp_nutrition');
    expect(groupLabel(['biology.genomics.exome', 'physiology.cardiovascular.blood_pressure', 'behavior.nutrition.food_log'])).toBe('Exome + BP + nutrition');
    expect(groupLabel(['behavior.nutrition.food_log'])).toBe('Nutrition only');
  });
  it('heatmap: complete cohort row satisfies every criteria column; bars are shares of the base', () => {
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, t.graph);
    expect(ev.heatmap.rows[0].label).toBe('Complete cohort');
    expect(ev.heatmap.rows[0].n).toBe(ev.readyNow);
    expect(ev.heatmap.rows[0].cells.slice(0, 5)).toEqual(['complete', 'complete', 'complete', 'complete', 'complete']);
    expect(ev.heatmap.rows).toHaveLength(4);
    expect(ev.bars[0].pct).toBe(100); // EHR any-data
    for (const b of ev.bars) { expect(b.pct).toBeGreaterThanOrEqual(0); expect(b.pct).toBeLessThanOrEqual(100); }
  });
  it('a red-lined org (AdTarget) zeroes every stage', () => {
    const consent = orgConsent(4, t.graph);
    expect(consent.blocked).toBe(true);
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 4 }, t.graph);
    expect(ev.total).toBe(0);
    expect(ev.funnel.every((f) => f.n === 0)).toBe(true);
    expect(ev.groups).toEqual([]);
    expect(orgConsent(1, t.graph).blocked).toBe(false);
  });
  it('cache: keyed by criteria hash + writeVersion', () => {
    const a = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, t.graph);
    const b = evaluateCohort({ ...DEFAULT_CRITERIA }, { orgId: 1 }, t.graph);
    expect(b).toBe(a);
    t.graph.tx(() => t.graph.run("UPDATE participant SET region = region WHERE id = 1"));
    const c = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, t.graph);
    expect(c).not.toBe(a);
    expect(c.funnel).toEqual(a.funnel);
    const d = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, variables: DEFAULT_CAMPAIGN_VARIABLES }, t.graph);
    expect(d).not.toBe(c);
  });
  it('k-floor: buyer preview never exposes a count between 1 and 19', () => {
    expect(kfloorN(0)).toBe(0); expect(kfloorN(5)).toBe(19); expect(kfloorN(20)).toBe(20);
    const narrow: CohortCriteria = { ...DEFAULT_CRITERIA, demographics: { ageMin: 40, ageMax: 41, sex: 'female', country: 'US' } };
    const p = previewFor(narrow, 1, t.graph);
    const nums = [p.total, p.readyNow, ...p.funnel.map((f) => f.n), ...p.matrix.groups.flatMap((g) => [g.eligible, g.recruitable]), ...p.heatmap.rows.map((r) => r.n)];
    for (const n of nums) expect(n === 0 || n >= 19).toBe(true);
  });
  it('requireRecontact restricts the demographic stage; sex and country filters apply', () => {
    const base = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, t.graph);
    const rc = evaluateCohort({ ...DEFAULT_CRITERIA, requireRecontact: true }, { orgId: 1 }, t.graph);
    expect(rc.funnel[1].n).toBeLessThan(base.funnel[1].n);
    expect(rc.funnel[2].n).toBe(base.recontactBase);
    const f = evaluateCohort({ ...DEFAULT_CRITERIA, demographics: { ...DEFAULT_CRITERIA.demographics, sex: 'female' } }, { orgId: 1 }, t.graph);
    const m = evaluateCohort({ ...DEFAULT_CRITERIA, demographics: { ...DEFAULT_CRITERIA.demographics, sex: 'male' } }, { orgId: 1 }, t.graph);
    expect(f.funnel[1].n + m.funnel[1].n).toBe(base.funnel[1].n);
    const gb = evaluateCohort({ ...DEFAULT_CRITERIA, demographics: { ...DEFAULT_CRITERIA.demographics, country: 'GB' } }, { orgId: 1 }, t.graph);
    expect(gb.funnel[1].n).toBeGreaterThan(0);
    expect(gb.funnel[1].n).toBeLessThan(base.funnel[1].n);
    expect(gb.readyNow).toBe(0); // nobody outside the US holds ≥ 12 months of device BP in the synthetic population
  });
  it('Alex matches the B2 cohort profile; the requirement uses the historical branch only', () => {
    const pid = alexId(t.graph);
    expect(participantMatches(DEFAULT_CRITERIA, pid, t.graph)).toBe(true);
    expect(participantMatches({ ...DEFAULT_CRITERIA, demographics: { ageMin: 50, ageMax: 65, sex: 'any', country: 'US' } }, pid, t.graph)).toBe(false);
    // Alex's BP (426 days, device) satisfies ≥ 1 y; a 2-year requirement would not (protocol days never count here)
    const strict = evaluateCohort({ ...DEFAULT_CRITERIA, modalities: DEFAULT_CRITERIA.modalities.map((m) => (m.slug.endsWith('blood_pressure') ? { ...m, minSpanDays: 365 * 2 } : m)) }, { orgId: 1 }, t.graph);
    const inStrict = t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM pv WHERE pid = ? AND m2 = 1', pid)!.n;
    expect(inStrict).toBe(0);
    expect(strict.readyNow).toBeLessThan(evaluateCohort(DEFAULT_CRITERIA, { orgId: 1 }, t.graph).readyNow);
  });
});
