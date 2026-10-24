import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, DEMO_TODAY } from '../../shared/clock';
import { computeCompleteness, completenessSummary, overlays, signatureTree, leafState } from '../../server/services/completeness';
import { coverageFor, rebuildCoverage } from '../../server/services/coverage';
import { conceptBySlug } from '../../server/services/ontology';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

describe("Alex's completeness (pinned mockup numbers)", () => {
  let t: TestDbs;
  let pid: number;
  beforeAll(() => { t = seededDbs(); pid = alexId(t.graph); });

  it('group percentages are exact', () => {
    const c = computeCompleteness(pid, DEMO_TODAY, t.graph);
    const g = (s: string) => Math.round(c.groups.get(s)!);
    expect(g('physiology.cardiovascular')).toBe(91);
    expect(g('physiology.metabolic')).toBe(58);
    expect(g('physiology.sleep')).toBe(96);
    expect(g('physiology.strength')).toBe(12);
    expect(g('physiology.mobility')).toBe(82);
  });
  it('domain percentages within ±2 of the pins', () => {
    const c = computeCompleteness(pid, DEMO_TODAY, t.graph);
    const pins: Record<string, number> = { demographics: 100, biology: 78, clinical: 94, physiology: 82, behavior: 58, environment: 31, family: 61, outcomes: 88, imaging: 71 };
    for (const [slug, want] of Object.entries(pins)) expect(Math.abs(c.domains.get(slug)! - want), slug).toBeLessThanOrEqual(2);
  });
  it('overall 74 with +6 vs 30 days earlier (as-of evaluation)', () => {
    const s = completenessSummary(pid, t.graph);
    expect(s.pct).toBe(74);
    expect(s.deltaMonth).toBe(6);
    const before = computeCompleteness(pid, addDays(DEMO_TODAY, -30), t.graph);
    expect(before.leaves.get('clinical.labs.hba1c')!.state).toBe('partial'); // stale as of Sep 24
    expect(before.leaves.get('imaging.specialty.retinal_scan')!.state).toBe('missing');
    expect(before.leaves.get('behavior.stress.stress_survey')!.state).toBe('missing');
    const now = computeCompleteness(pid, DEMO_TODAY, t.graph);
    expect(now.leaves.get('clinical.labs.hba1c')!.state).toBe('verified');
  });
  it('leaf states: self-report → partial, grip / CGM missing with opportunity overlay, microbiome missing', () => {
    const { tree } = signatureTree(pid, t.graph);
    const find = (slug: string) => {
      for (const d of tree) for (const g of d.children) for (const l of g.children) if (l.slug === slug) return l;
      throw new Error(slug);
    };
    expect(find('physiology.strength.strength_training').state).toBe('partial');
    expect(find('physiology.strength.grip_strength').state).toBe('missing');
    expect(find('physiology.strength.grip_strength').overlay.opportunity).toBe(true);
    expect(find('physiology.metabolic.cgm').overlay.opportunity).toBe(true);
    expect(find('physiology.metabolic.cgm').overlay.opportunityId).toBeTypeOf('number');
    expect(find('biology.microbiome.gut_microbiome').state).toBe('missing');
    expect(find('biology.microbiome.gut_microbiome').overlay.opportunity).toBe(false);
    expect(find('physiology.cardiovascular.blood_pressure').state).toBe('verified');
    expect(find('physiology.cardiovascular.blood_pressure').overlay.demand).toBe(true); // active campaigns collect BP
    expect(find('physiology.cardiovascular.blood_pressure').overlay.opportunity).toBe(false); // verified leaves never show the pill
    expect(overlays(pid, t.graph).get('physiology.cardiovascular.ecg')).toBeUndefined();
  });
  it('BP = exactly 1,482 measurements; coverage rebuilt from observations', () => {
    const cov = coverageFor(pid, t.graph).get('physiology.cardiovascular.blood_pressure')!;
    expect(cov.n_obs).toBe(1482);
    expect(cov.best_prov_rank).toBe(3);
    expect(cov.protocol_days).toBe(14);
    expect(cov.span_days).toBe(426);
    const raw = t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM observation o JOIN concept c ON c.id = o.concept_id WHERE o.participant_id = ? AND c.slug = 'physiology.cardiovascular.blood_pressure' AND o.derivation IS NULL", pid)!.n;
    expect(raw).toBe(1482);
    rebuildCoverage(pid, t.graph);
    expect(coverageFor(pid, t.graph).get('physiology.cardiovascular.blood_pressure')!.n_obs).toBe(1482);
  });
  it('leafState rules', () => {
    const bp = conceptBySlug('physiology.cardiovascular.blood_pressure', t.graph)!;
    const base = { concept_id: bp.id, slug: bp.slug, first_at: '2026-01-01', last_at: DEMO_TODAY, span_days: 296, n_obs: 10, best_prov_rank: 3, verified_n: 10, self_report_n: 0, last_value_num: null, protocol_days: 0 };
    expect(leafState(bp, base).state).toBe('verified');
    expect(leafState(bp, { ...base, best_prov_rank: 1 }).state).toBe('partial');
    expect(leafState(bp, { ...base, last_at: '2026-09-01' }).state).toBe('partial'); // stale (14 d)
    expect(leafState(bp, { ...base, first_at: '2026-10-01' }).state).toBe('partial'); // short span
    expect(leafState(bp, null).state).toBe('missing');
    expect(leafState(bp, { ...base, n_obs: 0 }).state).toBe('missing');
  });
});
