// P5 "Add / Connect Data": source cards, missing dimensions, connect/disconnect (soft-delete + coverage rebuild),
// "Notify me" demand watches and self-reported values.
import { DEMO_TODAY, daysBetween, nowIso, relative } from '@shared/clock';
import { PROVENANCE_RANK } from '@shared/provenance';
import type { MissingDimension, ParticipantSources, SelfReportInput, SourceCard, SourceCardExtras } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, notFound } from '../errors';
import { logActivity } from './activity';
import { appendAudit } from './audit';
import { computeCompleteness, overlays } from './completeness';
import { rebuildCoverage } from './coverage';
import { conceptBySlug, leaves } from './ontology';
import { generateInitialSync } from './simulate';
import { mapSeq } from '../util/async';

type SourceRow = { id: number; kind: string; vendor: string; label: string; action_label: string; status: SourceCard['status']; connected_at: string | null; last_sync_at: string | null; verified: number };

export async function listSources(participantId: number, db: Db = graph()): Promise<SourceCard[]> {
  if (!await db.tableExists('source')) return [];
  return (await db.all<SourceRow>('SELECT id, kind, vendor, label, action_label, status, connected_at, last_sync_at, verified FROM source WHERE participant_id = ? ORDER BY sort_order, id', participantId))
    .map((s) => ({ id: s.id, kind: s.kind, label: s.label, vendor: s.vendor, actionLabel: s.action_label, status: s.status, verified: !!s.verified, connectedAt: s.connected_at, lastSyncAt: s.last_sync_at, lastSyncRelative: s.last_sync_at && s.status === 'connected' ? relative(s.last_sync_at) : null, ...sourceExtras(s) }));
}

// ---- SourceCardExtras (2026-11-10 notes): integration cards carry a kind group, a health flag and the import formats they accept ----
const KIND_GROUP: Record<string, SourceCardExtras['kindGroup']> = {
  ehr: 'records', pharmacy: 'records', lab: 'labs', wearable: 'wearable', apple_health: 'wearable', genomics: 'genomics', imaging: 'imaging', nutrition: 'nutrition',
  bp_device: 'device', scale: 'device', cgm: 'device', dynamometer: 'device', microbiome: 'device', environment: 'device', survey: 'survey', self_report: 'import', upload: 'import',
};
const IMPORT_FORMATS: Record<NonNullable<SourceCardExtras['kindGroup']>, string[]> = {
  records: ['.pdf', '.txt'], labs: ['.pdf', '.csv'], wearable: ['export.xml', '.csv', '.json'], genomics: ['.vcf', '.vcf.gz'], imaging: ['.dcm', '.dicom', '.nii', '.zip'],
  nutrition: ['image/*'], device: ['.csv', '.json'], survey: [], import: ['.csv', '.json', '.pdf', 'image/*', '.txt'],
};
/** Groups whose data arrives continuously: a connected source that has not synced for 30 days needs attention. One-off groups (genomics, imaging, survey, import) never go stale. */
const CONTINUOUS: ReadonlySet<SourceCardExtras['kindGroup']> = new Set(['records', 'labs', 'wearable', 'nutrition', 'device']);
export const STALE_AFTER_DAYS = 30;
export function sourceExtras(s: Pick<SourceRow, 'kind' | 'status' | 'last_sync_at'>): SourceCardExtras {
  const kindGroup = KIND_GROUP[s.kind] ?? 'import';
  const importFormats = s.kind === 'apple_health' ? ['export.xml'] : IMPORT_FORMATS[kindGroup];
  if (s.status === 'disconnected') return { kindGroup, health: 'needs_attention', errorText: 'Disconnected — its data is no longer shared; reconnect to restore it', importFormats };
  if (s.status !== 'connected' || !s.last_sync_at) return { kindGroup, health: 'never_synced', errorText: null, importFormats };
  const stale = CONTINUOUS.has(kindGroup) && daysBetween(s.last_sync_at.slice(0, 10), DEMO_TODAY) > STALE_AFTER_DAYS;
  return { kindGroup, health: stale ? 'needs_attention' : 'ok', errorText: stale ? `No sync for ${daysBetween(s.last_sync_at.slice(0, 10), DEMO_TODAY)} days — reconnect or import a file` : null, importFormats };
}

