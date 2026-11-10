// Applies schema.sql. Every statement is idempotent (CREATE … IF NOT EXISTS / CREATE OR REPLACE), so this can run on every deploy.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db, Param } from './driver';

const here = path.dirname(fileURLToPath(import.meta.url));

export function schemaSql(): string {
  // dev/tests: next to this file; deployed bundle: copied next to index.mjs by scripts/build-vercel.mjs
  for (const p of [path.join(here, 'schema.sql'), path.join(here, 'db', 'schema.sql')]) if (existsSync(p)) return readFileSync(p, 'utf8');
  throw new Error('schema.sql not found');
}

/** Application tables in dependency order (the CREATE TABLE order of schema.sql). */
export function appTables(): string[] {
  return Array.from(schemaSql().matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g), (m) => m[1]).filter((t) => t !== 'app_meta');
}

export async function migrate(db: Db): Promise<void> {
  await db.exec(schemaSql());
}

/** Generic insert helper: `insert(db, 'table', { col: value })` → id of the new row. */
export async function insert(db: Db, table: string, row: Record<string, unknown>): Promise<number> {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return (await db.run(sql, ...keys.map((k) => normalize(row[k])))).lastId;
}
export function normalize(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return Number(v);
  return JSON.stringify(v);
}
