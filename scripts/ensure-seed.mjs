// Seeds the database before the dev server starts if it has no data yet.
//   • DATABASE_URL / POSTGRES_URL set → that Postgres (e.g. Supabase); the seed CLI skips it when already seeded.
//   • otherwise → the local PGlite database under data/pglite (gitignored). `npm run data:wipe` removes it.
// Set SEED_DISABLED=1 (or pass --no-seed) to create the schema only and run with an empty database.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
const pgliteDir = process.env.PGLITE_DIR ?? path.join(dataDir, 'pglite');
const remote = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
const noSeed = process.env.SEED_DISABLED === '1' || process.argv.includes('--no-seed');

if (!remote && existsSync(pgliteDir)) {
  console.log(`[ensure-seed] ${path.relative(root, pgliteDir) || pgliteDir} present, skipping seed`);
  process.exit(0);
}
const args = ['server/seed/index.ts', ...(noSeed ? ['--schema-only'] : [])];
console.log(`[ensure-seed] ${noSeed ? 'creating empty schema' : remote ? 'checking the remote database' : 'seeding synthetic data'} ...`);
const r = spawnSync('npx', ['tsx', ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--disable-warning=ExperimentalWarning' } });
process.exit(r.status ?? 1);
