// Contribution simulation. For the detailed participant a contribution generates protocol-grade raw + derived
// observations with artifacts (BP 14 d × 4 readings, diary photos → derived kcal, CGM 14 d × 96, grip 3 trials × 2
// hands + dynamometer artifact, microbiome kit → sequencing artifact + taxa, surveys as JSON). For the bulk population
// (no observation rows) completion bumps the materialized coverage (protocol_days). `advanceStudy` moves non-Alex
// opportunities through the state machine with an RNG keyed by (opportunity_id, tick).
import { createHash } from 'node:crypto';
import { DEMO_TODAY, addDays, nowIso } from '@shared/clock';
import { PROVENANCE_RANK, type ProvenanceClass } from '@shared/provenance';
import { Rng } from '@shared/rng';
import type { AdvanceResult, OpportunityStatus, SimulateResult } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, conflict, notFound } from '../errors';
import { logActivity } from './activity';
import { studyCounters, studyForOrg, type CampaignRow } from './campaign';
import { enroll, loadOpportunity, type OppJoined } from './consent';
import { rebuildCoverage } from './coverage';
import { buildDataset } from './dataset';
import { postLedger } from './ledger';
import type { ConceptRow } from './ontology';
import { assertTransition, OPPORTUNITY_TRANSITIONS, sqlList } from './state';

type ContribRow = {
  id: number; opportunity_id: number; participant_id: number; concept_id: number; status: 'pending' | 'submitted' | 'verified' | 'rejected'; method: string; duration_days: number; comp_cents: number;
};

const OBS_SQL = 'INSERT INTO observation (participant_id, concept_id, value_num, value_text, value_json, unit, observed_at, valid_from, valid_to, source_id, method, provenance_class, provenance_rank, verification, confidence, artifact_id, derived_from_id, derivation, contribution_id, created_at) VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?)';
const ART_SQL = 'INSERT INTO artifact (participant_id, source_id, kind, uri, sha256, bytes, captured_at, created_at) VALUES (?,?,?,?,?,?,?,?)';

type Writer = {
  obs: (o: { num?: number | null; text?: string | null; json?: unknown; unit?: string | null; at: string; method: string; prov: ProvenanceClass; confidence?: number | null; artifact?: number | null; derivedFrom?: number | null; derivation?: string | null }) => number;
  artifact: (kind: string, uri: string, bytes: number, capturedAt: string) => number;
  counts: { obs: number; artifacts: number; firstArtifact: number | null };
};

function writer(db: Db, pid: number, c: ConceptRow, sourceId: number, contributionId: number | null, now: string, provOverride?: ProvenanceClass): Writer {
  const counts = { obs: 0, artifacts: 0, firstArtifact: null as number | null };
  return {
    counts,
    obs: (o) => {
      counts.obs++;
      const prov = provOverride ?? o.prov;
      return db.run(OBS_SQL, pid, c.id, o.num ?? null, o.text ?? null, o.json === undefined ? null : JSON.stringify(o.json), o.unit ?? c.unit, o.at, sourceId, o.method, prov, PROVENANCE_RANK[prov], 'verified',
        o.confidence ?? null, o.artifact ?? null, o.derivedFrom ?? null, o.derivation ?? null, contributionId, now).lastId;
    },
    artifact: (kind, uri, bytes, capturedAt) => {
      counts.artifacts++;
      const id = db.run(ART_SQL, pid, sourceId, kind, uri, createHash('sha256').update(uri).digest('hex'), bytes, capturedAt, now).lastId;
      if (counts.firstArtifact === null) counts.firstArtifact = id;
      return id;
    },
  };
}

const SOURCE_KIND: Record<string, string> = {
  'physiology.cardiovascular.blood_pressure': 'bp_device', 'physiology.metabolic.cgm': 'cgm', 'physiology.strength.grip_strength': 'dynamometer',
  'biology.microbiome.gut_microbiome': 'microbiome', 'biology.genomics.exome': 'genomics', 'behavior.nutrition.food_log': 'nutrition',
  'environment.air_quality.aqi_exposure': 'environment', 'environment.residential.residential_history': 'environment',
};
function sourceKindFor(c: ConceptRow, method: string): string {
  if (SOURCE_KIND[c.slug]) return SOURCE_KIND[c.slug];
  if (method === 'survey') return 'survey';
  if (method === 'kit' || c.collection_method === 'lab') return 'lab';
  if (method === 'device') return 'wearable';
  if (method === 'photo') return 'nutrition';
  return 'protocol';
}

