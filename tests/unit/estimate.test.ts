import { describe, expect, it } from 'vitest';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES } from '../../shared/ontology';
import { PRICING } from '../../shared/pricing';
import { allocate, buildEstimate, contactsForTarget, estimatedAfter, type GroupInput } from '../../server/services/estimate';
import { evaluateCohort } from '../../server/services/cohort';
import { seededDbs } from '../helpers/db';

// The full-scale recruitable groups for the B2 cohort (reproduced exactly by tests/funnel-full.test.ts).
const FULL_GROUPS: GroupInput[] = [
  { key: 'nutrition_only', label: 'Nutrition only', slugs: ['behavior.nutrition.food_log'], eligible: 1529, recruitable: 1428 },
  { key: 'bp_only', label: 'BP only', slugs: ['physiology.cardiovascular.blood_pressure'], eligible: 697, recruitable: 642 },
  { key: 'exome_only', label: 'Exome only', slugs: ['biology.genomics.exome'], eligible: 622, recruitable: 584 },
  { key: 'exome_nutrition', label: 'Exome + nutrition', slugs: ['biology.genomics.exome', 'behavior.nutrition.food_log'], eligible: 1100, recruitable: 1026 },
  { key: 'bp_nutrition', label: 'BP + nutrition', slugs: ['physiology.cardiovascular.blood_pressure', 'behavior.nutrition.food_log'], eligible: 571, recruitable: 536 },
  { key: 'exome_bp_nutrition', label: 'Exome + BP + nutrition', slugs: ['biology.genomics.exome', 'physiology.cardiovascular.blood_pressure', 'behavior.nutrition.food_log'], eligible: 1690, recruitable: 1572 },
];

describe('estimate (pure)', () => {
  it('contacts = min(pool, ceil(target·BUFFER/(ACCEPT·COMPLETE))) → 4,850 / 2,920 / 2,560 at target 2,500', () => {
    expect(contactsForTarget(2500, 10_000)).toBe(4850);
    expect(contactsForTarget(2500, 4000)).toBe(4000);
    const e = buildEstimate({ targetN: 2500, readyNow: 611, groups: FULL_GROUPS, variables: DEFAULT_CAMPAIGN_VARIABLES });
    expect(e.pool).toBeGreaterThanOrEqual(4850);
    expect([e.contacts, e.accepted, e.completed]).toEqual([4850, 2920, 2560]);
    expect([e.weeksLow, e.weeksHigh]).toEqual([6, 8]);
  });
  it('cost lines ≈ $318k / $94k / $42k / $86k (±10 %)', () => {
    const e = buildEstimate({ targetN: 2500, readyNow: 611, groups: FULL_GROUPS, variables: DEFAULT_CAMPAIGN_VARIABLES });
    const line = (k: string) => e.costLines.find((l) => l.key === k)!.cents;
    const within = (got: number, want: number) => Math.abs(got - want) <= want * 0.1;
    expect(within(line('participant_comp'), 318_000_00), `comp ${line('participant_comp')}`).toBe(true);
    expect(within(line('devices_testing'), 94_000_00), `devices ${line('devices_testing')}`).toBe(true);
    expect(within(line('data_preparation'), 42_000_00), `prep ${line('data_preparation')}`).toBe(true);
    expect(within(line('platform_recruitment'), 86_000_00), `platform ${line('platform_recruitment')}`).toBe(true);
    expect(line('data_preparation')).toBe(2560 * PRICING.PREP_PER_COMPLETER_CENTS);
    expect(e.totalCents).toBe(e.costLines.reduce((a, l) => a + l.cents, 0));
    expect(e.groups.reduce((a, g) => a + g.completed, 0)).toBe(2560);
    expect(e.groups.reduce((a, g) => a + g.contacts, 0)).toBe(4850);
  });
  it('estimatedAfter = ready + Σ recruitable · ACCEPT · MULTI^(k−1) · COMPLETE^k, band ±6 %', () => {
    const a = estimatedAfter(611, FULL_GROUPS);
    expect(a.point).toBeGreaterThan(2300);
    expect(a.point).toBeLessThan(2650);
    expect(a.low).toBeLessThan(a.point);
    expect(a.high).toBeGreaterThan(a.point);
    expect(estimatedAfter(100, [])).toEqual({ low: 100, high: 100, point: 100 });
  });
  it('allocate sums exactly (largest remainder) and handles zeros', () => {
    expect(allocate(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(10);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [3, 4])).toEqual([0, 0]);
    expect(allocate(4850, FULL_GROUPS.map((g) => g.recruitable)).reduce((a, b) => a + b, 0)).toBe(4850);
  });
  it('a small pool caps contacts; collect_all puts every eligible member in a group', () => {
    const e = buildEstimate({ targetN: 2500, readyNow: 0, groups: [{ key: 'x', label: 'x', slugs: ['biology.genomics.exome'], eligible: 1000, recruitable: 900 }], variables: DEFAULT_CAMPAIGN_VARIABLES });
    expect(e.contacts).toBe(900);
    const t = seededDbs();
    const collectAll = DEFAULT_CAMPAIGN_VARIABLES.map((v) => (v.mode === 'reuse' ? v : { ...v, mode: 'collect_all' as const }));
    const ev = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, variables: collectAll }, t.graph);
    expect(ev.groups).toHaveLength(1);
    expect(ev.groups[0].slugs).toHaveLength(3);
    expect(ev.groups[0].eligible).toBe(ev.funnel[3].n); // everyone with sufficient EHR
  });
});
