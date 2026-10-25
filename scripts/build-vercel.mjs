// Produces a Vercel Build Output API (v3) deployment in .vercel/output:
//   static/                      the Vite client build
//   functions/api/index.func/    the whole API bundled into one ESM file by esbuild, plus the build-time seed
//                                (seed-data/graph.sqlite, vault.sqlite) that the function copies to /tmp on cold start
// Run by `npm run build:vercel` (Vercel's Build Command). Needs Node 22.13+ for node:sqlite.
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, statSync, createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const funcDir = path.join(out, 'functions', 'api', 'index.func');
// Diagnostics first: the build needs node:sqlite (Node >= 22.5; unflagged from 22.13).
const [major, minor] = process.versions.node.split('.').map(Number);
console.log(`[build:vercel] node ${process.versions.node} on ${process.platform}/${process.arch}, cwd ${process.cwd()}`);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`[build:vercel] Node ${process.versions.node} has no node:sqlite. Set the project's Node.js version to 22.x (Vercel: Settings → General → Node.js Version).`);
  process.exit(1);
}
const needsFlag = major === 22 && minor < 13;
const nodeOptions = [needsFlag ? '--experimental-sqlite' : '', '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' ');
const env = { ...process.env, NODE_OPTIONS: nodeOptions };
try {
  await import('node:sqlite');
  console.log('[build:vercel] node:sqlite OK');
} catch (e) {
  console.error('[build:vercel] node:sqlite failed to load:', e?.message);
  if (!needsFlag) process.exit(1);
}
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
};
const t0 = Date.now();

// 1. synthetic seed (full scale unless SEED_SCALE is set; SEED_DISABLED=1 ships an empty schema)
const seedArgs = ['tsx', 'server/seed/index.ts', '--force'];
if (process.env.SEED_DISABLED === '1') seedArgs.push('--schema-only');
else if (process.env.SEED_SCALE) seedArgs.push('--scale', process.env.SEED_SCALE);
run('npx', seedArgs);

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

// 4. seed data travels with the function (read-only there; copied to /tmp at runtime)
const seedDir = path.join(funcDir, 'seed-data');
mkdirSync(seedDir, { recursive: true });
// gzipped: keeps every deployed file well under Vercel's 100 MB per-file limit; the function gunzips to /tmp on cold start
let bytes = 0;
for (const f of ['graph.sqlite', 'vault.sqlite']) {
  const src = path.join(root, 'data', f);
  if (!existsSync(src)) throw new Error(`missing ${src} after seed`);
  const dst = path.join(seedDir, `${f}.gz`);
  await pipeline(createReadStream(src), createGzip({ level: 6 }), createWriteStream(dst));
  bytes += statSync(dst).size;
}

// 5. static + routes
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
console.log(`[build:vercel] .vercel/output ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (seed data ${(bytes / 1e6).toFixed(0)} MB gzipped)`);
