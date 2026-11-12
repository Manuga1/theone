// Hosted-deployment behaviour, switched on in tests with SIMULATE_HOSTED=1 (server/db/paths.ts isHosted()):
// reset and advance need the admin token header; the classifier is the rule engine; the error log line carries
// method, path, status and message only.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp, errorHandler, errorLogLine } from '../../server/index';
import { isHosted } from '../../server/db/paths';
import { classifierName, resetClassifier } from '../../server/services/classify';
import { ADMIN_HEADER } from '../../shared/brand';
import { PERSONA_HEADER, type AdvanceResult, type DemoResetResult, type DemoState, type StudyList } from '../../shared/api-types';
import { seededDbs } from '../helpers/db';

const ENV_KEYS = ['SIMULATE_HOSTED', 'DEMO_ADMIN_TOKEN', 'HOSTED_CLASSIFIER', 'CLASSIFIER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};
function setEnv(patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  resetClassifier();
}

describe('hosted deployment', () => {
  let app: ReturnType<typeof createApp>;
  let studyId: number;
  const buyer = { [PERSONA_HEADER]: 'buyer:1' };
  const state = async () => (await request(app).get('/api/demo/state').expect(200)).body as DemoState;
  const reset = (token?: string) => {
    const r = request(app).post('/api/demo/reset');
    return (token === undefined ? r : r.set(ADMIN_HEADER, token)).send({ scale: 0.05 });
  };
  const advance = (token?: string) => {
    const r = request(app).post(`/api/buyer/studies/${studyId}/advance`).set(buyer);
    return (token === undefined ? r : r.set(ADMIN_HEADER, token)).send({ days: 3 });
  };
  const activeStudy = async () => ((await request(app).get('/api/buyer/studies').set(buyer).expect(200)).body as StudyList).studies.find((s) => s.status === 'active')!.id;

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    setEnv({ SIMULATE_HOSTED: undefined, DEMO_ADMIN_TOKEN: undefined, HOSTED_CLASSIFIER: undefined, CLASSIFIER: 'rules', ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });
    await seededDbs();
    app = createApp();
    studyId = await activeStudy();
  });
  afterEach(() => {
    setEnv({ SIMULATE_HOSTED: undefined, DEMO_ADMIN_TOKEN: undefined, HOSTED_CLASSIFIER: undefined, CLASSIFIER: 'rules', ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });
    vi.restoreAllMocks();
  });
  afterAll(() => {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    resetClassifier();
  });

  it('not hosted: state says so, and reset / advance work without a token (and ignore one)', async () => {
    expect(isHosted()).toBe(false);
    expect(await state()).toMatchObject({ hosted: false, adminRequired: false, classifier: 'rules' });
    const adv = (await advance().expect(200)).body as AdvanceResult;
    expect(adv.days).toBe(3);
    await advance('anything').expect(200);
    const r = (await reset().expect(200)).body as DemoResetResult;
    expect(r.ok).toBe(true);
    studyId = await activeStudy();
    // a token configured on a machine that is not hosted changes nothing
    setEnv({ DEMO_ADMIN_TOKEN: 'secret-token' });
    await advance().expect(200);
    expect((await state()).adminRequired).toBe(false);
  });

  it('hosted with a token configured: 403 without the header, 403 with a wrong token, 200 with the right one', async () => {
    setEnv({ SIMULATE_HOSTED: '1', DEMO_ADMIN_TOKEN: 'secret-token' });
    expect(isHosted()).toBe(true);
    expect(await state()).toMatchObject({ hosted: true, adminRequired: true });
    const before = (await state()).writeVersion;

    for (const call of [reset, advance]) {
      const none = await call();
      expect(none.status).toBe(403);
      expect(none.body).toMatchObject({ code: 'admin_required' });
      expect((none.body as { error: string }).error).toContain(ADMIN_HEADER);
      const wrong = await call('wrong-token');
      expect(wrong.status).toBe(403);
      expect(wrong.body).toMatchObject({ code: 'admin_required', error: 'The admin token is not valid.' });
      expect((await call('')).status).toBe(403);
      expect((await call('secret-token-and-more')).status).toBe(403);
      // the token is never echoed back
      expect(JSON.stringify(none.body) + JSON.stringify(wrong.body)).not.toContain('secret-token');
    }
    expect((await state()).writeVersion).toBe(before); // refusals changed nothing

    const adv = (await advance('secret-token').expect(200)).body as AdvanceResult;
    expect(adv.days).toBe(3);
    const r = (await reset('secret-token').expect(200)).body as DemoResetResult;
    expect(r.ok).toBe(true);
    studyId = await activeStudy();
  });

  it('hosted with no token configured: always refused, whatever the header says', async () => {
    setEnv({ SIMULATE_HOSTED: '1', DEMO_ADMIN_TOKEN: undefined });
    for (const call of [reset, advance]) {
      for (const token of [undefined, '', 'undefined', 'secret-token']) {
        const r = await call(token);
        expect(r.status).toBe(403);
        expect(r.body).toMatchObject({ code: 'admin_required' });
        expect((r.body as { error: string }).error).toContain('switched off');
      }
    }
    setEnv({ DEMO_ADMIN_TOKEN: '' }); // an empty token is no token
    expect((await reset('')).status).toBe(403);
  });

  it('hosted: only reset and advance are gated; reading and the participant / buyer flows are not', async () => {
    setEnv({ SIMULATE_HOSTED: '1', DEMO_ADMIN_TOKEN: 'secret-token' });
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/participant/home').expect(200);
    await request(app).get(`/api/buyer/studies/${studyId}`).set(buyer).expect(200);
  });

  it('classifier: hosted is always rules unless HOSTED_CLASSIFIER=claude; local keeps today\'s behaviour', async () => {
    // local, credential present, no override → claude (client constructed only; nothing is sent)
    setEnv({ CLASSIFIER: undefined, ANTHROPIC_API_KEY: 'test-key-not-real' });
    expect(classifierName()).toBe('claude');
    // hosted, same credential → rules
    setEnv({ SIMULATE_HOSTED: '1' });
    expect(classifierName()).toBe('rules');
    expect((await state()).classifier).toBe('rules');
    // hosted, CLASSIFIER=claude does not lift it either
    setEnv({ CLASSIFIER: 'claude' });
    expect(classifierName()).toBe('rules');
    // hosted, explicit opt-in → claude
    setEnv({ CLASSIFIER: undefined, HOSTED_CLASSIFIER: 'claude' });
    expect(classifierName()).toBe('claude');
    // hosted, opt-in, but CLASSIFIER=rules still wins
    setEnv({ CLASSIFIER: 'rules' });
    expect(classifierName()).toBe('rules');
    // hosted, opt-in, no credential → rules
    setEnv({ CLASSIFIER: undefined, ANTHROPIC_API_KEY: undefined });
    expect(classifierName()).toBe('rules');
    // any other value of HOSTED_CLASSIFIER is not an opt-in
    setEnv({ HOSTED_CLASSIFIER: 'yes', ANTHROPIC_API_KEY: 'test-key-not-real' });
    expect(classifierName()).toBe('rules');
  });

  it('hosted quick log files by rules even with a credential present', async () => {
    setEnv({ SIMULATE_HOSTED: '1', CLASSIFIER: undefined, ANTHROPIC_API_KEY: 'test-key-not-real' });
    const r = await request(app).post('/api/participant/log').send({ text: 'blood pressure 120/80 this morning' }).expect(200);
    expect(JSON.stringify(r.body)).toContain('"classifier":"rules"');
    expect(JSON.stringify(r.body)).not.toContain('"classifier":"claude"');
  });

  it('error log line: method, path, status and message only — never body, headers or query string', async () => {
    expect(errorLogLine({ method: 'POST', originalUrl: '/api/x?token=QUERY-SECRET' }, 500, 'boom\n  at somewhere')).toBe('[api] POST /api/x 500 boom at somewhere');
    const lines: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { lines.push(args); });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { lines.push(args); });
    const probe = express();
    probe.use(express.json());
    probe.post('/api/explode', () => { throw new Error('database unavailable'); });
    probe.post('/api/teapot', () => { throw Object.assign(new Error('bad input'), { status: 400 }); });
    probe.use(errorHandler);
    const r = await request(probe).post('/api/explode?q=QUERY-SECRET').set('authorization', 'Bearer HEADER-SECRET').set(ADMIN_HEADER, 'ADMIN-SECRET').send({ note: 'BODY-SECRET' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'database unavailable' });
    expect(lines).toEqual([['[api] POST /api/explode 500 database unavailable']]);
    // 4xx are answered but not logged
    await request(probe).post('/api/teapot').send({ note: 'BODY-SECRET' }).expect(400);
    expect(lines).toHaveLength(1);
    // the real app: malformed JSON (body-parser attaches the raw body to its error) and refused admin calls log nothing
    setEnv({ SIMULATE_HOSTED: '1', DEMO_ADMIN_TOKEN: 'secret-token' });
    await request(app).post('/api/participant/log').set('content-type', 'application/json').send('{"text": "BODY-SECRET"').expect(400);
    await reset('wrong-token').expect(403);
    expect(JSON.stringify(lines)).not.toMatch(/SECRET|secret-token|wrong-token/);
  });
});
