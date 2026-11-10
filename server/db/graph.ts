// The database handle. Production: Supabase Postgres (DATABASE_URL / POSTGRES_URL). Local dev: PGlite under data/pglite.
// Tests and the seed inject their own handle with useGraph(). Buyer routes may import this module only (never vault.ts).
import { Db, PgDb, PgliteDb } from './driver';
import { databaseUrl, PGLITE_DIR } from './paths';
import { migrate } from './migrate';

let instance: Db | null = null;
let opening: Promise<Db> | null = null;

/** The open handle. With a DATABASE_URL it opens lazily (a pool connects on first query); otherwise openGraph() must have run. */
export function graph(): Db {
  if (!instance) {
    const url = databaseUrl();
    if (!url) throw new Error('database not open (call openGraph() first)');
    instance = new PgDb(url);
  }
  return instance;
}

/** Opens (once) the configured database. Local PGlite databases get the schema applied so an unseeded app still runs. */
export function openGraph(): Promise<Db> {
  if (instance) return Promise.resolve(instance);
  opening ??= (async () => {
    const url = databaseUrl();
    let db: Db;
    if (url) db = new PgDb(url);
    else {
      db = await PgliteDb.open(PGLITE_DIR);
      await migrate(db);
    }
    instance = db;
    return db;
  })().finally(() => { opening = null; });
  return opening;
}

/** Tests and the seed inject their own handle (pass null to forget it). */
export function useGraph(db: Db | null): void {
  instance = db;
}