/** "Verified sources" = connected ∧ verified. */
export async function verifiedSourceCount(participantId: number, db: Db = graph()): Promise<number> {
  if (!await db.tableExists('source')) return 0;
  return (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM source WHERE participant_id = ? AND status = 'connected' AND verified = 1", participantId))?.n ?? 0;
}

/** Enrichable leaves that are not verified, with the action the UI should offer. */
export async function missingDimensions(participantId: number, db: Db = graph()): Promise<MissingDimension[]> {
  if (!await db.tableExists('concept')) return [];
  const comp = await computeCompleteness(participantId, undefined, db);
  const ov = await overlays(participantId, db);
  const watched = new Set((await db.all<{ slug: string }>('SELECT k.slug FROM demand_watch w JOIN concept k ON k.id = w.concept_id WHERE w.participant_id = ?', participantId)).map((r) => r.slug));
  const out: MissingDimension[] = [];
  for (const c of await leaves(db)) {
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

export async function participantSources(participantId: number, db: Db = graph()): Promise<ParticipantSources> {
  return { sources: await listSources(participantId, db), missing: await missingDimensions(participantId, db) };
}

/**
 * Connect a source. Reconnecting restores the observations a disconnect soft-deleted; a source with no data of its own
 * runs a small deterministic initial sync (connected-device provenance) for the concepts it feeds. Coverage is rebuilt
 * and the source is verified only when it actually holds data.
 */
export async function connectSource(participantId: number, sourceId: number, db: Db = graph()): Promise<{ observations: number; synced: string[] }> {
  const s = await db.get<SourceRow>('SELECT * FROM source WHERE id = ? AND participant_id = ?', sourceId, participantId);
  if (!s) throw notFound('source');
  const now = nowIso();
  return await db.tx(async () => {
      await db.run('UPDATE observation SET deleted_at = NULL WHERE participant_id = ? AND source_id = ? AND deleted_at IS NOT NULL', participantId, sourceId);
      let synced: string[] = [];
      let generated = 0;
      const existing = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM observation WHERE participant_id = ? AND source_id = ? AND deleted_at IS NULL', participantId, sourceId))?.n ?? 0;
      if (existing === 0) {
        const r = await generateInitialSync(db, participantId, { id: sourceId, kind: s.kind }, now);
        synced = r.concepts;
        generated = r.observations;
      }
      const hasData = existing + generated > 0;
      await db.run("UPDATE source SET status = 'connected', verified = ?, connected_at = COALESCE(connected_at, ?), last_sync_at = ? WHERE id = ?", hasData ? 1 : 0, now, now, sourceId);
      await rebuildCoverage(participantId, db);
      const names = await mapSeq(synced, async (slug) => (await conceptBySlug(slug, db))?.name ?? slug);
      await logActivity(db, { participantId, kind: 'source_connected', text: `${s.label} connected (${s.vendor})${generated ? ` — initial sync: ${generated.toLocaleString('en-US')} records (${names.join(', ')})` : existing ? ' — data restored' : ''}`, occurredAt: now });
      return { observations: existing + generated, synced };
    });
}

/** Disconnect = soft-delete that source's observations (deleted_at) and rebuild coverage. Built datasets are untouched. */
export async function disconnectSource(participantId: number, sourceId: number, db: Db = graph()): Promise<void> {
  const s = await db.get<SourceRow>('SELECT * FROM source WHERE id = ? AND participant_id = ?', sourceId, participantId);
  if (!s) throw notFound('source');
  const now = nowIso();
  await db.tx(async () => {
        await db.run("UPDATE source SET status = 'disconnected' WHERE id = ?", sourceId);
        const hidden = (await db.run('UPDATE observation SET deleted_at = ? WHERE participant_id = ? AND source_id = ? AND deleted_at IS NULL', now, participantId, sourceId)).changes;
        await rebuildCoverage(participantId, db);
        await appendAudit(db, { participantId, kind: 'source_disconnected', refTable: 'source', refId: sourceId, at: now, summary: `${s.label} (${s.vendor}) disconnected — ${hidden} records no longer shared`, payload: { kind: s.kind, observationsHidden: hidden } });
        await logActivity(db, { participantId, kind: 'source_disconnected', text: `${s.label} disconnected — its data is no longer shared`, occurredAt: now });
      });
}

export async function watchConcept(participantId: number, slug: string, db: Db = graph()): Promise<void> {
  const c = await conceptBySlug(slug, db);
  if (!c) throw notFound('concept');
  await db.tx(async () => {
        await db.run('INSERT OR IGNORE INTO demand_watch (participant_id, concept_id, created_at) VALUES (?,?,?)', participantId, c.id, nowIso());
      });
}

export async function selfReport(participantId: number, slug: string, input: SelfReportInput, db: Db = graph()): Promise<number> {
  const c = await conceptBySlug(slug, db);
  if (!c || c.level !== 'leaf') throw notFound('concept');
  if (input.value === undefined || input.value === null || input.value === '') throw badRequest('value is required');
  const now = nowIso();
  const manual = await db.get<{ id: number }>("SELECT id FROM source WHERE participant_id = ? AND kind = 'self_report' LIMIT 1", participantId);
  return await db.tx(async () => {
      const sourceId = manual?.id ?? (await db.run("INSERT INTO source (participant_id, kind, vendor, label, action_label, status, connected_at, last_sync_at, verified, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            participantId, 'self_report', 'Manual entry', 'Self-reported', 'Add data', 'connected', now, now, 0, 99, now)).lastId;
      const num = typeof input.value === 'number' ? input.value : Number.isFinite(Number(input.value)) ? Number(input.value) : null;
      const id = (await db.run(
            'INSERT INTO observation (participant_id, concept_id, value_num, value_text, value_json, unit, observed_at, source_id, method, provenance_class, provenance_rank, verification, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            participantId, c.id, num, num === null ? String(input.value) : input.note ?? null, null, input.unit ?? c.unit, now, sourceId, 'self_report', 'self_report', PROVENANCE_RANK.self_report, 'self_reported', now)).lastId;
      await db.run('UPDATE source SET last_sync_at = ? WHERE id = ?', now, sourceId);
      await rebuildCoverage(participantId, db);
      await logActivity(db, { participantId, kind: 'self_report', text: `${c.name} added (self-reported)`, occurredAt: now });
      return id;
    });
}
