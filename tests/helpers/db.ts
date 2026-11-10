// Test helper: one in-memory PGlite (Postgres) database seeded at a small scale and injected into the app singletons.
// The identity vault is the `identity` table of the same database, so `vault` is the same handle as `graph`.
// With TEST_DATABASE_URL set, the same suite runs against that real Postgres server (node-postgres path, as on Supabase):
// the seed is published into it (its contents are replaced).
import { PgDb, PgliteDb, type Db } from '../../server/db/driver';
import { migrate } from '../../server/db/migrate';
import { graph as currentGraph, useGraph } from '../../server/db/graph';
import { useVault } from '../../server/db/vault';
import { seedAll, type SeedReport } from '../../server/seed/index';
import { publishSeed, saveSnapshot } from '../../server/seed/snapshot';
import { invalidateCohortCache } from '../../server/services/cohort';

export const TEST_SCALE = 0.05;

export type TestDbs = { graph: Db; vault: Db; report: SeedReport };

export async function seededDbs(opts: { scale?: number; schemaOnly?: boolean } = {}): Promise<TestDbs> {
  if (process.env.TEST_DATABASE_URL) {
    const pg = new PgDb(process.env.TEST_DATABASE_URL);
    const scale = opts.scale ?? TEST_SCALE;
    const report = await publishSeed(pg, { scale, schemaOnly: opts.schemaOnly });
    useGraph(pg);
    useVault(null);
    invalidateCohortCache(pg);
    return { graph: pg, vault: pg, report };
  }
  const graph = await PgliteDb.open();
  await migrate(graph);
  const scale = opts.scale ?? TEST_SCALE;
  const report = await seedAll({ graph, vault: graph, scale, schemaOnly: opts.schemaOnly });
  await saveSnapshot(graph, { scale, schemaOnly: !!opts.schemaOnly });
  useGraph(graph);
  useVault(null);
  invalidateCohortCache(graph);
  return { graph, vault: graph, report };
}

export async function alexId(graph: Db = currentGraph()): Promise<number> {
  return (await graph.get<{ id: number }>('SELECT id FROM participant WHERE is_detailed = 1'))!.id;
}
