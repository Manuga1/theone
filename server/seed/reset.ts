// Demo reset (lives in seed/ because it must touch the identity vault). Restores the seed snapshot kept in the database
// (fast, server-side) when one of the requested scale exists; otherwise regenerates: tests' in-memory databases are
// replaced by fresh instances, any other database (local PGlite, Supabase) is re-published in place.
import { performance } from 'node:perf_hooks';
import type { DemoResetInput, DemoResetResult } from '@shared/api-types';
import { PgliteDb } from '../db/driver';
import { graph, useGraph } from '../db/graph';
import { HOSTED } from '../db/paths';
import { migrate } from '../db/migrate';
import { badRequest } from '../errors';
import { seedAll } from './index';
import { participantCount, publishSeed, restoreSnapshot, saveSnapshot, snapshotInfo } from './snapshot';
import { invalidateCohortCache } from '../services/cohort';

let running = false;

export async function resetDemo(input: DemoResetInput = {}): Promise<DemoResetResult> {
  if (running) throw badRequest('a reset is already running');
  const old = graph();
  const snap = await snapshotInfo(old);
  const fallbackScale = process.env.SEED_SCALE ? Number(process.env.SEED_SCALE) : 1;
  const scale = input.scale === undefined ? (snap?.scale ?? fallbackScale) : Number(input.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw badRequest('scale must be in (0, 1]');
  const schemaOnly = !!input.schemaOnly || process.env.SEED_DISABLED === '1';
  // the hosted demo only ever restores its own snapshot: regenerating (another scale) inside a 60 s serverless function
  // could time out or outgrow the database plan. Reseed a deployment with SEED_SCALE + SEED_FORCE=1 on a build instead.
  if (HOSTED && snap && (scale !== snap.scale || schemaOnly !== snap.schemaOnly)) {
    throw badRequest(`this deployment resets to its seed snapshot (scale ${snap.scale}); reseed it with SEED_SCALE and SEED_FORCE=1 on a redeploy`);
  }
  running = true;
  const t0 = performance.now();
  try {
    if (snap && snap.scale === scale && snap.schemaOnly === schemaOnly) {
      await restoreSnapshot(old);
    } else if (old instanceof PgliteDb && old.label === 'pglite:memory') {
      const next = await PgliteDb.open();
      await migrate(next);
      await seedAll({ graph: next, vault: next, scale, schemaOnly });
      await saveSnapshot(next, { scale, schemaOnly });
      useGraph(next);
      await old.close();
    } else {
      await publishSeed(old, { scale, schemaOnly });
    }
    const db = graph();
    invalidateCohortCache(db);
    const participants = await participantCount(db);
    return { ok: true, writeVersion: await db.version(), seeded: participants > 0, participants, ms: Math.round(performance.now() - t0) };
  } finally {
    running = false;
  }
}
