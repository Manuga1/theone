// Demo reset (lives in seed/ because it must touch the identity vault): wipe and reseed in-process, leaving the server usable. File-backed databases are rebuilt in temp files and
// swapped atomically; in-memory databases (tests) are replaced by fresh in-memory instances.
import { existsSync, renameSync, rmSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { DemoResetInput, DemoResetResult } from '@shared/api-types';
import { Db } from '../db/driver';
import { graph, useGraph } from '../db/graph';
import { migrateGraph, migrateVault } from '../db/migrate';
import { GRAPH_PATH, VAULT_PATH } from '../db/paths';
import { useVault, vault } from '../db/vault';
import { badRequest } from '../errors';
import { seedAll } from './index';
import { invalidateCohortCache } from '../services/cohort';

let running = false;

export function resetDemo(input: DemoResetInput = {}): DemoResetResult {
  if (running) throw badRequest('a reset is already running');
  const scale = input.scale === undefined ? 1 : Number(input.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw badRequest('scale must be in (0, 1]');
  const schemaOnly = !!input.schemaOnly || process.env.SEED_DISABLED === '1';
  running = true;
  const t0 = performance.now();
  try {
    const g = graph();
    const v = vault();
    if (g.path === ':memory:') {
      const ng = new Db(':memory:');
      const nv = new Db(':memory:');
      migrateGraph(ng);
      migrateVault(nv);
      seedAll({ graph: ng, vault: nv, scale, schemaOnly });
      useGraph(ng);
      useVault(nv);
      g.close();
      v.close();
    } else {
      const tmpG = `${GRAPH_PATH}.reset`;
      const tmpV = `${VAULT_PATH}.reset`;
      const clean = (f: string) => { for (const s of ['', '-wal', '-shm', '-journal']) rmSync(f + s, { force: true }); };
      clean(tmpG); clean(tmpV);
      const ng = new Db(tmpG);
      const nv = new Db(tmpV);
      migrateGraph(ng);
      migrateVault(nv);
      seedAll({ graph: ng, vault: nv, scale, schemaOnly });
      ng.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      nv.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      ng.close();
      nv.close();
      g.close();
      v.close();
      useGraph(null);
      useVault(null);
      clean(GRAPH_PATH); clean(VAULT_PATH);
      renameSync(tmpG, GRAPH_PATH);
      renameSync(tmpV, VAULT_PATH);
      clean(tmpG); clean(tmpV); // leftover -wal/-shm of the temp files
    }
    const db = graph();
    invalidateCohortCache(db);
    const participants = db.tableExists('participant') ? (db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participant')?.n ?? 0) : 0;
    return { ok: true, writeVersion: db.writeVersion, seeded: participants > 0, participants, ms: Math.round(performance.now() - t0) };
  } finally {
    running = false;
  }
}

export function dataFilesExist(): boolean {
  return existsSync(GRAPH_PATH);
}
