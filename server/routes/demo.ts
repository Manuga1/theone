import { Router } from 'express';
import { graph } from '../db/graph';
import { DEMO_NOW, DEMO_TODAY } from '@shared/clock';
import type { DemoState, Health } from '@shared/api-types';

export const demoRouter = Router();

function seeded(): boolean {
  const db = graph();
  if (!db.tableExists('participant')) return false;
  const r = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participant');
  return (r?.n ?? 0) > 0;
}

demoRouter.get('/health', (_req, res) => {
  const body: Health = { ok: true, ready: graph().tableExists('participant'), seeded: seeded() };
  res.json(body);
});

demoRouter.get('/demo/state', (req, res) => {
  const db = graph();
  const orgs = db.tableExists('buyer_org')
    ? db.all<{ id: number; name: string; type: string; declared_uses_json: string }>('SELECT id, name, type, declared_uses_json FROM buyer_org ORDER BY id')
        .map((o) => ({ id: o.id, name: o.name, type: o.type, declaredUses: JSON.parse(o.declared_uses_json) as string[] }))
    : [];
  const detailed = db.tableExists('participant') ? db.get<{ pseudonym: string }>('SELECT pseudonym FROM participant WHERE is_detailed = 1 ORDER BY id LIMIT 1') : undefined;
  const body: DemoState = {
    ready: db.tableExists('participant'),
    seeded: seeded(),
    persona: req.persona.kind === 'buyer' ? `buyer:${req.persona.orgId}` : 'participant',
    orgs,
    writeVersion: db.writeVersion,
    today: DEMO_TODAY,
    now: DEMO_NOW,
    participantPseudonym: detailed?.pseudonym ?? null,
  };
  res.json(body);
});