/** The source that receives protocol data; an "available" source is connected as part of the protocol. */
function resolveSource(db: Db, pid: number, c: ConceptRow, method: string, now: string): number {
  const kind = sourceKindFor(c, method);
  const s = db.get<{ id: number; status: string; label: string; vendor: string }>("SELECT id, status, label, vendor FROM source WHERE participant_id = ? AND kind = ? ORDER BY (status = 'connected') DESC, id LIMIT 1", pid, kind);
  if (s) {
    if (s.status !== 'connected') {
      db.run("UPDATE source SET status = 'connected', verified = 1, connected_at = COALESCE(connected_at, ?), last_sync_at = ? WHERE id = ?", now, now, s.id);
      logActivity(db, { participantId: pid, kind: 'source_connected', text: `${s.label} connected (${s.vendor}) — study protocol`, occurredAt: now });
    } else db.run('UPDATE source SET last_sync_at = ?, verified = 1 WHERE id = ?', now, s.id);
    return s.id;
  }
  return db.run("INSERT INTO source (participant_id, kind, vendor, label, action_label, status, connected_at, last_sync_at, verified, sort_order, created_at) VALUES (?,?,?,?,?,'connected',?,?,1,50,?)",
    pid, kind, 'Study protocol kit', c.name, 'Request kit', now, now, now).lastId;
}

const BP_TIMES = ['07:05', '13:10', '17:30', '21:00'];

/** What one generation run writes: a protocol contribution (contribution_id set, protocol_measurement) or a device's initial sync (connected_device). */
export type GenSpec = {
  method: string; durationDays: number; sourceId: number; contributionId: number | null; rngKey: string;
  /** provenance for every row written (generators describe protocol rows; an initial sync rewrites them as connected_device) */
  prov?: ProvenanceClass;
  /** method label written on each observation row ('protocol' for contributions, 'device' / 'photo' / … for syncs) */
  methodLabel?: string;
};

/** Typical daily values for the simple one-reading-per-day generator (device syncs of wearables, scales, sensors). */
const DAILY_BASE: Record<string, { base: number; sd: number; decimals?: number }> = {
  'physiology.cardiovascular.heart_rate': { base: 64, sd: 3 }, 'physiology.cardiovascular.hrv': { base: 38, sd: 5 }, 'physiology.sleep.sleep_duration': { base: 6.9, sd: 0.5, decimals: 1 },
  'physiology.sleep.sleep_stages': { base: 75, sd: 10 }, 'physiology.sleep.spo2': { base: 96, sd: 1 }, 'physiology.mobility.steps': { base: 7800, sd: 2200 }, 'physiology.mobility.active_minutes': { base: 32, sd: 9 },
  'physiology.metabolic.weight': { base: 90.5, sd: 0.4, decimals: 1 }, 'environment.air_quality.aqi_exposure': { base: 42, sd: 14 }, 'environment.residential.noise_exposure': { base: 54, sd: 4 },
  'behavior.physical_activity.sedentary_time': { base: 8.5, sd: 1.2, decimals: 1 }, 'physiology.metabolic.body_composition': { base: 27, sd: 0.4, decimals: 1 },
};

/** Generate protocol data for a contribution (detailed participant only). Deterministic per contribution id. */
function generate(db: Db, pid: number, c: ConceptRow, contrib: ContribRow, protocol: { trials?: number; device?: string } | undefined, now: string): Writer['counts'] {
  const sourceId = resolveSource(db, pid, c, contrib.method, now);
  return generateData(db, pid, c, { method: contrib.method, durationDays: contrib.duration_days, sourceId, contributionId: contrib.id, rngKey: `sim:${contrib.id}` }, protocol, now);
}

