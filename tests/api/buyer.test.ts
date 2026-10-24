import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES } from '../../shared/ontology';
import { PERSONA_HEADER, type BuyerHome, type BuyerSearch, type CohortPreview, type Estimate, type OntologyResponse, type SavedCohortDetail, type SavedCohortList } from '../../shared/api-types';
import { expectedFunnel, expectedTiles, scaledTiers } from '../../server/seed/tiers';
import { seededDbs, TEST_SCALE, type TestDbs } from '../helpers/db';

describe('buyer API', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => { t = seededDbs(); app = createApp(); });
  const as = (org: number) => ({ [PERSONA_HEADER]: `buyer:${org}` });
  const get = (url: string, org = 1) => request(app).get(`/api/buyer${url}`).set(as(org));
  const post = (url: string, body: unknown, org = 1) => request(app).post(`/api/buyer${url}`).set(as(org)).send(body as object);

  it('GET home → tiles from queries, org, activity, counts', async () => {
    const h = (await get('/home').expect(200)).body as BuyerHome;
    const tiles = expectedTiles(scaledTiers(TEST_SCALE));
    expect(h.org.name).toBe('Example BioPharma');
    expect(h.tiles.availableParticipants).toBe(t.report.participants);
    expect(h.tiles.longitudinalProfiles).toBe(tiles.ehr1y);
    expect(h.tiles.genomicsAvailable).toBe(tiles.exome);
    expect(h.tiles.recontactable).toBe(tiles.recontact);
    expect(h.activity[0].relative).toBe('2 hours ago');
    expect(h.counts.studies).toBe(2);
    expect(h.counts.campaigns).toBe(1);
    const ad = (await get('/home', 4).expect(200)).body as BuyerHome;
    expect(ad.tiles).toEqual({ availableParticipants: 0, longitudinalProfiles: 0, genomicsAvailable: 0, recontactable: 0 });
  });
  it('POST cohorts/preview → funnel, matrix, heatmap, bars; invalid criteria → 400', async () => {
    const p = (await post('/cohorts/preview', DEFAULT_CRITERIA).expect(200)).body as CohortPreview;
    expect(p.funnel.map((f) => f.n)).toEqual(expectedFunnel(scaledTiers(TEST_SCALE)));
    expect(p.readyNow).toBe(p.funnel[6].n);
    expect(p.matrix.groups.map((g) => g.key)).toContain('nutrition_only');
    expect(p.matrix.notRecruitable[0].label).toContain('requires history');
    expect(p.matrix.estimatedAfter.point).toBeGreaterThan(p.readyNow);
    expect(p.heatmap.columns.map((c) => c.label)).toEqual(['EHR', 'Labs', 'Exome', 'BP', 'Diet', 'CGM', 'Imaging']);
    expect(p.heatmap.rows[0].cells).toHaveLength(7);
    expect(p.bars).toHaveLength(7);
    expect(p.consent.blocked).toBe(false);
    expect(p.timingMs).toBeGreaterThanOrEqual(0);
    await post('/cohorts/preview', { demographics: { sex: 'other' } }).expect(400);
    const blocked = (await post('/cohorts/preview', DEFAULT_CRITERIA, 4).expect(200)).body as CohortPreview;
    expect(blocked.consent.blocked).toBe(true);
    expect(blocked.funnel.every((f) => f.n === 0)).toBe(true);
  });
  it('cohorts: create / list / get are org-scoped', async () => {
    const c = (await post('/cohorts', { name: 'My T2D cohort', criteria: DEFAULT_CRITERIA }).expect(201)).body as SavedCohortDetail;
    expect(c.name).toBe('My T2D cohort');
    expect(c.preview.readyNow).toBe(expectedFunnel(scaledTiers(TEST_SCALE))[6]);
    const list = (await get('/cohorts').expect(200)).body as SavedCohortList;
    expect(list.cohorts.map((x) => x.id)).toContain(c.id);
    const detail = (await get(`/cohorts/${c.id}`).expect(200)).body as SavedCohortDetail;
    expect(detail.criteria.conditions).toEqual(DEFAULT_CRITERIA.conditions);
    await get(`/cohorts/${c.id}`, 2).expect(404);
    await post('/cohorts', { name: 'x', criteria: DEFAULT_CRITERIA }, 4).expect(403);
    await post('/cohorts', { name: 'x', criteria: { labs: 'nope' } }).expect(400);
  });
  it('POST campaigns/estimate → contacts/accepted/completed + 4 cost lines; AdTarget → 403', async () => {
    const e = (await post('/campaigns/estimate', { criteria: DEFAULT_CRITERIA, targetN: 100, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(200)).body as Estimate;
    expect(e.targetN).toBe(100);
    expect(e.contacts).toBeGreaterThan(0);
    expect(e.accepted).toBeLessThanOrEqual(e.contacts);
    expect(e.completed).toBeLessThanOrEqual(e.accepted);
    expect(e.costLines.map((l) => l.key)).toEqual(['participant_comp', 'devices_testing', 'data_preparation', 'platform_recruitment']);
    expect(e.totalCents).toBe(e.costLines.reduce((a, l) => a + l.cents, 0));
    expect(e.weeksHigh).toBe(e.weeksLow + 2);
    const saved = (await post('/cohorts', { name: 'c', criteria: DEFAULT_CRITERIA })).body as SavedCohortDetail;
    const e2 = (await post('/campaigns/estimate', { cohortId: saved.id, targetN: 100, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(200)).body as Estimate;
    expect(e2.contacts).toBe(e.contacts);
    await post('/campaigns/estimate', { criteria: DEFAULT_CRITERIA, targetN: 100, variables: DEFAULT_CAMPAIGN_VARIABLES }, 4).expect(403);
    await post('/campaigns/estimate', { criteria: DEFAULT_CRITERIA, targetN: 0, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(400);
    await post('/campaigns/estimate', { criteria: DEFAULT_CRITERIA, targetN: 10, variables: [{ conceptSlug: 'nope', mode: 'reuse', requirement: {}, compCents: 0, deviceCostCents: 0 }] }).expect(400);
    await post('/campaigns/estimate', { cohortId: 999999, targetN: 10, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(404);
  });
  it('GET search and GET ontology', async () => {
    const s = (await get('/search?q=blood').expect(200)).body as BuyerSearch;
    expect(s.results.some((r) => r.type === 'concept' && r.id === 'physiology.cardiovascular.blood_pressure')).toBe(true);
    expect(((await get('/search?q=').expect(200)).body as BuyerSearch).results).toEqual([]);
    const o = (await get('/ontology').expect(200)).body as OntologyResponse;
    expect(o.domains).toHaveLength(9);
    expect(o.conceptCount).toBeGreaterThan(80);
    const bp = o.domains.flatMap((d) => d.children.flatMap((g) => g.children)).find((l) => l.slug === 'physiology.cardiovascular.blood_pressure')!;
    expect(bp.compCents).toBe(11000);
    expect(bp.enrichable).toBe(true);
  });
});
