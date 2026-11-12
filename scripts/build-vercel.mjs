// Produces a Vercel Build Output API (v3) deployment in .vercel/output:
//   static/                      the Vite client build
//   functions/api/index.func/    the whole API bundled into one ESM file by esbuild (+ schema.sql and PGlite for reseeds)
// and, before that, prepares the database: applies the schema to Supabase and seeds it if it holds no seed of the
// requested scale (SEED_SCALE, default 0.2). The connection comes from the Supabase ⇄ Vercel integration
// (POSTGRES_URL / POSTGRES_URL_NON_POOLING) or DATABASE_URL. Run by `npm run build:vercel` (Vercel's Build Command).
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const funcDir = path.join(out, 'functions', 'api', 'index.func');
console.log(`[build:vercel] node ${process.versions.node} on ${process.platform}/${process.arch}, cwd ${process.cwd()}`);
const env = { ...process.env, NODE_OPTIONS: '--disable-warning=ExperimentalWarning' };
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
};
const t0 = Date.now();

// 1. database: schema + seed (skipped when the database already holds a seed of this scale)
const hasDb = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING);
if (hasDb) {
  const seedArgs = ['tsx', 'server/seed/index.ts', '--scale', process.env.SEED_SCALE || '0.2'];
  if (process.env.SEED_DISABLED === '1') seedArgs.push('--schema-only');
  run('npx', seedArgs);
} else if (process.env.VERCEL_ENV) {
  console.error('[build:vercel] no database configured. Connect the Supabase project to this Vercel project (Supabase → Project Settings → Integrations → Vercel), or set DATABASE_URL.');
  process.exit(1);
} else {
  console.log('[build:vercel] no DATABASE_URL / POSTGRES_URL: skipping the database step (CI build check)');
}

// 2. client
run('npx', ['vite', 'build']);

// 3. API bundle
rmSync(out, { recursive: true, force: true });
mkdirSync(funcDir, { recursive: true });
await build({
  entryPoints: [path.join(root, 'server', 'vercel-entry.ts')],
  outfile: path.join(funcDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: path.join(root, 'tsconfig.server.json'),
  // pg-native is an optional binding pg never needs here; PGlite (WASM) is shipped as a package below
  external: ['pg-native', '@electric-sql/pglite'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  logLevel: 'warning',
});
writeFileSync(path.join(funcDir, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(
  path.join(funcDir, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60, memory: 1024 }, null, 2),
);
// schema.sql is read at runtime by migrate(); PGlite is only needed if a reset has to regenerate (no matching snapshot)
cpSync(path.join(root, 'server', 'db', 'schema.sql'), path.join(funcDir, 'schema.sql'));
const pglite = path.join(root, 'node_modules', '@electric-sql', 'pglite');
if (existsSync(pglite)) cpSync(pglite, path.join(funcDir, 'node_modules', '@electric-sql', 'pglite'), { recursive: true });

// 4. static + routes
cpSync(path.join(root, 'dist', 'client'), path.join(out, 'static'), { recursive: true });
writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: '/api/index' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('[build:vercel] hosted build classifies quick logs and uploads by rules; no text is sent to a model provider (HOSTED_CLASSIFIER=claude changes that: only after a data-processing agreement and consent disclosure)');
console.log(`[build:vercel] .vercel/output ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