/** The per-method generators (BP 4/day, CGM 96/day, diary photos → derived kcal, grip trials, kits, surveys, daily readings). */
export function generateData(db: Db, pid: number, c: ConceptRow, spec: GenSpec, protocol: { trials?: number; device?: string } | undefined, now: string): Writer['counts'] {
  const rng = new Rng(spec.rngKey);
  const w = writer(db, pid, c, spec.sourceId, spec.contributionId, now, spec.prov);
  const days = Math.max(1, spec.durationDays);
  // multi-day series end yesterday so no reading is stamped after the fixed demo clock; single-shot kits/uploads land today at noon
  const end = ['device', 'photo', 'daily', 'survey'].includes(spec.method) ? addDays(DEMO_TODAY, -1) : DEMO_TODAY;
  const day = (i: number) => addDays(end, -(days - 1 - i));
  const tag = c.slug.split('.').pop() ?? 'protocol';
  const contribId = spec.contributionId ?? 'sync';
  const ml = spec.methodLabel;
  switch (spec.method) {
    case 'device': {
      const bp = c.slug.endsWith('blood_pressure');
      const cgm = c.slug.endsWith('cgm');
      const perDay = bp ? 4 : cgm ? 96 : 24;
      let level = bp ? 131 : cgm ? 138 : 50;
      let first: number | null = null;
      const values: number[] = [];
      for (let d = 0; d < days; d++) {
        const date = day(d);
        const art = w.artifact('device_raw', `${protocol?.device ? protocol.device.toLowerCase().replace(/\s+/g, '-') : tag}://protocol/${contribId}/${date}.json`, 1800 + rng.int(0, 400), date);
        for (let k = 0; k < perDay; k++) {
          const t = bp ? `${BP_TIMES[k]}:00Z` : `${String(Math.floor((k * 24) / perDay)).padStart(2, '0')}:${String((k * (1440 / perDay)) % 60).padStart(2, '0')}:00Z`;
          level = 0.85 * level + 0.15 * (bp ? 131 : cgm ? 138 : 50) + rng.normal(0, bp ? 1.5 : cgm ? 6 : 2);
          const v = Math.round(level + rng.normal(0, bp ? 4 : 10));
          values.push(v);
          const id = w.obs({ num: v, json: bp ? { systolic: v, diastolic: Math.round(v * 0.62 + rng.normal(0, 3)), pulse: Math.round(66 + rng.normal(0, 4)) } : undefined, at: `${date}T${t}`, method: ml ?? 'protocol', prov: 'protocol_measurement', artifact: art, confidence: 0.98 });
          if (first === null) first = id;
        }
      }
      const mean = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
      w.obs({ num: mean, json: { mean, n: values.length, days }, at: `${day(days - 1)}T23:59:00Z`, method: 'derived', prov: 'protocol_measurement', derivedFrom: first, derivation: 'protocol_summary' });
      break;
    }
    case 'photo': {
      const meals = ['Oatmeal with berries', 'Greek salad with chicken', 'Salmon, quinoa and greens', 'Veggie omelette', 'Lentil soup', 'Turkey sandwich', 'Stir-fry with tofu', 'Grilled chicken bowl'];
      const times = ['08:05', '12:40', '19:15'];
      for (let d = 0; d < days; d++) {
        const date = day(d);
        times.forEach((t, s) => {
          const at = `${date}T${t}:00Z`;
          const art = w.artifact('photo', `photo://protocol/${contribId}/${date}-${s}.jpg`, 1_900_000 + rng.int(0, 900_000), at);
          const kcal = Math.round((s === 0 ? 420 : s === 1 ? 610 : 720) + rng.normal(0, 90));
          const raw = w.obs({ text: rng.pick(meals), at, method: ml ?? 'photo', prov: 'photo_derived', artifact: art, confidence: 0.88 });
          w.obs({ num: kcal, json: { kcal, carbs_g: Math.round((kcal * 0.45) / 4), protein_g: Math.round((kcal * 0.25) / 4), fat_g: Math.round((kcal * 0.3) / 9) }, unit: 'kcal', at, method: 'derived', prov: 'photo_derived', derivedFrom: raw, derivation: 'photo_nutrition_estimate', confidence: 0.76 });
        });
      }
      break;
    }
    case 'protocol': {
      if (c.slug.endsWith('grip_strength')) {
        const trials = protocol?.trials ?? 3;
        const date = day(days - 1);
        const art = w.artifact('device_raw', `dyno://protocol/${contribId}/${date}.csv`, 2_400, date);
        const base = { right: 44 + rng.normal(0, 3), left: 41 + rng.normal(0, 3) };
        let best = 0, first: number | null = null;
        for (const hand of ['right', 'left'] as const) for (let t = 1; t <= trials; t++) {
          const v = Math.round((base[hand] + rng.normal(0, 1.4)) * 10) / 10;
          best = Math.max(best, v);
          const id = w.obs({ num: v, json: { hand, trial: t }, unit: 'kg', at: `${date}T10:${String(10 + t * 2 + (hand === 'left' ? 10 : 0)).padStart(2, '0')}:00Z`, method: ml ?? 'protocol', prov: 'protocol_measurement', artifact: art, confidence: 0.97 });
          if (first === null) first = id;
        }
        w.obs({ num: best, json: { best, trials, hands: 2 }, unit: 'kg', at: `${date}T10:40:00Z`, method: 'derived', prov: 'protocol_measurement', derivedFrom: first, derivation: 'best_of_trials' });
      } else {
        for (let d = 0; d < days; d++) w.obs({ num: Math.round(rng.normal(50, 8) * 10) / 10, at: `${day(d)}T09:00:00Z`, method: ml ?? 'protocol', prov: 'protocol_measurement', confidence: 0.95 });
      }
      break;
    }
    case 'kit': {
      const date = day(days - 1);
      if (c.slug.endsWith('gut_microbiome')) {
        const art = w.artifact('sequencing', `seq://protocol/${contribId}/16s.fastq.gz`, 1_240_000_000, date);
        const taxa = { Bacteroides: 0.28, Faecalibacterium: 0.14, Prevotella: 0.09, Bifidobacterium: 0.07, Akkermansia: 0.04, Roseburia: 0.06, other: 0.32 };
        for (const k of Object.keys(taxa) as (keyof typeof taxa)[]) taxa[k] = Math.round((taxa[k] + rng.normal(0, 0.01)) * 1000) / 1000;
        const raw = w.obs({ text: 'Gut microbiome 16S profile (stool kit)', json: { taxa, shannon: Math.round((3.4 + rng.normal(0, 0.2)) * 100) / 100, reads: 48_000 + rng.int(0, 9_000) }, at: `${date}T12:00:00Z`, method: ml ?? 'kit', prov: 'protocol_measurement', artifact: art, confidence: 0.96 });
        w.obs({ num: Math.round((0.62 + rng.normal(0, 0.05)) * 100) / 100, json: { firmicutes_bacteroidetes_ratio: 0.62 }, at: `${date}T12:00:00Z`, method: 'derived', prov: 'protocol_measurement', derivedFrom: raw, derivation: 'taxa_summary' });
      } else if (c.slug.endsWith('exome')) {
        const art = w.artifact('vcf', `file://protocol/${contribId}/exome.vcf.gz`, 96_000_000, date);
        w.obs({ text: `Whole-exome sequencing (GRCh38), ${(47_000 + rng.int(0, 2_500)).toLocaleString('en-US')} variants`, at: `${date}T12:00:00Z`, method: ml ?? 'kit', prov: 'protocol_measurement', artifact: art, confidence: 0.99 });
      } else {
        for (let d = 0; d < days; d++) {
          const dd = day(d);
          const art = w.artifact('ehr_doc', `lab://protocol/${contribId}/${dd}.pdf`, 140_000, dd);
          w.obs({ num: Math.round(rng.normal(c.slug.endsWith('lipid_panel') ? 192 : 100, 12)), at: `${dd}T08:30:00Z`, method: ml ?? 'kit', prov: 'protocol_measurement', artifact: art, confidence: 0.99 });
        }
      }
      break;
    }
    case 'upload': {
      const date = day(days - 1);
      const art = w.artifact('file', `file://protocol/${contribId}/${tag}.bin`, 4_000_000 + rng.int(0, 2_000_000), date);
      w.obs({ text: `${c.name} uploaded under study protocol`, at: `${date}T12:00:00Z`, method: ml ?? 'upload', prov: 'protocol_measurement', artifact: art });
      break;
    }
    case 'daily': {
      // one reading per day (wearables, scales, sensors, records): numeric where the concept has a typical value, else a dated text record
      const spec2 = DAILY_BASE[c.slug];
      let level = spec2?.base ?? 50;
      for (let d = 0; d < days; d++) {
        const date = day(d);
        if (spec2) {
          level = 0.7 * level + 0.3 * spec2.base + rng.normal(0, spec2.sd);
          const dec = spec2.decimals ?? 0;
          const v = Math.round(level * 10 ** dec) / 10 ** dec;
          w.obs({ num: v, at: `${date}T${c.slug.includes('sleep') ? '07:00' : c.slug.includes('weight') ? '07:20' : '12:00'}:00Z`, method: ml ?? 'device', prov: 'protocol_measurement', confidence: 0.95 });
        } else if (d === days - 1) {
          w.obs({ text: `${c.name} record imported`, at: `${date}T12:00:00Z`, method: ml ?? 'device', prov: 'protocol_measurement' });
        }
      }
      break;
    }
    default: {
      // survey (and anything else): one JSON answer set per protocol day
      for (let d = 0; d < days; d++) {
        const score = rng.int(0, 10);
        w.obs({ num: score, json: { instrument: c.name, score, answers: Array.from({ length: 5 }, () => rng.int(0, 4)) }, at: `${day(d)}T18:00:00Z`, method: ml ?? 'survey', prov: 'protocol_measurement' });
      }
    }
  }
  return w.counts;
}

