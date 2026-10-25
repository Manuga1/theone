import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root in dev/tests. In the Vercel bundle (api/index.func/index.mjs) `here` is the function directory. */
export const ROOT = process.env.APP_ROOT ?? (process.env.VERCEL ? here : path.resolve(here, '..', '..'));

/**
 * Hosted (read-only filesystem) deployments ship the build-time seed next to the bundle in seed-data/ and work on a
 * writable copy under /tmp. Locally everything lives in ./data (gitignored). DATA_DIR / GRAPH_DB / VAULT_DB override.
 */
export const SEED_DATA_DIR: string | null = process.env.SEED_DATA_DIR ?? (process.env.VERCEL ? path.join(here, 'seed-data') : null);
export const DATA_DIR = process.env.DATA_DIR ?? (process.env.VERCEL ? '/tmp/hda-data' : path.join(ROOT, 'data'));
export const GRAPH_PATH = process.env.GRAPH_DB ?? path.join(DATA_DIR, 'graph.sqlite');
export const VAULT_PATH = process.env.VAULT_DB ?? path.join(DATA_DIR, 'vault.sqlite');
