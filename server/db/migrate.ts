// Applies schema.sql / vault-schema.sql. Every statement is CREATE ... IF NOT EXISTS, so this is idempotent.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './driver';
import { flattenOntology } from '@shared/ontology';

const here = path.dirname(fileURLToPath(import.meta.url));

export function migrateGraph(db: Db): void {
  db.exec(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  // additive columns for databases created before they existed (CREATE IF NOT EXISTS does not alter)
  addColumn(db, 'concept', 'reuse_comp_cents', 'INTEGER NOT NULL DEFAULT 0');
  // ingestion / branching (2026-11-10 notes)
  addColumn(db, 'concept', 'value_kind', 'TEXT');
  addColumn(db, 'concept', 'synonyms_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumn(db, 'concept', 'follow_ups_json', 'TEXT');
  addColumn(db, 'concept', 'context_rule_json', 'TEXT');
  addColumn(db, 'concept', 'is_variant', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'observation', 'classification_json', 'TEXT');
  addColumn(db, 'consent_setting', 'vault_only', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'participant', 'onboarded_at', 'TEXT');
  syncOntology(db);
}

/**
 * Databases seeded before the 2026-11-10 leaves existed: add the missing canonical concepts and fill the new
 * ingestion columns (value_kind, synonyms, follow-ups, context rule) on existing rows. No-op on an empty concept table
 * (the seed writes it) and on an up-to-date one.
 */
export function syncOntology(db: Db): void {
  const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM concept')?.n ?? 0;
  if (n === 0) return;
  const rows = db.all<{ id: number; slug: string; value_kind: string | null }>('SELECT id, slug, value_kind FROM concept');
  const ids = new Map(rows.map((r) => [r.slug, r.id]));
  const stale = new Set(rows.filter((r) => r.value_kind === null).map((r) => r.slug));
  const flat = flattenOntology();
  if (flat.every((c) => ids.has(c.slug) && !stale.has(c.slug))) return;
  db.tx(() => {
    for (const c of flat) {
      if (!ids.has(c.slug)) {
        const id = db.run(
          'INSERT INTO concept (slug, parent_id, name, level, weight, unit, data_type, min_span_days, freshness_days, collection_method, enrichable, comp_cents, device_cost_cents, reuse_comp_cents, in_ring, in_list, sort_order, description, value_kind, synonyms_json, follow_ups_json, context_rule_json, is_variant, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)',
          c.slug, c.parentSlug ? ids.get(c.parentSlug)! : null, c.name, c.level, c.weight, c.unit, c.dataType, c.minSpanDays, c.freshnessDays, c.method, c.enrichable ? 1 : 0,
          c.compCents, c.deviceCostCents, c.reuseCompCents, c.inRing ? 1 : 0, c.inList ? 1 : 0, 10_000 + c.sortOrder, c.description,
          c.valueKind, JSON.stringify(c.synonyms), c.followUps ? JSON.stringify(c.followUps) : null, c.contextRule ? JSON.stringify(c.contextRule) : null, '2023-01-01T00:00:00Z').lastId;
        ids.set(c.slug, id);
      } else if (stale.has(c.slug) && c.level === 'leaf') {
        db.run('UPDATE concept SET value_kind = ?, synonyms_json = ?, follow_ups_json = ?, context_rule_json = ? WHERE id = ?',
          c.valueKind, JSON.stringify(c.synonyms), c.followUps ? JSON.stringify(c.followUps) : null, c.contextRule ? JSON.stringify(c.contextRule) : null, ids.get(c.slug)!);
      }
    }
  });
}
function addColumn(db: Db, table: string, column: string, decl: string): void {
  const cols = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
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