/** Concepts a source kind feeds, with the generator used for its initial sync. */
const KIND_SYNC: Record<string, { slug: string; method: string; methodLabel: string }[]> = {
  bp_device: [{ slug: 'physiology.cardiovascular.blood_pressure', method: 'device', methodLabel: 'device' }],
  cgm: [{ slug: 'physiology.metabolic.cgm', method: 'device', methodLabel: 'device' }],
  dynamometer: [{ slug: 'physiology.strength.grip_strength', method: 'protocol', methodLabel: 'device' }],
  microbiome: [{ slug: 'biology.microbiome.gut_microbiome', method: 'kit', methodLabel: 'kit' }],
  genomics: [{ slug: 'biology.genomics.exome', method: 'kit', methodLabel: 'upload' }],
  nutrition: [{ slug: 'behavior.nutrition.food_log', method: 'photo', methodLabel: 'photo' }],
  wearable: ['physiology.cardiovascular.heart_rate', 'physiology.cardiovascular.hrv', 'physiology.sleep.sleep_duration', 'physiology.sleep.sleep_stages', 'physiology.mobility.steps', 'physiology.mobility.active_minutes'].map((slug) => ({ slug, method: 'daily', methodLabel: 'device' })),
  scale: [{ slug: 'physiology.metabolic.weight', method: 'daily', methodLabel: 'device' }, { slug: 'physiology.metabolic.body_composition', method: 'daily', methodLabel: 'device' }],
  environment: [{ slug: 'environment.air_quality.aqi_exposure', method: 'daily', methodLabel: 'device' }],
  lab: [{ slug: 'clinical.labs.lipid_panel', method: 'kit', methodLabel: 'lab' }, { slug: 'clinical.labs.metabolic_panel', method: 'kit', methodLabel: 'lab' }],
  ehr: [{ slug: 'clinical.encounters.ehr_history', method: 'daily', methodLabel: 'ehr' }],
  pharmacy: [{ slug: 'clinical.medications.medication_list', method: 'daily', methodLabel: 'ehr' }],
  imaging: [{ slug: 'imaging.mri.mri_musculoskeletal', method: 'upload', methodLabel: 'upload' }],
  survey: [{ slug: 'outcomes.patient_reported.symptom_survey', method: 'survey', methodLabel: 'survey' }],
};

