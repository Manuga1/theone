// Tamper-evident audit chain (2026-11-10 notes: "store the data as a ledger"). Every governance / economic write
// (ledger rows, consent grants, licenses, revocations, withdrawals, deletions, source disconnects, permission and vault
// toggles, new branches created from review, onboarding steps) appends ONE row here inside the SAME transaction as the
// write it describes. Rows form a hash chain: hash = sha256(prev_hash | canonical JSON {kind, refTable, refId, payload, at}),
// the first prev_hash is 'genesis'. A day's hashes are summarised by a Merkle root in audit_anchor ('simulated': production
// would publish that root to a public chain — never patient data, never a hash of a single person's record).
import { createHash } from 'node:crypto';
import { DEMO_TODAY, nowIso } from '@shared/clock';
import type { AuditAnchor, AuditEvent, AuditLog, AuditVerify } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';

export const GENESIS = 'genesis';
export const ANCHOR_NOTE = 'Simulated anchor: in production this Merkle root (not the events, never patient data) would be published to a public chain once a day so the log cannot be rewritten afterwards.';
export const AUDIT_EXPLANATION =
  'Every governance and economic write — ledger rows, consent grants, licenses, revocations, withdrawals, deletions, source disconnects, permission and vault-mode changes, branches created from review — appends a hash-chained event in the same database transaction. ' +
  'Each event hashes the previous hash with its own content, so changing or removing any event breaks every hash after it. ' +
  'Once a day the events are summarised by a Merkle root (an anchor); in production that root alone would be published to a public chain. Your health data never leaves the platform and is never written on-chain.';

export type AuditRow = { id: number; participant_id: number | null; kind: string; summary: string; ref_table: string | null; ref_id: number | null; payload_json: string; at: string; prev_hash: string; hash: string; created_at: string };
export type AuditInput = { participantId?: number | null; kind: string; summary: string; refTable?: string | null; refId?: number | null; payload?: Record<string, unknown>; at?: string };

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
/** JSON with object keys sorted recursively (arrays keep their order), so the same content always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
export function hashEvent(prevHash: string, e: { kind: string; refTable: string | null; refId: number | null; payload: unknown; at: string }): string {
  return sha256(`${prevHash}|${canonicalJson({ kind: e.kind, refTable: e.refTable, refId: e.refId, payload: e.payload, at: e.at })}`);
}
/** Merkle root over hashes in order: pairwise sha256(a + b), the last one duplicated on odd levels. Empty → null. */
export function merkleRoot(hashes: string[]): string | null {
  if (!hashes.length) return null;
  let level = hashes.slice();
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256(level[i] + (level[i + 1] ?? level[i])));
    level = next;
  }
  return level[0];
}

export async function auditHead(db: Db = graph()): Promise<string | null> {
  if (!await db.tableExists('audit_event')) return null;
  return (await db.get<{ hash: string }>('SELECT hash FROM audit_event ORDER BY id DESC LIMIT 1'))?.hash ?? null;
}

