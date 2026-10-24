// Targeted checks for the backend fix list: B5 workspace n = variables-tab n, B7 per-campaign counters, B9 canonical
// group labels, B13 bars note, B1 reuse fees on the ontology / default variables / validation.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { DEFAULT_CRITERIA, type CohortCriteria } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES, ONTOLOGY, flattenOntology, reuseFeeFor } from '../../shared/ontology';
import { PERSONA_HEADER, type CohortPreview, type Dataset, type OntologyResponse, type StudyDetail, type StudyList, type Workspace } from '../../shared/api-types';
import { evaluateCohort } from '../../server/services/cohort';
import { validateVariables } from '../../server/services/campaign';
import { seededDbs, type TestDbs } from '../helpers/db';

describe('backend fixes (scale 0.05)', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => { t = seededDbs(); app = createApp(); });
  const bget = (url: string) => request(app).get(`/api/buyer${url}`).set({ [PERSONA_HEADER]: 'buyer:1' });
  const bpost = (url: string, body: unknown) => request(app).post(`/api/buyer${url}`).set({ [PERSONA_HEADER]: 'buyer:1' }).send(body as object);

  it('B1: reuse fees exist on the ontology (≈ 15 % of comp, min 300¢; EHR 1,200 / exome 2,000 / medications 400 / BP 1,400), on TreeNode and on the default variables', async () => {
    const flat = new Map(flattenOntology().map((c) => [c.slug, c]));
    expect(flat.get('clinical.encounters.ehr_history')!.reuseCompCents).toBe(1200);
    expect(flat.get('biology.genomics.exome')!.reuseCompCents).toBe(2000);
    expect(flat.get('clinical.medications.medication_list')!.reuseCompCents).toBe(400);
    expect(flat.get('physiology.cardiovascular.blood_pressure')!.reuseCompCents).toBe(1400);
    expect(flat.get('physiology.metabolic.cgm')!.reuseCompCents).toBe(4500); // 15 % of 30,000
    expect(flat.get('physiology.cardiovascular.heart_rate')!.reuseCompCents).toBe(300); // floor
    for (const d of ONTOLOGY) for (const g of d.groups) for (const l of g.leaves) expect(reuseFeeFor(l)).toBeGreaterThanOrEqual(300);
    expect(flat.get('demographics')!.inRing).toBe(false);
    expect(flattenOntology().filter((c) => c.inRing)).toHaveLength(8);
    const o = (await bget('/ontology').expect(200)).body as OntologyResponse;
    const ehr = o.domains.flatMap((d) => d.children.flatMap((g) => g.children)).find((l) => l.slug === 'clinical.encounters.ehr_history')!;
    expect(ehr.reuseCompCents).toBe(1200);
    expect(DEFAULT_CAMPAIGN_VARIABLES.find((v) => v.mode === 'reuse')!.compCents).toBe(1200);
    // a reuse variable posted with no fee gets the ontology's reuse fee (a license is never free)
    const v = validateVariables([{ conceptSlug: 'clinical.medications.medication_list', mode: 'reuse', requirement: {}, compCents: 0, deviceCostCents: 0 }], t.graph);
    expect(v[0].compCents).toBe(400);
  });

  it('B13: the preview carries a note explaining what the any-data bars measure', async () => {
    const p = (await bpost('/cohorts/preview', DEFAULT_CRITERIA).expect(200)).body as CohortPreview;
    expect(p.barsNote).toMatch(/including data collected by running campaigns/);
  });

  it('B9: missing-data group labels follow the canonical ontology order whatever order the criteria list the modalities in', () => {
    const reversed: CohortCriteria = { ...DEFAULT_CRITERIA, modalities: DEFAULT_CRITERIA.modalities.slice().reverse() };
    const a = evaluateCohort(DEFAULT_CRITERIA, { orgId: 1, skipCache: true }, t.graph);
    const b = evaluateCohort(reversed, { orgId: 1, skipCache: true }, t.graph);
    expect(a.readyNow).toBe(b.readyNow);
    const labels = (ev: typeof a) => Object.fromEntries(ev.groups.map((g) => [g.key, { label: g.label, eligible: g.eligible }]));
    expect(labels(b)).toEqual(labels(a));
    expect(a.groups.map((g) => g.key)).toContain('exome_bp_nutrition');
    expect(a.groups.find((g) => g.key === 'exome_bp_nutrition')!.label).toBe('Exome + BP + nutrition');
    expect(b.groups.find((g) => g.key === 'exome_bp_nutrition')!.slugs).toEqual(['biology.genomics.exome', 'physiology.cardiovascular.blood_pressure', 'behavior.nutrition.food_log']);
  });

  it('B5 / B7: workspace n per variable equals the variables tab n; StudyDetail counters are the root campaign and each campaign carries its own', async () => {
    const study = ((await bget('/studies').expect(200)).body as StudyList).studies.find((s) => s.name === 'Metabolic Monitoring Study')!;
    const ds = (await bget(`/datasets/${study.datasetId}?tab=variables`).expect(200)).body as Dataset;
    const ws = (await bget(`/datasets/${study.datasetId}/workspace`).expect(200)).body as Workspace;
    expect(ws.variables.map((v) => v.slug)).toEqual(ds.variables.map((v) => v.slug));
    for (const v of ds.variables) {
      const w = ws.variables.find((x) => x.slug === v.slug)!;
      expect(w.n, v.slug).toBe(v.n);
    }
    const bp = ws.variables.find((v) => v.slug === 'physiology.cardiovascular.blood_pressure')!;
    expect(bp.mean).toBeGreaterThan(100);
    expect(bp.n).toBeLessThan(ds.memberCount); // the 4 % without a verified BP protocol are not in the stats subset
    const exome = ws.variables.find((v) => v.slug === 'biology.genomics.exome')!;
    expect(exome.n).toBe(ds.memberCount);
    expect(exome.mean).toBeNull();
    const d = (await bget(`/studies/${study.id}`).expect(200)).body as StudyDetail;
    expect(d.campaigns).toHaveLength(1);
    expect(d.campaigns[0].counters).toEqual(d.counters);
    expect(d.coverage.every((c) => c.campaignId === d.campaigns[0].id)).toBe(true);
  });
});
