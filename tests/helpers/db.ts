// Test helper: in-memory graph + vault databases seeded at a small scale and injected into the app singletons.
import { Db } from '../../server/db/driver';
import { migrateGraph, migrateVault } from '../../server/db/migrate';
import { useGraph } from '../../server/db/graph';
import { useVault } from '../../server/db/vault';
import { seedAll, type SeedReport } from '../../server/seed/index';
import { invalidateCohortCache } from '../../server/services/cohort';

export const TEST_SCALE = 0.05;

export type TestDbs = { graph: Db; vault: Db; report: SeedReport };

export function seededDbs(opts: { scale?: number; schemaOnly?: boolean } = {}): TestDbs {
  const graph = new Db(':memory:');
  const vault = new Db(':memory:');
  migrateGraph(graph);
  migrateVault(vault);
  const report = seedAll({ graph, vault, scale: opts.scale ?? TEST_SCALE, schemaOnly: opts.schemaOnly });
  useGraph(graph);
  useVault(vault);
  invalidateCohortCache(graph);
  return { graph, vault, report };
}

export function alexId(graph: Db): number {
  return graph.get<{ id: number }>('SELECT id FROM participant WHERE is_detailed = 1')!.id;
}
