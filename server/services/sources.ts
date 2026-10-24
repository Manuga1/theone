// P5 "Add / Connect Data": source cards, missing dimensions, connect/disconnect (soft-delete + coverage rebuild),
// "Notify me" demand watches and self-reported values.
import { nowIso, relative } from '@shared/clock';
import { PROVENANCE_RANK } from '@shared/provenance';
import type { MissingDimension, ParticipantSources, SelfReportInput, SourceCard } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, notFound } from '../errors';
import { logActivity } from './activity';
import { computeCompleteness, overlays } from './completeness';
import { rebuildCoverage } from './coverage';
import { conceptBySlug, leaves } from './ontology';
import { generateInitialSync } from './simulate';

type SourceRow = { id: number; kind: string; vendor: string; label: string; action_label: string; status: SourceCard['status']; connected_at: string | null; last_sync_at: string | null; verified: number };

export function listSources(participantId: number, db: Db = graph()): SourceCard[] {
  if (!db.tableExists('source')) return [];
  return db.all<SourceRow>('SELECT id, kind, vendor, label, action_label, status, connected_at, last_sync_at, verified FROM source WHERE participant_id = ? ORDER BY sort_order, id', participantId)
    .map((s) => ({ id: s.id, kind: s.kind, label: s.label, vendor: s.vendor, actionLabel: s.action_label, status: s.status, verified: !!s.verified, connectedAt: s.connected_at, lastSyncAt: s.last_sync_at, lastSyncRelative: s.last_sync_at && s.status === 'connected' ? relative(s.last_sync_at) : null }));
}

/** "Verified sources" = connected ∧ verified. */
export function verifiedSourceCount(participantId: number, db: Db = graph()): number {
  if (!db.tableExists('source')) return 0;
  return db.get<{ n: number }>("SELECT COUNT(*) AS n FROM source WHERE participant_id = ? AND status = 'connected' AND verified = 1", participantId)?.n ?? 0;
}

