import { relative } from '@shared/clock';
import type { ActivityItem } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';

type Row = { id: number; kind: string; text: string; occurred_at: string; amount_cents: number | null };

const toItem = (r: Row): ActivityItem => ({ id: r.id, kind: r.kind, text: r.text, occurredAt: r.occurred_at, relative: relative(r.occurred_at), amountCents: r.amount_cents });

export function participantActivity(participantId: number, limit = 8, db: Db = graph()): ActivityItem[] {
  if (!db.tableExists('activity')) return [];
  return db.all<Row>('SELECT id, kind, text, occurred_at, amount_cents FROM activity WHERE participant_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?', participantId, limit).map(toItem);
}
export function orgActivity(orgId: number, limit = 8, db: Db = graph()): ActivityItem[] {
  if (!db.tableExists('activity')) return [];
  return db.all<Row>('SELECT id, kind, text, occurred_at, amount_cents FROM activity WHERE buyer_org_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?', orgId, limit).map(toItem);
}
export function logActivity(db: Db, row: { participantId?: number | null; orgId?: number | null; kind: string; text: string; amountCents?: number | null; occurredAt: string }): number {
  return db.run('INSERT INTO activity (participant_id, buyer_org_id, kind, text, amount_cents, occurred_at, created_at) VALUES (?,?,?,?,?,?,?)',
    row.participantId ?? null, row.orgId ?? null, row.kind, row.text, row.amountCents ?? null, row.occurredAt, row.occurredAt).lastId;
}
