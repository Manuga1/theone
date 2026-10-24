// Seeds the local databases if they do not exist yet. Runs before the dev server.
// Synthetic data is written only to ./data (gitignored). `npm run data:wipe` removes it.
// Set SEED_DISABLED=1 (or pass --no-seed) to create the schema only and run with an empty database.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same resolution as server/db/paths.ts and the seed CLI: GRAPH_DB wins, then DATA_DIR/graph.sqlite, then ./data/graph.sqlite.
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
const graph = process.env.GRAPH_DB ?? path.join(dataDir, 'graph.sqlite');
const noSeed = process.env.SEED_DISABLED === '1' || process.argv.includes('--no-seed');

if (existsSync(graph)) {
  console.log(`[ensure-seed] ${path.relative(root, graph) || graph} present, skipping seed`);
  process.exit(0);
}
const args = ['server/seed/index.ts', ...(noSeed ? ['--schema-only'] : [])];
console.log(`[ensure-seed] ${noSeed ? 'creating empty schema' : 'seeding synthetic data'} ...`);
const r = spawnSync('npx', ['tsx', ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--disable-warning=ExperimentalWarning' } });
process.exit(r.status ?? 1);
