// Apple Health export.xml importer. Apple Health has no web API (a native app is needed), so the participant exports
// the file and we import it. Regex/streaming parser over <Record …/> elements — no XML dependency, no DOM.
// Mapped types → leaves; everything else is counted and skipped. Provenance: connected_device. Dedupe by
// (concept, observed_at, value) within the file and against the graph. One artifact row per import; bytes are not stored.
import { createHash } from 'node:crypto';
import { nowIso } from '@shared/clock';
import { PROVENANCE_RANK } from '@shared/provenance';
import type { AppleHealthImportResult, Proposal } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest } from '../errors';
import { logActivity } from './activity';
import { rebuildCoverage } from './coverage';
import { ingestRow, insertItem, sourceFor, toItem } from './ingest';
import { conceptBySlug, conceptPath } from './ontology';

export const APPLE_HEALTH_MAX_BYTES = 25 * 1024 * 1024;

export type ParsedRecord = { slug: string; observedAt: string; value: number; unit: string; json?: Record<string, number> | null; sourceName: string | null };
export type ParsedExport = { records: number; byType: Record<string, number>; parsed: ParsedRecord[]; unmapped: number };

type Mapping = { slug: string; unit: string; convert?: (v: number, unit: string) => number; daily?: 'sum' };
const QUANTITY: Record<string, Mapping> = {
  HKQuantityTypeIdentifierHeartRate: { slug: 'physiology.cardiovascular.heart_rate', unit: 'bpm' },
  HKQuantityTypeIdentifierRestingHeartRate: { slug: 'physiology.cardiovascular.heart_rate', unit: 'bpm' },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { slug: 'physiology.cardiovascular.hrv', unit: 'ms' },
  HKQuantityTypeIdentifierStepCount: { slug: 'physiology.mobility.steps', unit: 'steps', daily: 'sum' },
  HKQuantityTypeIdentifierBodyMass: { slug: 'physiology.metabolic.weight', unit: 'kg', convert: (v, u) => (u === 'lb' ? Math.round(v * 0.45359237 * 10) / 10 : Math.round(v * 10) / 10) },
  HKQuantityTypeIdentifierBloodGlucose: { slug: 'physiology.metabolic.glucose', unit: 'mg/dL', convert: (v, u) => (/mmol/i.test(u) ? Math.round(v * 18) : Math.round(v)) },
  HKQuantityTypeIdentifierDietaryEnergyConsumed: { slug: 'behavior.nutrition.food_log', unit: 'kcal', convert: (v, u) => (u === 'kJ' ? Math.round(v / 4.184) : Math.round(v)), daily: 'sum' },
  HKQuantityTypeIdentifierOxygenSaturation: { slug: 'physiology.sleep.spo2', unit: '%', convert: (v) => (v <= 1 ? Math.round(v * 1000) / 10 : v) },
};
const BP_SYS = 'HKQuantityTypeIdentifierBloodPressureSystolic';
const BP_DIA = 'HKQuantityTypeIdentifierBloodPressureDiastolic';
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const ASLEEP = /SleepAnalysisAsleep/;