/**
 * Initial sync when a source is connected (inside a tx): a small deterministic window of connected-device data for the
 * concepts the source feeds (≈ 14 days, or just past the concept's span requirement when that is shorter). Returns the
 * rows written; the caller rebuilds coverage and marks the source verified only when data exists.
 */
export function generateInitialSync(db: Db, pid: number, source: { id: number; kind: string }, now: string, days = 14): { observations: number; artifacts: number; concepts: string[] } {
  const out = { observations: 0, artifacts: 0, concepts: [] as string[] };
  for (const spec of KIND_SYNC[source.kind] ?? []) {
    const c = db.get<ConceptRow>('SELECT * FROM concept WHERE slug = ?', spec.slug);
    if (!c) continue;
    const span = c.min_span_days > 0 && c.min_span_days <= days ? c.min_span_days + 1 : days; // just past a short span requirement (CGM 14 d → 15 d)
    const n = spec.method === 'kit' || spec.method === 'upload' || spec.method === 'protocol' ? 1 : span;
    const counts = generateData(db, pid, c, { method: spec.method, durationDays: n, sourceId: source.id, contributionId: null, rngKey: `sync:${source.id}:${c.id}:${now}`, prov: 'connected_device', methodLabel: spec.methodLabel }, undefined, now);
    out.observations += counts.obs;
    out.artifacts += counts.artifacts;
    if (counts.obs > 0) out.concepts.push(c.slug);
  }
  return out;
}

function contributionRow(id: number, db: Db): ContribRow | undefined {
  if (!db.tableExists('contribution')) return undefined;
  return db.get<ContribRow>('SELECT id, opportunity_id, participant_id, concept_id, status, method, duration_days, comp_cents FROM contribution WHERE id = ?', id);
}

function setOpp(db: Db, o: OppJoined, to: OpportunityStatus, extra: Record<string, string | null> = {}): void {
  assertTransition('opportunity', OPPORTUNITY_TRANSITIONS, o.status, to);
  const sets = ['status = ?', ...Object.keys(extra).map((k) => `${k} = ?`)].join(', ');
  db.run(`UPDATE opportunity SET ${sets} WHERE id = ?`, to, ...Object.values(extra), o.id);
  o.status = to;
}

