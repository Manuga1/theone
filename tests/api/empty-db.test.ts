// The app must run against a schema-only database: every GET route returns 200 with empty/zero data, never 500.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { PERSONA_HEADER, type BuyerHome, type CohortPreview, type DemoState, type Health, type ParticipantHome } from '../../shared/api-types';
import { seededDbs } from '../helpers/db';

describe('empty (schema-only) database', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(() => { seededDbs({ schemaOnly: true }); app = createApp(); });

  it('health / state report ready but not seeded', async () => {
    const h = (await request(app).get('/api/health').expect(200)).body as Health;
    expect(h).toMatchObject({ ok: true, ready: true, seeded: false });
    const s = (await request(app).get('/api/demo/state').expect(200)).body as DemoState;
    expect(s.seeded).toBe(false);
    expect(s.participantPseudonym).toBeNull();
    expect(s.orgs).toEqual([]);
  });
  it('every participant GET route → 200 with empty data', async () => {
    for (const url of ['/home', '/signature', '/timeline', '/timeline?category=labs', '/sources', '/missing', '/opportunities', '/opportunities?tab=past', '/ledger', '/permissions', '/profile']) {
      const r = await request(app).get(`/api/participant${url}`);
      expect(r.status, url).toBe(200);
    }
    const home = (await request(app).get('/api/participant/home')).body as ParticipantHome;
    expect(home.empty).toBe(true);
    expect(home.completeness.pct).toBe(0);
    expect(home.ring).toEqual([]);
    // row-level routes answer 404 (not 500) when there is no participant
    expect((await request(app).get('/api/participant/nodes/physiology.cardiovascular.blood_pressure')).status).toBe(404);
    expect((await request(app).get('/api/participant/opportunities/1')).status).toBe(404);
    expect((await request(app).post('/api/participant/sources/1/connect')).status).toBe(404);
    for (const url of ['/opportunities/1/view', '/opportunities/1/accept', '/contributions/1/simulate', '/enrollments/1/withdraw', '/licenses/1/revoke']) {
      expect((await request(app).post(`/api/participant${url}`)).status, url).toBe(404);
    }
    expect((await request(app).delete('/api/participant/categories/imaging')).status).toBe(404);
  });
  it('every buyer GET route → 200 with zero counts; preview is all zeros', async () => {
    const h = { [PERSONA_HEADER]: 'buyer:1' };
    for (const url of ['/home', '/search?q=bp', '/cohorts', '/ontology', '/studies', '/campaigns', '/datasets']) {
      const r = await request(app).get(`/api/buyer${url}`).set(h);
      expect(r.status, url).toBe(200);
    }
    expect(((await request(app).get('/api/buyer/studies').set(h)).body as { studies: unknown[] }).studies).toEqual([]);
    expect(((await request(app).get('/api/buyer/campaigns').set(h)).body as { campaigns: unknown[] }).campaigns).toEqual([]);
    expect(((await request(app).get('/api/buyer/datasets').set(h)).body as { datasets: unknown[] }).datasets).toEqual([]);
    for (const url of ['/studies/1', '/studies/1/participants', '/studies/1/variables/preview?concept=x&targetN=5', '/campaigns/1', '/datasets/1', '/datasets/1/workspace']) {
      expect((await request(app).get(`/api/buyer${url}`).set(h)).status, url).toBe(404);
    }
    for (const url of ['/studies/1/advance', '/studies/1/recontact', '/studies/1/variables', '/campaigns/1/launch', '/datasets/1/refresh', '/datasets/1/export-request']) {
      expect((await request(app).post(`/api/buyer${url}`).set(h).send({ days: 1 })).status, url).toBe(404);
    }
    expect((await request(app).post('/api/buyer/campaigns').set(h).send({ cohortId: 1, targetN: 5, variables: [] })).status).toBe(404); // no cohort exists
    const home = (await request(app).get('/api/buyer/home').set(h)).body as BuyerHome;
    expect(home.tiles).toEqual({ availableParticipants: 0, longitudinalProfiles: 0, genomicsAvailable: 0, recontactable: 0 });
    expect(home.counts).toEqual({ studies: 0, datasets: 0, campaigns: 0 });
    const p = (await request(app).post('/api/buyer/cohorts/preview').set(h).send(DEFAULT_CRITERIA).expect(200)).body as CohortPreview;
    expect(p.total).toBe(0);
    expect(p.funnel.every((f) => f.n === 0)).toBe(true);
    expect(p.readyNow).toBe(0);
    expect((await request(app).get('/api/buyer/cohorts/1').set(h)).status).toBe(404);
  });
});
