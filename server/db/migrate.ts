// Applies schema.sql / vault-schema.sql. Every statement is CREATE ... IF NOT EXISTS, so this is idempotent.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './driver';

const here = path.dirname(fileURLToPath(import.meta.url));

export function migrateGraph(db: Db): void {
  db.exec(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
}
export function migrateVault(db: Db): void {
  db.exec(readFileSync(path.join(here, 'vault-schema.sql'), 'utf8'));
}

/** Generic insert helper: `insert(db, 'table', { col: value })` → lastId. Statement text is stable per key set, so it is cached. */
export function insert(db: Db, table: string, row: Record<string, unknown>): number {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return db.run(sql, ...keys.map((k) => normalize(row[k]))).lastId;
}
export function normalize(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return Number(v);
  return JSON.stringify(v);
}