/** Inside a tx. When no contribution is pending/submitted any more: opportunity paid|rejected, enrollment completed, license scope extended. */
export function finalizeIfComplete(db: Db, o: OppJoined, now: string): { complete: boolean; rejected: boolean } {
  const open = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM contribution WHERE opportunity_id = ? AND status IN ('pending','submitted')", o.id)?.n ?? 0;
  if (open > 0) return { complete: false, rejected: false };
  const rejected = (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM contribution WHERE opportunity_id = ? AND status = 'rejected'", o.id)?.n ?? 0) > 0;
  if (o.status === 'accepted') setOpp(db, o, 'in_progress');
  setOpp(db, o, rejected ? 'rejected' : 'paid', { completed_at: now });
  db.run("UPDATE enrollment SET status = 'completed', completed_at = ? WHERE opportunity_id = ? AND status = 'active'", now, o.id);
  const verifiedSlugs = db.all<{ slug: string }>("SELECT k.slug FROM contribution c JOIN concept k ON k.id = c.concept_id WHERE c.opportunity_id = ? AND c.status = 'verified'", o.id).map((r) => r.slug);
  const lic = db.get<{ id: number; scope: string }>('SELECT l.id, l.scope_concepts_json AS scope FROM license l JOIN enrollment e ON e.id = l.enrollment_id WHERE e.opportunity_id = ? ORDER BY l.id DESC LIMIT 1', o.id);
  if (lic) {
    const prev = JSON.parse(lic.scope) as string[];
    db.run('UPDATE license SET scope_concepts_json = ? WHERE id = ?', JSON.stringify(Array.from(new Set([...prev, ...verifiedSlugs]))), lic.id);
    // a line (0¢: the protocol payment is the contribution's) for every newly scoped concept, so the node's "Research use" counts this license
    for (const slug of verifiedSlugs) {
      const k = db.get<{ id: number }>('SELECT id FROM concept WHERE slug = ?', slug);
      if (k && !db.get('SELECT 1 FROM license_line WHERE license_id = ? AND concept_id = ?', lic.id, k.id)) db.run('INSERT INTO license_line (license_id, concept_id, cents, created_at) VALUES (?,?,0,?)', lic.id, k.id, now);
    }
  }
  db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, o.study_id);
  return { complete: true, rejected };
}

/** Bulk coverage bump for a verified protocol contribution (no observation rows for the bulk population). */
export function bumpCoverageProtocol(db: Db, pid: number, conceptId: number, days: number, lastAt: string, nObs: number, rank: number): void {
  const r = db.run('UPDATE participant_coverage SET protocol_days = MAX(protocol_days, ?), n_obs = n_obs + ?, verified_n = verified_n + ?, best_prov_rank = MAX(best_prov_rank, ?), last_at = MAX(last_at, ?) WHERE participant_id = ? AND concept_id = ?',
    days, nObs, nObs, rank, lastAt, pid, conceptId);
  if (r.changes === 0) {
    db.run('INSERT INTO participant_coverage (participant_id, concept_id, first_at, last_at, span_days, n_obs, best_prov_rank, verified_n, self_report_n, last_value_num, protocol_days) VALUES (?,?,?,?,?,?,?,?,0,NULL,?)',
      pid, conceptId, addDays(lastAt.slice(0, 10), -(days - 1)), lastAt, days - 1, nObs, rank, nObs, days);
  }
}

export function protocolObsCount(method: string, days: number): number {
  return method === 'device' ? days * 4 : method === 'photo' ? days * 3 : method === 'protocol' ? 6 : method === 'survey' ? days : 1;
}

/** Inside a tx: verify (or reject) one bulk contribution — ledger row + coverage bump; returns the net paid. */
export function verifyBulkContribution(db: Db, c: ContribRow, studyId: number, now: string, reject = false): number {
  if (c.status === 'verified' || c.status === 'rejected') return 0;
  if (reject) { db.run("UPDATE contribution SET status = 'rejected', submitted_at = COALESCE(submitted_at, ?) WHERE id = ?", now, c.id); c.status = 'rejected'; return 0; }
  const n = protocolObsCount(c.method, c.duration_days);
  db.run("UPDATE contribution SET status = 'verified', submitted_at = COALESCE(submitted_at, ?), verified_at = ?, observation_count = ? WHERE id = ?", now, now, n, c.id);
  c.status = 'verified';
  bumpCoverageProtocol(db, c.participant_id, c.concept_id, c.duration_days, now.slice(0, 10), n, PROVENANCE_RANK.protocol_measurement);
  postLedger(db, { participantId: c.participant_id, kind: 'contribution_payment', netCents: c.comp_cents, occurredAt: now, studyId, contributionId: c.id, memo: 'Verified protocol contribution' });
  return c.comp_cents;
}

