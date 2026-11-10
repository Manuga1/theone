// Seed publishing and the "Reset demo" snapshot (lives in seed/ because it copies the identity table too).
//
//  • publishSeed: builds the synthetic dataset in a throwaway in-memory PGlite (fast, in-process), then bulk-copies every
//    table into the target database (Supabase or the local PGlite) with COPY, inside one transaction.
//  • A pristine copy of every table is kept in the `seed_snapshot` schema; Reset demo restores from it server-side
//    (TRUNCATE + INSERT … SELECT) in a few seconds instead of regenerating the data inside a serverless function.
import { performance } from 'node:perf_hooks';
import { PgliteDb, type Db } from '../db/driver';
import { appTables, migrate } from '../db/migrate';
import { seedAll, type SeedReport } from './index';

export type SnapshotInfo = { scale: number; schemaOnly: boolean; at: string };
const LOCK = 7_302_114; // pg_advisory_xact_lock key shared by publish / restore

async function meta(db: Db, key: string): Promise<string | null> {
  if (!(await db.tableExists('app_meta'))) return null;
  return (await db.get<{ value: string }>('SELECT value FROM app_meta WHERE key = ?', key))?.value ?? null;
}
async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', key, value);
}

export async function snapshotInfo(db: Db): Promise<SnapshotInfo | null> {
  const raw = await meta(db, 'seed_snapshot');
  if (!raw) return null;
  const exists = await db.get<{ t: string | null }>("SELECT to_regclass('seed_snapshot.participant') AS t");
  return exists?.t ? (JSON.parse(raw) as SnapshotInfo) : null;
}

/** Number of participants in the live tables (0 when the schema is missing). */
export async function participantCount(db: Db): Promise<number> {
  if (!(await db.tableExists('participant'))) return 0;
  return (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participant'))?.n ?? 0;
}

async function resetSequences(db: Db, tables: string[]): Promise<void> {
  for (const t of tables) {
    const seq = await db.get<{ s: string | null }>(
      "SELECT pg_get_serial_sequence(?, 'id') AS s FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = 'id'", `public.${t}`, t);
    if (!seq?.s) continue;
    await db.get(`SELECT setval(?, GREATEST((SELECT MAX(id) FROM public.${t}), 1), (SELECT MAX(id) FROM public.${t}) IS NOT NULL)`, seq.s);
  }
}

/** Copies the live tables into seed_snapshot (replacing any previous snapshot). */
export async function saveSnapshot(db: Db, info: Omit<SnapshotInfo, 'at'>): Promise<void> {
  const tables = appTables();
  await db.tx(async () => {
    await db.exec(`SELECT pg_advisory_xact_lock(${LOCK})`);
    await db.exec('DROP SCHEMA IF EXISTS seed_snapshot CASCADE; CREATE SCHEMA seed_snapshot');
    for (const t of tables) await db.exec(`CREATE TABLE seed_snapshot.${t} AS TABLE public.${t}`);
    await db.exec(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA seed_snapshot FROM anon, authenticated';
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA seed_snapshot FROM anon, authenticated';
      END IF; END $$`);
    await setMeta(db, 'seed_snapshot', JSON.stringify({ ...info, at: new Date().toISOString() }));
  });
}

/** Reset demo: live tables ← seed_snapshot, atomically. Concurrent resets queue on the advisory lock. */
export async function restoreSnapshot(db: Db): Promise<void> {
  const tables = appTables();
  await db.tx(async () => {
    await db.exec(`SELECT pg_advisory_xact_lock(${LOCK})`);
    await db.exec(`TRUNCATE ${tables.map((t) => `public.${t}`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of tables) await db.exec(`INSERT INTO public.${t} SELECT * FROM seed_snapshot.${t}`);
    await resetSequences(db, tables);
    await db.run("UPDATE app_meta SET value = value WHERE key = 'write_version'"); // marks the transaction as a write (bumps the counter)
  });
  await db.exec('ANALYZE');
}

export type PublishOptions = { scale: number; schemaOnly?: boolean; seed?: string; log?: (s: string) => void };

/** Generate the synthetic dataset in memory and replace the target database's contents with it; then snapshot it. */
export async function publishSeed(target: Db, opts: PublishOptions): Promise<SeedReport> {
  const log = opts.log ?? (() => {});
  const t0 = performance.now();
  const src = await PgliteDb.open();
  try {
    await migrate(src);
    const report = await seedAll({ graph: src, vault: src, scale: opts.scale, schemaOnly: opts.schemaOnly, seed: opts.seed, log });
    log(`[publish] copying into ${target.label}`);
    await migrate(target);
    const tables = appTables();
    await target.tx(async () => {
      await target.exec(`SELECT pg_advisory_xact_lock(${LOCK})`);
      await target.exec(`TRUNCATE ${tables.map((t) => `public.${t}`).join(', ')} RESTART IDENTITY CASCADE`);
      let bytes = 0;
      for (const t of tables) {
        const data = await src.copyOut(t);
        bytes += data.byteLength;
        if (data.byteLength) await target.copyIn(t, data);
      }
      await resetSequences(target, tables);
      log(`[publish] ${tables.length} tables, ${(bytes / 1e6).toFixed(1)} MB copied`);
    });
    await saveSnapshot(target, { scale: opts.scale, schemaOnly: !!opts.schemaOnly });
    await target.exec('ANALYZE');
    log(`[publish] done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    return report;
  } finally {
    await src.close();
  }
}