/** "2026-10-20 07:14:33 -0700" → "2026-10-20T14:14:33Z" */
export function appleDate(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*([+-]\d{2}):?(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}${m[3] ? `${m[3]}:${m[4]}` : 'Z'}`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace('.000Z', 'Z');
}
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  return out;
}

/** Parse the export: Record elements only (workouts, clinical records etc. are counted as unmapped). */
export function parseAppleHealthXml(xml: string): ParsedExport {
  const byType: Record<string, number> = {};
  const parsed: ParsedRecord[] = [];
  const daily = new Map<string, ParsedRecord>();
  const sysByTime = new Map<string, { value: number; sourceName: string | null }>();
  const diaByTime = new Map<string, number>();
  const sleepByNight = new Map<string, { hours: number; end: string; sourceName: string | null }>();
  let records = 0;
  let unmapped = 0;
  const re = /<Record\s([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    records++;
    const a = attrs(m[1]);
    const type = a.type ?? '';
    byType[type] = (byType[type] ?? 0) + 1;
    const start = a.startDate ? appleDate(a.startDate) : null;
    const end = a.endDate ? appleDate(a.endDate) : null;
    const sourceName = a.sourceName ?? null;
    if (!start) { unmapped++; continue; }
    if (type === SLEEP) {
      if (!ASLEEP.test(a.value ?? '') || !end) { unmapped++; continue; }
      const hours = (Date.parse(end) - Date.parse(start)) / 3_600_000;
      if (!(hours > 0)) { unmapped++; continue; }
      const night = end.slice(0, 10);
      const slot = sleepByNight.get(night) ?? { hours: 0, end, sourceName };
      slot.hours += hours;
      if (end > slot.end) slot.end = end;
      sleepByNight.set(night, slot);
      continue;
    }
    const value = Number(a.value);
    if (!Number.isFinite(value)) { unmapped++; continue; }
    if (type === BP_SYS) { sysByTime.set(start, { value, sourceName }); continue; }
    if (type === BP_DIA) { diaByTime.set(start, value); continue; }
    const map = QUANTITY[type];
    if (!map) { unmapped++; continue; }
    const v = map.convert ? map.convert(value, a.unit ?? '') : value;
    if (map.daily === 'sum') {
      const key = `${map.slug}|${start.slice(0, 10)}`;
      const slot = daily.get(key) ?? { slug: map.slug, observedAt: `${start.slice(0, 10)}T23:00:00Z`, value: 0, unit: map.unit, sourceName };
      slot.value = Math.round((slot.value + v) * 10) / 10;
      daily.set(key, slot);
    } else parsed.push({ slug: map.slug, observedAt: start, value: v, unit: map.unit, sourceName });
  }
  for (const [t, s] of sysByTime) {
    const dia = diaByTime.get(t) ?? null;
    parsed.push({ slug: 'physiology.cardiovascular.blood_pressure', observedAt: t, value: s.value, unit: 'mmHg', json: dia === null ? { systolic: s.value } : { systolic: s.value, diastolic: dia }, sourceName: s.sourceName });
  }
  for (const [, s] of sleepByNight) parsed.push({ slug: 'physiology.sleep.sleep_duration', observedAt: s.end, value: Math.round(s.hours * 10) / 10, unit: 'h', sourceName: s.sourceName });
  parsed.push(...daily.values());
  parsed.sort((x, y) => x.observedAt.localeCompare(y.observedAt) || x.slug.localeCompare(y.slug));
  return { records, byType, parsed, unmapped };
}

export function importAppleHealth(participantId: number, xml: string, db: Db = graph()): AppleHealthImportResult {
  if (typeof xml !== 'string' || !xml.trim()) throw badRequest('xml is required (the contents of export.xml)');
  if (Buffer.byteLength(xml) > APPLE_HEALTH_MAX_BYTES) throw badRequest(`export.xml must be at most ${APPLE_HEALTH_MAX_BYTES / 1024 / 1024} MB in this model`);
  if (!/<Record\s/.test(xml) && !/<HealthData/.test(xml)) throw badRequest('this does not look like an Apple Health export.xml (no <HealthData>/<Record> elements)');
  const now = nowIso();
  const { records, parsed } = parseAppleHealthXml(xml);
  const sha = createHash('sha256').update(xml).digest('hex');
  const bytes = Buffer.byteLength(xml);

  return db.tx(() => {
    const sourceId = sourceFor(db, participantId, 'apple_health', null, now);
    const artifactId = db.run('INSERT INTO artifact (participant_id, source_id, kind, uri, sha256, bytes, captured_at, created_at) VALUES (?,?,?,?,?,?,?,?)', participantId, sourceId, 'apple_health_export', `apple-health://export/${sha.slice(0, 16)}`, sha, bytes, now, now).lastId;
    const counts = new Map<string, number>();
    let imported = 0;
    let skipped = 0;
    const seen = new Set<string>();
    const existing = new Map<number, Set<string>>();
    const itemId = insertItem(db, participantId, { kind: 'apple_health', status: 'auto_filed', filename: 'export.xml', bytes, mime: 'text/xml', sha256: sha, proposal: null, createdAt: now });
    for (const r of parsed) {
      const c = conceptBySlug(r.slug, db);
      if (!c) { skipped++; continue; }
      if (!existing.has(c.id)) {
        existing.set(c.id, new Set(db.all<{ at: string; v: number | null }>('SELECT observed_at AS at, value_num AS v FROM observation WHERE participant_id = ? AND concept_id = ? AND deleted_at IS NULL', participantId, c.id).map((x) => `${x.at}|${x.v ?? ''}`)));
      }
      const key = `${r.observedAt}|${r.value}`;
      if (seen.has(`${c.id}|${key}`) || existing.get(c.id)!.has(key)) { skipped++; continue; }
      seen.add(`${c.id}|${key}`);
      db.run(
        'INSERT INTO observation (participant_id, concept_id, value_num, value_text, value_json, unit, observed_at, source_id, method, provenance_class, provenance_rank, verification, confidence, artifact_id, classification_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        participantId, c.id, r.value, r.sourceName ? `Apple Health (${r.sourceName})` : 'Apple Health', r.json ? JSON.stringify(r.json) : null, r.unit, r.observedAt, sourceId, 'import', 'connected_device', PROVENANCE_RANK.connected_device, 'verified', null, artifactId,
        JSON.stringify({ classifier: 'rules', confidence: 1, ingestItemId: itemId }), now);
      counts.set(r.slug, (counts.get(r.slug) ?? 0) + 1);
      imported++;
    }
    const byConcept = [...counts.entries()].map(([slug, n]) => ({ conceptSlug: slug, conceptName: conceptBySlug(slug, db)?.name ?? slug, n })).sort((a, b) => b.n - a.n);
    const top = byConcept[0] ? conceptBySlug(byConcept[0].conceptSlug, db) ?? null : null;
    const proposal: Proposal = {
      conceptSlug: top?.slug ?? null, conceptName: top?.name ?? null, path: top ? conceptPath(top.slug, db) : [], newConcept: null, confidence: 1,
      rationale: `Apple Health export: ${records.toLocaleString('en-US')} records → ${imported.toLocaleString('en-US')} observations across ${byConcept.length} leaves (${skipped.toLocaleString('en-US')} duplicates/unmapped skipped)`,
      extracted: { valueText: 'export.xml', observedAt: now, attributes: { records: String(records), imported: String(imported) } }, followUp: null, classifier: 'rules', alternatives: [],
    };
    db.run('UPDATE ingest_item SET concept_id = ?, observation_count = ?, proposal_json = ?, resolved_at = ? WHERE id = ?', top?.id ?? null, imported, JSON.stringify(proposal), now, itemId);
    db.run('UPDATE source SET verified = CASE WHEN ? > 0 THEN 1 ELSE verified END, last_sync_at = ? WHERE id = ?', imported, now, sourceId);
    if (imported > 0) rebuildCoverage(participantId, db);
    logActivity(db, { participantId, kind: 'ingest_apple_health', text: `Apple Health export imported: ${imported.toLocaleString('en-US')} records (${byConcept.slice(0, 3).map((b) => b.conceptName).join(', ')})`, occurredAt: now });
    return { records, imported, skipped, byConcept, artifactId: imported > 0 ? artifactId : null, item: toItem(ingestRow(itemId, participantId, db)!, db) };
  });
}