/** POST /participant/contributions/:id/simulate — the detailed participant completes one protocol task. */
export function simulateContribution(participantId: number, contributionId: number, db: Db = graph()): SimulateResult {
  const c = contributionRow(contributionId, db);
  if (!c || c.participant_id !== participantId) throw notFound('contribution');
  if (c.status !== 'pending') throw conflict(`contribution is already ${c.status}`);
  const o = loadOpportunity(c.opportunity_id, db)!;
  if (!['accepted', 'in_progress', 'submitted'].includes(o.status)) throw conflict(`opportunity is ${o.status}; nothing to contribute`);
  const concept = db.get<ConceptRow>('SELECT * FROM concept WHERE id = ?', c.concept_id)!;
  const vars = JSON.parse(o.variables_json) as { conceptSlug: string; mode: string; requirement: { protocol?: { trials?: number; device?: string } }; label?: string }[];
  const variable = vars.find((v) => v.conceptSlug === concept.slug && v.mode !== 'reuse');
  const now = nowIso();
  return db.tx(() => {
    if (o.status === 'accepted') setOpp(db, o, 'in_progress');
    const counts = generate(db, participantId, concept, c, variable?.requirement.protocol, now);
    db.run("UPDATE contribution SET status = 'verified', submitted_at = ?, verified_at = ?, observation_count = ?, artifact_id = ? WHERE id = ?", now, now, counts.obs, counts.firstArtifact, c.id);
    rebuildCoverage(participantId, db);
    postLedger(db, { participantId, kind: 'contribution_payment', netCents: c.comp_cents, occurredAt: now, studyId: o.study_id, contributionId: c.id, memo: `${o.study_name} — ${variable?.label ?? concept.name}` });
    const label = variable?.label ?? concept.name;
    logActivity(db, { participantId, kind: 'contribution_payment', text: `$${(c.comp_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} earned — ${o.study_name}: ${label} verified`, amountCents: c.comp_cents, occurredAt: now });
    db.run('INSERT INTO event (participant_id, occurred_at, kind, category, title, detail, concept_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
      participantId, now.slice(0, 10), 'contribution', 'research', `Completed: ${label}`, `${o.study_name} (${o.org_name}) · ${counts.obs.toLocaleString('en-US')} verified records`, concept.id, now);
    const fin = finalizeIfComplete(db, o, now);
    if (fin.complete) {
      logActivity(db, { participantId, kind: 'study_complete', text: `All tasks complete: ${o.study_name} — protocol data verified and paid`, occurredAt: now });
      logActivity(db, { orgId: o.buyer_org_id, kind: 'completion', text: `${o.study_name}: a participant completed the protocol (${fin.rejected ? 'quality review' : 'quality accepted'})`, occurredAt: now });
      buildDataset(db, o.study_id, { now, reason: 'new completion' });
    }
    return { ok: true, writeVersion: db.writeVersion, contributionId: c.id, status: 'verified', observationCount: counts.obs, artifactCount: counts.artifacts, paidCents: c.comp_cents, opportunityStatus: o.status, opportunityComplete: fin.complete };
  });
}

// ---------------------------------------------------------------- study advance (bulk simulation)
type AdvOpp = { id: number; status: OpportunityStatus; pid: number; w: number };
const DAILY = { view: 0.25, expireOffered: 0.004, review: 0.3, declineViewed: 0.04, expireViewed: 0.003, accept: 0.3, declineReviewed: 0.06, start: 0.3, withdraw: 0.002, submit: 0.12, finish: 0.5, verify: 0.985 };

