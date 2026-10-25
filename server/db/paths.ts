import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Inside the deployed serverless bundle (api/index.func/index.mjs) the build-time seed sits next to the file in
 * seed-data/. That directory is the signal that we run on a read-only host: work on a writable copy under /tmp.
 * (Do NOT key this on process.env.VERCEL: Vercel sets it during the build as well, where the seed must land in ./data.)
 */
const bundledSeed = path.join(here, 'seed-data');
export const IS_BUNDLE = existsSync(bundledSeed);

/** Repo root in dev/tests; the function directory inside the bundle. */
export const ROOT = process.env.APP_ROOT ?? (IS_BUNDLE ? here : path.resolve(here, '..', '..'));
export const SEED_DATA_DIR: string | null = process.env.SEED_DATA_DIR ?? (IS_BUNDLE ? bundledSeed : null);
export const DATA_DIR = process.env.DATA_DIR ?? (IS_BUNDLE ? '/tmp/hda-data' : path.join(ROOT, 'data'));
export const GRAPH_PATH = process.env.GRAPH_DB ?? path.join(DATA_DIR, 'graph.sqlite');
export const VAULT_PATH = process.env.VAULT_DB ?? path.join(DATA_DIR, 'vault.sqlite');
