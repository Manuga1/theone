import { Router } from 'express';
import { graph } from '../db/graph';
import { HOSTED } from '../db/paths';
import { DEMO_NOW, DEMO_TODAY } from '@shared/clock';
import type { DemoResetInput, DemoResetResult, DemoState, Health } from '@shared/api-types';
import { resetDemo } from '../seed/reset';

export const demoRouter = Router();

async function seeded(): Promise<boolean> {
  const db = graph();
  if (!await db.tableExists('participant')) return false;
  const r = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participant');
  return (r?.n ?? 0) > 0;
}

demoRouter.get('/health', async (_req, res) => {
  const body: Health = { ok: true, ready: await graph().tableExists('participant'), seeded: await seeded() };
  res.json(body);
});

demoRouter.get('/demo/state', async (req, res) => {
  const db = graph();
  const orgs = await db.tableExists('buyer_org')
    ? (await db.all<{ id: number; name: string; type: string; declared_uses_json: string }>('SELECT id, name, type, declared_uses_json FROM buyer_org ORDER BY id'))
        .map((o) => ({ id: o.id, name: o.name, type: o.type, declaredUses: JSON.parse(o.declared_uses_json) as string[] }))
    : [];
  const detailed = await db.tableExists('participant') ? await db.get<{ pseudonym: string }>('SELECT pseudonym FROM participant WHERE is_detailed = 1 ORDER BY id LIMIT 1') : undefined;
  const body: DemoState = {
    ready: await db.tableExists('participant'),
    seeded: await seeded(),
    persona: req.persona.kind === 'buyer' ? `buyer:${req.persona.orgId}` : 'participant',
    orgs,
    writeVersion: (await db.version()),
    today: DEMO_TODAY,
    now: DEMO_NOW,
    participantPseudonym: detailed?.pseudonym ?? null,
    hosted: HOSTED,
  };
  res.json(body);
});

/** Wipe + reseed in-process (the UI's "Reset demo" button). Body: { scale?, schemaOnly? }. */
demoRouter.post('/demo/reset', async (req, res) => {
  const body: DemoResetResult = await resetDemo((req.body ?? {}) as DemoResetInput);
  res.json(body);
});
