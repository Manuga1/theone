// Crawls every buyer read endpoint and asserts no identity / quasi-identifier key ever appears, and that no buyer-side
// module (routes/buyer*, services/**) imports the identity vault.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { findForbiddenKey } from '../../server/middleware/noIdentity';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES } from '../../shared/ontology';
import { PERSONA_HEADER } from '../../shared/api-types';
import { seededDbs } from '../helpers/db';

const ROOT = path.resolve(__dirname, '..', '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('no identity leak on the buyer side', () => {
  let app: ReturnType<typeof createApp>;
  beforeAll(() => { seededDbs(); app = createApp(); });

  it('every buyer endpoint response is free of forbidden keys (deep)', async () => {
    const h = { [PERSONA_HEADER]: 'buyer:1' };
    const bodies: unknown[] = [];
    for (const url of ['/home', '/search?q=a', '/search?q=blood', '/cohorts', '/ontology']) {
      const r = await request(app).get(`/api/buyer${url}`).set(h).expect(200);
      bodies.push(r.body);
    }
    bodies.push((await request(app).post('/api/buyer/cohorts/preview').set(h).send(DEFAULT_CRITERIA).expect(200)).body);
    const saved = (await request(app).post('/api/buyer/cohorts').set(h).send({ name: 'leak-check', criteria: DEFAULT_CRITERIA }).expect(201)).body as { id: number };
    bodies.push(saved);
    bodies.push((await request(app).get(`/api/buyer/cohorts/${saved.id}`).set(h).expect(200)).body);
    bodies.push((await request(app).post('/api/buyer/campaigns/estimate').set(h).send({ criteria: DEFAULT_CRITERIA, targetN: 50, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(200)).body);
    // loop endpoints: studies (incl. the row-level participant list), campaigns, datasets (every tab), workspace, mutations
    const studies = (await request(app).get('/api/buyer/studies').set(h).expect(200)).body as { studies: { id: number; datasetId: number | null }[] };
    bodies.push(studies);
    const study = studies.studies.find((s) => s.datasetId)!;
    for (const url of [`/studies/${study.id}`, `/studies/${study.id}/participants`, `/studies/${study.id}/participants?limit=500&offset=0`, `/studies/${study.id}/variables/preview?concept=biology.microbiome.gut_microbiome&durationDays=1&minProvRank=3&targetN=20`, '/campaigns', '/datasets', `/datasets/${study.datasetId}`, `/datasets/${study.datasetId}/workspace`]) {
      bodies.push((await request(app).get(`/api/buyer${url}`).set(h).expect(200)).body);
    }
    for (const tab of ['variables', 'documentation', 'provenance', 'missingness', 'longitudinal', 'ontology']) bodies.push((await request(app).get(`/api/buyer/datasets/${study.datasetId}?tab=${tab}`).set(h).expect(200)).body);
    const campaigns = (await request(app).get('/api/buyer/campaigns').set(h).expect(200)).body as { campaigns: { id: number }[] };
    bodies.push((await request(app).get(`/api/buyer/campaigns/${campaigns.campaigns[0].id}`).set(h).expect(200)).body);
    bodies.push((await request(app).post(`/api/buyer/studies/${study.id}/advance`).set(h).send({ days: 3 }).expect(200)).body);
    bodies.push((await request(app).post(`/api/buyer/studies/${study.id}/recontact`).set(h).expect(200)).body);
    bodies.push((await request(app).post(`/api/buyer/studies/${study.id}/variables`).set(h).send({ concept: 'biology.microbiome.gut_microbiome', protocol: { method: 'kit', durationDays: 1 }, minProvRank: 3, targetN: 20, compCents: 9000 }).expect(201)).body);
    bodies.push((await request(app).post(`/api/buyer/datasets/${study.datasetId}/refresh`).set(h).expect(200)).body);
    bodies.push((await request(app).post(`/api/buyer/datasets/${study.datasetId}/export-request`).set(h).send({}).expect(201)).body);
    const draft = (await request(app).post('/api/buyer/campaigns').set(h).send({ cohortId: saved.id, name: 'leak campaign', purpose: 'leak', targetN: 25, variables: DEFAULT_CAMPAIGN_VARIABLES, licenseTermMonths: 12, useTags: [] }).expect(201)).body as { id: number };
    bodies.push(draft);
    bodies.push((await request(app).post(`/api/buyer/campaigns/${draft.id}/launch`).set(h).expect(200)).body);
    expect(bodies.length).toBeGreaterThan(25);
    for (const b of bodies) expect(findForbiddenKey(b)).toBeNull();
    const text = JSON.stringify(bodies);
    for (const s of ['Alex Morgan', 'alex.morgan@example.com', '555-0142', '1978-06-14', 'P-7f3a9c1e2b']) expect(text).not.toContain(s);
  });
  it('the identity guard rejects a leaking payload', async () => {
    expect(findForbiddenKey({ rows: [{ ok: 1, nested: { birth_year: 1978 } }] })).toBe('.rows[0].nested.birth_year');
    expect(findForbiddenKey({ pseudonymCount: 3 })).toBeNull();
  });
  it('no buyer route or service imports db/vault', () => {
    const files = [...walk(path.join(ROOT, 'server', 'services')), ...walk(path.join(ROOT, 'server', 'routes')).filter((f) => path.basename(f).startsWith('buyer'))];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(/from\s+['"][^'"]*db\/vault['"]/.test(src), `${path.relative(ROOT, f)} imports the vault`).toBe(false);
      expect(/require\(['"][^'"]*db\/vault['"]\)/.test(src), `${path.relative(ROOT, f)} requires the vault`).toBe(false);
    }
    const participant = readFileSync(path.join(ROOT, 'server', 'routes', 'participant.ts'), 'utf8');
    expect(/from\s+['"]\.\.\/db\/vault['"]/.test(participant)).toBe(true);
  });
});