/** Append one event (call inside the transaction of the write it records). Returns its id and hash. */
export async function appendAudit(db: Db, e: AuditInput): Promise<{ id: number; hash: string }> {
  const prev = await auditHead(db) ?? GENESIS;
  const at = e.at ?? nowIso();
  const payload = e.payload ?? {};
  const hash = hashEvent(prev, { kind: e.kind, refTable: e.refTable ?? null, refId: e.refId ?? null, payload, at });
  const id = (await db.run(
      'INSERT INTO audit_event (participant_id, kind, summary, ref_table, ref_id, payload_json, at, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      e.participantId ?? null, e.kind, e.summary, e.refTable ?? null, e.refId ?? null, JSON.stringify(payload), at, prev, hash, nowIso())).lastId;
  return { id, hash };
}

/** Recompute the whole chain from 'genesis'. brokenAt = the first event whose prev_hash or hash does not match. */
export async function verifyChain(db: Db = graph()): Promise<AuditVerify> {
  const verifiedAt = nowIso();
  if (!await db.tableExists('audit_event')) return { ok: true, events: 0, headHash: null, brokenAt: null, verifiedAt };
  const rows = await db.all<Pick<AuditRow, 'id' | 'kind' | 'ref_table' | 'ref_id' | 'payload_json' | 'at' | 'prev_hash' | 'hash'>>('SELECT id, kind, ref_table, ref_id, payload_json, at, prev_hash, hash FROM audit_event ORDER BY id');
  let prev = GENESIS;
  let brokenAt: number | null = null;
  for (const r of rows) {
    let payload: unknown = null;
    try { payload = JSON.parse(r.payload_json); } catch { brokenAt = r.id; break; }
    if (r.prev_hash !== prev || hashEvent(prev, { kind: r.kind, refTable: r.ref_table, refId: r.ref_id, payload, at: r.at }) !== r.hash) { brokenAt = r.id; break; }
    prev = r.hash;
  }
  return { ok: brokenAt === null, events: rows.length, headHash: rows.length ? rows[rows.length - 1].hash : null, brokenAt, verifiedAt };
}
const verifyCache = new WeakMap<Db, { version: number; v: AuditVerify }>();
/** verifyChain cached per (await db.version()) (the ledger page and home call it on every read). */
export async function verifyCached(db: Db = graph()): Promise<AuditVerify> {
  const hit = verifyCache.get(db);
  if (hit && hit.version === (await db.version())) return hit.v;
  const v = await verifyChain(db);
  verifyCache.set(db, { version: (await db.version()), v });
  return v;
}

/** Daily anchors: one row per past day (strictly before `today`) that has events and no anchor yet. Idempotent; existing anchors are never rewritten. */
export async function ensureAnchors(db: Db = graph(), today = DEMO_TODAY): Promise<number> {
  if (!await db.tableExists('audit_event') || !await db.tableExists('audit_anchor')) return 0;
  const days = await db.all<{ d: string }>('SELECT DISTINCT substr(at, 1, 10) AS d FROM audit_event WHERE substr(at, 1, 10) < ? AND substr(at, 1, 10) NOT IN (SELECT date FROM audit_anchor) ORDER BY d', today);
  if (!days.length) return 0;
  const now = nowIso();
  await db.tx(async () => {
        for (const { d } of days) {
          const hashes = (await db.all<{ hash: string }>('SELECT hash FROM audit_event WHERE substr(at, 1, 10) = ? ORDER BY id', d)).map((r) => r.hash);
          const root = merkleRoot(hashes);
          if (!root) continue;
          await db.run("INSERT OR IGNORE INTO audit_anchor (date, root, events, status, note, created_at) VALUES (?,?,?,'simulated',?,?)", d, root, hashes.length, ANCHOR_NOTE, now);
        }
      });
  return days.length;
}

export function toAuditEvent(r: AuditRow): AuditEvent {
  return { id: r.id, at: r.at, kind: r.kind, summary: r.summary, refTable: r.ref_table, refId: r.ref_id, hash: r.hash, prevHash: r.prev_hash };
}
export async function listAnchors(db: Db = graph(), limit = 60): Promise<AuditAnchor[]> {
  if (!await db.tableExists('audit_anchor')) return [];
  return (await db.all<{ date: string; root: string; events: number; status: AuditAnchor['status']; note: string }>('SELECT date, root, events, status, note FROM audit_anchor ORDER BY date DESC LIMIT ?', limit))
    .map((a) => ({ date: a.date, root: a.root, events: a.events, status: a.status, note: a.note }));
}

/** GET /audit: the participant's own events (newest first), the global head, daily anchors and a fresh verification. */
export async function auditLog(participantId: number | null, db: Db = graph(), limit = 100): Promise<AuditLog> {
  if (!await db.tableExists('audit_event')) return { events: [], total: 0, headHash: null, anchors: [], verify: await verifyChain(db), explanation: AUDIT_EXPLANATION };
  await ensureAnchors(db);
  const events = participantId === null
    ? await db.all<AuditRow>('SELECT * FROM audit_event ORDER BY id DESC LIMIT ?', limit)
    : await db.all<AuditRow>('SELECT * FROM audit_event WHERE participant_id = ? ORDER BY id DESC LIMIT ?', participantId, limit);
  const total = participantId === null
    ? (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_event'))?.n ?? 0
    : (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM audit_event WHERE participant_id = ?', participantId))?.n ?? 0;
  const verify = await verifyCached(db);
  return { events: events.map(toAuditEvent), total, headHash: await auditHead(db), anchors: await listAnchors(db), verify, explanation: AUDIT_EXPLANATION };
}
