// The one banned-uses list (shared/ontology.ts PROHIBITED_USES): eleven fixed red-lines. An organisation declaring any
// of them sees zero participants and cannot create cohorts, estimates or campaigns — the four uses added for the
// go-to-market plan (housing, political targeting, litigation, gambling) behave exactly like advertising always has.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES, PROHIBITED_USES, PROHIBITED_USE_KEYS } from '../../shared/ontology';
import { PERSONA_HEADER, type BuyerHome, type CohortPreview, type ParticipantPermissions, type SavedCohortDetail } from '../../shared/api-types';
import { nowIso } from '../../shared/clock';
import { seededDbs, type TestDbs } from '../helpers/db';

const ADDED = ['housing', 'political_targeting', 'litigation', 'gambling_targeting'];
const ZERO_TILES = { availableParticipants: 0, longitudinalProfiles: 0, genomicsAvailable: 0, recontactable: 0 };

describe('banned uses', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  const orgIds: Record<string, number> = {};
  let cohortId: number;
  const as = (org: number) => ({ [PERSONA_HEADER]: `buyer:${org}` });
  const get = (url: string, org = 1) => request(app).get(`/api/buyer${url}`).set(as(org));
  const post = (url: string, body: unknown, org = 1) => request(app).post(`/api/buyer${url}`).set(as(org)).send(body as object);

  beforeAll(async () => {
    t = await seededDbs();
    app = createApp();
    // test-only organisations, one per added use (the seed keeps its four organisations)
    for (const use of ADDED) {
      orgIds[use] = (await t.graph.run('INSERT INTO buyer_org (name, type, declared_uses_json, created_at) VALUES (?,?,?,?)', `Test org declaring ${use}`, 'other', JSON.stringify(['market_research', use]), nowIso())).lastId;
    }
    cohortId = ((await post('/cohorts', { name: 'banned-uses cohort', criteria: DEFAULT_CRITERIA }).expect(201)).body as SavedCohortDetail).id;
  });

  it('the list has the seven original keys plus the four added ones, each with a label', () => {
    expect(PROHIBITED_USE_KEYS).toEqual(['advertising', 'insurance_underwriting', 'employment_screening', 'law_enforcement', 're_identification', 'data_brokerage', 'credit_scoring', ...ADDED]);
    expect(new Set(PROHIBITED_USE_KEYS).size).toBe(11);
    const label = (k: string) => PROHIBITED_USES.find((p) => p.key === k)!.label;
    expect(label('housing')).toBe('Housing or tenancy decisions');
    expect(label('political_targeting')).toBe('Political targeting or profiling');
    expect(label('litigation')).toBe('Litigation or legal claims against participants');
    expect(label('gambling_targeting')).toBe('Gambling or targeting of behavioural vulnerability');
  });

  it('every participant carries all eleven red-lines (seeded consent settings and the permissions view)', async () => {
    const rows = await t.graph.all<{ prohibited_uses_json: string; n: number }>('SELECT prohibited_uses_json, COUNT(*) AS n FROM consent_setting GROUP BY prohibited_uses_json');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].prohibited_uses_json)).toEqual(PROHIBITED_USE_KEYS);
    const p = (await request(app).get('/api/participant/permissions').expect(200)).body as ParticipantPermissions;
    expect(p.prohibitedUses.map((u) => u.key)).toEqual(PROHIBITED_USE_KEYS);
    expect(p.prohibitedUses.every((u) => u.fixed)).toBe(true);
  });

  for (const use of ADDED) {
    it(`an organisation declaring '${use}' gets zero counts and 403 on cohort, estimate and campaign creation`, async () => {
      const org = orgIds[use];
      const home = (await get('/home', org).expect(200)).body as BuyerHome;
      expect(home.tiles).toEqual(ZERO_TILES);
      const preview = (await post('/cohorts/preview', DEFAULT_CRITERIA, org).expect(200)).body as CohortPreview;
      expect(preview.consent.blocked).toBe(true);
      expect(preview.consent.reason).toContain(use.replace(/_/g, ' '));
      expect(preview.funnel.every((f) => f.n === 0)).toBe(true);
      expect(preview.readyNow).toBe(0);
      await post('/cohorts', { name: 'x', criteria: DEFAULT_CRITERIA }, org).expect(403);
      await post('/campaigns/estimate', { criteria: DEFAULT_CRITERIA, targetN: 100, variables: DEFAULT_CAMPAIGN_VARIABLES }, org).expect(403);
      const r = await post('/campaigns', { cohortId, name: 'x', purpose: 'x', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES }, org);
      expect(r.status).toBe(403);
      expect((r.body as { code?: string }).code).toBe('forbidden');
    });
  }

  it('the advertising organisation is still blocked the same way; a research organisation is not', async () => {
    expect(((await get('/home', 4).expect(200)).body as BuyerHome).tiles).toEqual(ZERO_TILES);
    await post('/campaigns', { cohortId, name: 'x', purpose: 'x', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES }, 4).expect(403);
    const ok = (await post('/cohorts/preview', DEFAULT_CRITERIA).expect(200)).body as CohortPreview;
    expect(ok.consent.blocked).toBe(false);
    expect(ok.readyNow).toBeGreaterThan(0);
  });

  it('a permitted organisation cannot tag a single campaign with a banned use', async () => {
    const campaigns = async () => Number((await t.graph.get<{ n: number }>('SELECT COUNT(*) AS n FROM campaign'))!.n);
    const before = await campaigns();
    for (const use of ['litigation', 'gambling_targeting', 'advertising']) {
      await post('/campaigns', { cohortId, name: 'x', purpose: 'x', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES, licenseTermMonths: 12, useTags: ['clinical_research', use] }).expect(403);
    }
    expect(await campaigns()).toBe(before);
    await post('/campaigns', { cohortId, name: 'permitted', purpose: 'x', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES, licenseTermMonths: 12, useTags: ['clinical_research'] }).expect(201);
    expect(await campaigns()).toBe(before + 1);
  });
});