export function advanceStudy(orgId: number, studyId: number, days: number, db: Db = graph()): AdvanceResult {
  const s = studyForOrg(orgId, studyId, db);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw badRequest('days must be an integer between 1 and 365');
  const campaigns = db.all<CampaignRow>("SELECT * FROM campaign WHERE study_id = ? AND status = 'active'", s.id);
  if (!campaigns.length) throw conflict('the study has no active campaign to advance');
  const ids = campaigns.map((c) => c.id);
  const opps = db.all<AdvOpp>(
    `SELECT op.id, op.status, op.participant_id AS pid,
            (COALESCE(cs.willing_device,1) + COALESCE(cs.willing_protocol,1) + COALESCE(cs.willing_survey,1) + COALESCE(cs.willing_connect,1)) / 4.0 AS w
       FROM opportunity op JOIN participant p ON p.id = op.participant_id LEFT JOIN consent_setting cs ON cs.participant_id = op.participant_id
      WHERE op.campaign_id IN (${ids.map(() => '?').join(',')}) AND p.is_detailed = 0 AND op.status IN ${sqlList(['offered', 'viewed', 'reviewed', 'accepted', 'in_progress', 'submitted', 'verified'])}`, ...ids);
  const transitions: Record<string, number> = {};
  const now = nowIso();
  let completions = 0;
  const bump = (from: string, to: string) => { transitions[`${from}→${to}`] = (transitions[`${from}→${to}`] ?? 0) + 1; };
  const move = (o: AdvOpp, to: OpportunityStatus, extra: Record<string, string | null> = {}) => {
    assertTransition('opportunity', OPPORTUNITY_TRANSITIONS, o.status, to);
    const sets = ['status = ?', ...Object.keys(extra).map((k) => `${k} = ?`)].join(', ');
    db.run(`UPDATE opportunity SET ${sets} WHERE id = ?`, to, ...Object.values(extra), o.id);
    bump(o.status, to);
    o.status = to;
  };
  db.tx(() => {
    for (let d = 1; d <= days; d++) {
      const tick = s.advanced_days + d;
      for (const o of opps) {
        if (['paid', 'rejected', 'declined', 'expired', 'withdrawn', 'replaced'].includes(o.status)) continue;
        const rng = new Rng(`adv:${o.id}:${tick}`);
        switch (o.status) {
          case 'offered':
            if (rng.bool(DAILY.view)) move(o, 'viewed', { viewed_at: now });
            else if (rng.bool(DAILY.expireOffered)) move(o, 'expired');
            break;
          case 'viewed':
            if (rng.bool(DAILY.review)) move(o, 'reviewed', { reviewed_at: now });
            else if (rng.bool(DAILY.declineViewed)) move(o, 'declined', { responded_at: now });
            else if (rng.bool(DAILY.expireViewed)) move(o, 'expired');
            break;
          case 'reviewed':
            if (rng.bool(DAILY.accept * (0.4 + 0.6 * o.w))) {
              const joined = loadOpportunity(o.id, db)!;
              move(o, 'accepted', { responded_at: now });
              joined.status = 'accepted';
              const r = enroll(db, joined, { at: now, termStart: DEMO_TODAY });
              if (!r.contributionIds.length) { move(o, 'in_progress'); move(o, 'paid', { completed_at: now }); db.run("UPDATE enrollment SET status = 'completed', completed_at = ? WHERE id = ?", now, r.enrollmentId); completions++; }
            } else if (rng.bool(DAILY.declineReviewed)) move(o, 'declined', { responded_at: now });
            break;
          case 'accepted':
            if (rng.bool(DAILY.start)) move(o, 'in_progress');
            else if (rng.bool(DAILY.withdraw)) { withdrawBulk(db, o.id, now); move(o, 'withdrawn'); }
            break;
          case 'in_progress':
            if (rng.bool(DAILY.submit)) { db.run("UPDATE contribution SET status = 'submitted', submitted_at = ? WHERE opportunity_id = ? AND status = 'pending'", now, o.id); move(o, 'submitted'); }
            else if (rng.bool(DAILY.withdraw)) { withdrawBulk(db, o.id, now); move(o, 'withdrawn'); }
            break;
          case 'submitted':
          case 'verified':
            if (o.status === 'verified' || rng.bool(DAILY.finish)) {
              const cs = db.all<ContribRow>('SELECT id, opportunity_id, participant_id, concept_id, status, method, duration_days, comp_cents FROM contribution WHERE opportunity_id = ? ORDER BY id', o.id);
              for (const c of cs) verifyBulkContribution(db, c, s.id, now, !rng.bool(DAILY.verify));
              const joined = loadOpportunity(o.id, db)!;
              const fin = finalizeIfComplete(db, joined, now);
              bump(o.status, joined.status);
              o.status = joined.status;
              if (fin.complete) completions++;
            }
            break;
          default:
            break;
        }
      }
    }
    db.run('UPDATE study SET advanced_days = advanced_days + ?, updated_at = ? WHERE id = ?', days, now, s.id);
    const summary = Object.entries(transitions).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${v} ${k}`).join(', ');
    logActivity(db, { orgId, kind: 'advance', text: `${s.name}: ${days} day${days === 1 ? '' : 's'} simulated — ${completions.toLocaleString('en-US')} completions${summary ? ` (${summary})` : ''}`, occurredAt: now });
    if (completions > 0) buildDataset(db, s.id, { now, reason: `${completions.toLocaleString('en-US')} new completions` });
  });
  const ds = db.get<{ id: number; version: number }>("SELECT id, version FROM dataset WHERE study_id = ? AND status = 'current'", s.id);
  return { ok: true, writeVersion: db.writeVersion, days, totalDays: s.advanced_days + days, transitions, completions, counters: studyCounters(s.id, db), datasetId: ds?.id ?? null, datasetVersion: ds?.version ?? null };
}

function withdrawBulk(db: Db, oppId: number, now: string): void {
  const e = db.get<{ id: number; consent_grant_id: number | null }>("SELECT id, consent_grant_id FROM enrollment WHERE opportunity_id = ? AND status = 'active'", oppId);
  if (!e) return;
  db.run("UPDATE enrollment SET status = 'withdrawn', withdrawn_at = ? WHERE id = ?", now, e.id);
  if (e.consent_grant_id) db.run('UPDATE consent_grant SET revoked_at = ? WHERE id = ?', now, e.consent_grant_id);
  db.run('UPDATE license SET revoked_at = ? WHERE enrollment_id = ? AND revoked_at IS NULL', now, e.id);
}

