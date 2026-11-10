import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root in dev/tests (inside the deployed bundle this resolves to an unused path; static files are served by Vercel). */
export const ROOT = process.env.APP_ROOT ?? path.resolve(here, '..', '..');
export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
/** Local database (PGlite, in-process Postgres) used when no DATABASE_URL is set. */
export const PGLITE_DIR = process.env.PGLITE_DIR ?? path.join(DATA_DIR, 'pglite');

/** Runtime connection: Supabase's pooled URL (transaction mode). The Vercel ⇄ Supabase integration sets POSTGRES_URL. */
export function databaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}
/** Seeding / migrations: a direct (session) connection when one is configured, else the runtime URL. */
export function directDatabaseUrl(): string | null {
  return process.env.DATABASE_URL_DIRECT || process.env.POSTGRES_URL_NON_POOLING || databaseUrl();
}
/** True on Vercel (build or runtime). */
export const HOSTED = !!process.env.VERCEL;