/** Enrichable leaves that are not verified, with the action the UI should offer. */
export function missingDimensions(participantId: number, db: Db = graph()): MissingDimension[] {
  if (!db.tableExists('concept')) return [];
  const comp = computeCompleteness(participantId, undefined, db);
  const ov = overlays(participantId, db);
  const watched = new Set(db.all<{ slug: string }>('SELECT k.slug FROM demand_watch w JOIN concept k ON k.id = w.concept_id WHERE w.participant_id = ?', participantId).map((r) => r.slug));
  const out: MissingDimension[] = [];
  for (const c of leaves(db)) {
    if (!c.enrichable || !c.in_list) continue;
    const state = comp.leaves.get(c.slug)?.state ?? 'missing';
    if (state === 'verified') continue;
    const o = ov.get(c.slug);
    let action: MissingDimension['action'];
    if (o?.opportunity) action = 'see_opportunities';
    else if (c.collection_method === 'self_report' || c.collection_method === 'survey') action = 'add_data';
    else action = watched.has(c.slug) ? 'watching' : 'notify';
    out.push({ slug: c.slug, name: c.name, state, action, opportunityId: o?.opportunity ? o.opportunityId ?? null : null });
  }
  const rank = (m: MissingDimension) => (m.action === 'see_opportunities' ? 0 : m.action === 'watching' ? 1 : m.action === 'notify' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

export function participantSources(participantId: number, db: Db = graph()): ParticipantSources {
  return { sources: listSources(participantId, db), missing: missingDimensions(participantId, db) };
}

/**
 * Connect a source. Reconnecting restores the observations a disconnect soft-deleted; a source with no data of its own
 * runs a small deterministic initial sync (connected-device provenance) for the concepts it feeds. Coverage is rebuilt
 * and the source is verified only when it actually holds data.
 */
export function connectSource(participantId: number, sourceId: number, db: Db = graph()): { observations: number; synced: string[] } {
  const s = db.get<SourceRow>('SELECT * FROM source WHERE id = ? AND participant_id = ?', sourceId, participantId);
  if (!s) throw notFound('source');
  const now = nowIso();
  return db.tx(() => {
    db.run('UPDATE observation SET deleted_at = NULL WHERE participant_id = ? AND source_id = ? AND deleted_at IS NOT NULL', participantId, sourceId);
    let synced: string[] = [];
    let generated = 0;
    const existing = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM observation WHERE participant_id = ? AND source_id = ? AND deleted_at IS NULL', participantId, sourceId)?.n ?? 0;
    if (existing === 0) {
      const r = generateInitialSync(db, participantId, { id: sourceId, kind: s.kind }, now);
      synced = r.concepts;
      generated = r.observations;
    }
    const hasData = existing + generated > 0;
    db.run("UPDATE source SET status = 'connected', verified = ?, connected_at = COALESCE(connected_at, ?), last_sync_at = ? WHERE id = ?", hasData ? 1 : 0, now, now, sourceId);
    rebuildCoverage(participantId, db);
    const names = synced.map((slug) => conceptBySlug(slug, db)?.name ?? slug);
    logActivity(db, { participantId, kind: 'source_connected', text: `${s.label} connected (${s.vendor})${generated ? ` — initial sync: ${generated.toLocaleString('en-US')} records (${names.join(', ')})` : existing ? ' — data restored' : ''}`, occurredAt: now });
    return { observations: existing + generated, synced };
  });
}

/** Disconnect = soft-delete that source's observations (deleted_at) and rebuild coverage. Built datasets are untouched. */
export function disconnectSource(participantId: number, sourceId: number, db: Db = graph()): void {
  const s = db.get<SourceRow>('SELECT * FROM source WHERE id = ? AND participant_id = ?', sourceId, participantId);
  if (!s) throw notFound('source');
  const now = nowIso();
  db.tx(() => {
    db.run("UPDATE source SET status = 'disconnected' WHERE id = ?", sourceId);
    db.run('UPDATE observation SET deleted_at = ? WHERE participant_id = ? AND source_id = ? AND deleted_at IS NULL', now, participantId, sourceId);
    rebuildCoverage(participantId, db);
    logActivity(db, { participantId, kind: 'source_disconnected', text: `${s.label} disconnected — its data is no longer shared`, occurredAt: now });
  });
}

export function watchConcept(participantId: number, slug: string, db: Db = graph()): void {
  const c = conceptBySlug(slug, db);
  if (!c) throw notFound('concept');
  db.tx(() => {
    db.run('INSERT OR IGNORE INTO demand_watch (participant_id, concept_id, created_at) VALUES (?,?,?)', participantId, c.id, nowIso());
  });
}

export function selfReport(participantId: number, slug: string, input: SelfReportInput, db: Db = graph()): number {
  const c = conceptBySlug(slug, db);
  if (!c || c.level !== 'leaf') throw notFound('concept');
  if (input.value === undefined || input.value === null || input.value === '') throw badRequest('value is required');
  const now = nowIso();
  const manual = db.get<{ id: number }>("SELECT id FROM source WHERE participant_id = ? AND kind = 'self_report' LIMIT 1", participantId);
  return db.tx(() => {
    const sourceId = manual?.id ?? db.run("INSERT INTO source (participant_id, kind, vendor, label, action_label, status, connected_at, last_sync_at, verified, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      participantId, 'self_report', 'Manual entry', 'Self-reported', 'Add data', 'connected', now, now, 0, 99, now).lastId;
    const num = typeof input.value === 'number' ? input.value : Number.isFinite(Number(input.value)) ? Number(input.value) : null;
    const id = db.run(
      'INSERT INTO observation (participant_id, concept_id, value_num, value_text, value_json, unit, observed_at, source_id, method, provenance_class, provenance_rank, verification, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      participantId, c.id, num, num === null ? String(input.value) : input.note ?? null, null, input.unit ?? c.unit, now, sourceId, 'self_report', 'self_report', PROVENANCE_RANK.self_report, 'self_reported', now).lastId;
    db.run('UPDATE source SET last_sync_at = ? WHERE id = ?', now, sourceId);
    rebuildCoverage(participantId, db);
    logActivity(db, { participantId, kind: 'self_report', text: `${c.name} added (self-reported)`, occurredAt: now });
    return id;
  });
}
