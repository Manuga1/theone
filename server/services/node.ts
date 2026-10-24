// P3 "Data node detail": summary, series, lineage, raw-vs-derived, research use and events for one leaf concept.
import { DEMO_TODAY, addDays, daysBetween, relative } from '@shared/clock';
import { PROVENANCE_LABEL, type ProvenanceClass } from '@shared/provenance';
import type { LineageStep, NodeDetail, SeriesPoint } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { coverageFor } from './coverage';
import { leafState, overlays } from './completeness';
import { conceptBySlug, conceptPath, type ConceptRow } from './ontology';
import { licenseNumber } from './ledger';
import { timelineEvents } from './timeline';

type SourceRow = { id: number; kind: string; vendor: string; label: string; last_sync_at: string | null; n: number };

export function nodeDetail(participantId: number, slug: string, db: Db = graph()): NodeDetail | null {
  const c = conceptBySlug(slug, db);
  if (!c || c.level !== 'leaf') return null;
  const cov = coverageFor(participantId, db).get(slug) ?? null;
  const { state } = leafState(c, cov);
  const ov = overlays(participantId, db).get(slug) ?? { opportunity: false, demand: false };
  const overlay = { opportunity: state !== 'verified' && ov.opportunity, demand: ov.demand, opportunityId: state !== 'verified' && ov.opportunity ? ov.opportunityId : undefined };

  const source = db.get<SourceRow>(
    `SELECT s.id, s.kind, s.vendor, s.label, s.last_sync_at, COUNT(*) AS n FROM observation o JOIN source s ON s.id = o.source_id
      WHERE o.participant_id = ? AND o.concept_id = ? AND o.deleted_at IS NULL GROUP BY s.id ORDER BY n DESC LIMIT 1`, participantId, c.id);
  const counts = db.get<{ raw: number; derived: number; artifacts: number; best: ProvenanceClass | null }>(
    `SELECT SUM(CASE WHEN derivation IS NULL THEN 1 ELSE 0 END) AS raw, SUM(CASE WHEN derivation IS NOT NULL THEN 1 ELSE 0 END) AS derived,
            COUNT(DISTINCT artifact_id) AS artifacts,
            (SELECT provenance_class FROM observation o2 WHERE o2.participant_id = o.participant_id AND o2.concept_id = o.concept_id AND o2.deleted_at IS NULL ORDER BY provenance_rank DESC LIMIT 1) AS best
       FROM observation o WHERE participant_id = ? AND concept_id = ? AND deleted_at IS NULL`, participantId, c.id);
  const best = counts?.best ?? null;
  const spanDays = cov ? Math.max(0, daysBetween(cov.first_at.slice(0, 10), cov.last_at.slice(0, 10))) : 0;

  const summary: NodeDetail['summary'] = {
    spanDays,
    spanLabel: spanLabel(c, cov, spanDays),
    nObs: cov?.n_obs ?? 0,
    sourceLabel: source?.vendor ?? null,
    sourceKind: source?.kind ?? null,
    acquisition: acquisition(c, source?.kind ?? null),
    provenanceClass: best,
    verification: verificationLabel(best, cov?.best_prov_rank ?? 0),
    lastSyncAt: source?.last_sync_at ?? null,
    lastSyncRelative: source?.last_sync_at ? relative(source.last_sync_at) : null,
    firstAt: cov?.first_at ?? null,
    lastAt: cov?.last_at ?? null,
  };

  return {
    slug, name: c.name, path: conceptPath(slug, db), state, overlay, unit: c.unit, summary,
    series: series(participantId, c, db),
    lineage: lineage(c, source?.vendor ?? null, (counts?.derived ?? 0) > 0, best),
    rawVsDerived: {
      rawCount: counts?.raw ?? 0, derivedCount: counts?.derived ?? 0, artifactCount: counts?.artifacts ?? 0,
      note: rawDerivedNote(c, counts?.raw ?? 0, counts?.derived ?? 0, counts?.artifacts ?? 0),
    },
    research: research(participantId, c, db),
    events: timelineEvents(participantId, undefined, db).filter((e) => e.conceptSlug === slug),
  };
}

function spanLabel(c: ConceptRow, cov: ReturnType<typeof coverageFor> extends Map<string, infer R> ? R | null : never, spanDays: number): string {
  if (!cov) return 'No data on record';
  if (c.data_type === 'time_series') {
    const months = Math.round(spanDays / 30.4);
    return months >= 2 ? `${months} months continuous data` : `${spanDays} days of data`;
  }
  const first = cov.first_at.slice(0, 4);
  return cov.n_obs === 1 ? `1 record (${cov.first_at.slice(0, 10)})` : `${cov.n_obs} records since ${first}`;
}
function acquisition(c: ConceptRow, sourceKind: string | null): string | null {
  switch (sourceKind) {
    case 'bp_device': case 'wearable': case 'scale': case 'cgm': return 'Device connected directly';
    case 'lab': return 'Imported from lab';
    case 'ehr': case 'pharmacy': return 'Imported from medical records';
    case 'nutrition': return 'Photo upload, model-derived';
    case 'genomics': case 'imaging': return 'File upload';
    case 'survey': return 'Questionnaire';
    case 'self_report': return 'Manual entry';
    default: return c.collection_method ? c.collection_method.replace('_', ' ') : null;
  }
}
function verificationLabel(best: ProvenanceClass | null, rank: number): string {
  if (!best) return 'No data';
  if (best === 'connected_device') return 'Device verified';
  if (best === 'clinical_source') return 'Clinical source verified';
  if (best === 'protocol_measurement') return 'Protocol verified';
  if (best === 'photo_derived') return 'Photo-derived (model estimate)';
  return rank >= 2 ? 'Verified' : 'Self-reported (unverified)';
}
function lineage(c: ConceptRow, vendor: string | null, hasDerived: boolean, best: ProvenanceClass | null): LineageStep[] {
  const v = vendor ?? 'Source';
  const method = c.collection_method;
  if (!best) return [{ key: 'missing', label: 'No data yet', detail: 'Connect a source or complete a study protocol' }];
  if (method === 'device' || best === 'connected_device' || best === 'protocol_measurement') {
    return [
      { key: 'device', label: `${v}`, detail: 'Device' },
      { key: 'raw', label: 'Raw measurement', detail: 'Per-reading record with timestamp' },
      { key: 'verified', label: 'Verified import', detail: PROVENANCE_LABEL[best] },
      { key: 'standardized', label: 'Standardized observation', detail: `${c.name}${c.unit ? ` (${c.unit})` : ''}` },
      ...(hasDerived ? [{ key: 'derived', label: 'Longitudinal trajectory', detail: 'Monthly summaries derived from raw readings' }] : []),
    ];
  }
  if (best === 'photo_derived') {
    return [
      { key: 'photo', label: v, detail: 'Photo capture' },
      { key: 'raw', label: 'Raw photo', detail: 'Image artifact (metadata only)' },
      { key: 'derived', label: 'Model estimate', detail: 'kcal / macros with confidence' },
      { key: 'standardized', label: 'Standardized observation', detail: c.name },
    ];
  }
  if (best === 'clinical_source') {
    return [
      { key: 'source', label: v, detail: method === 'lab' ? 'Laboratory' : method === 'upload' || method === 'kit' ? 'File upload' : 'Medical records' },
      { key: 'raw', label: method === 'lab' ? 'Lab report' : method === 'upload' || method === 'kit' ? 'File artifact' : 'Clinical record', detail: 'Original document retained' },
      { key: 'verified', label: 'Verified import', detail: PROVENANCE_LABEL.clinical_source },
      { key: 'standardized', label: 'Standardized observation', detail: c.name },
      ...(hasDerived || method === 'derived' ? [{ key: 'derived', label: 'Derived annotation', detail: 'Computed from the source record' }] : []),
    ];
  }
  return [
    { key: 'manual', label: 'Manual entry', detail: 'Entered by the participant' },
    { key: 'raw', label: 'Self-reported value', detail: 'Unverified' },
    { key: 'standardized', label: 'Standardized observation', detail: c.name },
  ];
}
function rawDerivedNote(c: ConceptRow, raw: number, derived: number, artifacts: number): string {
  if (!raw) return 'Nothing on record yet.';
  if (derived) return `${raw.toLocaleString('en-US')} raw records and ${derived.toLocaleString('en-US')} derived rows; ${artifacts.toLocaleString('en-US')} source artifacts retained.`;
  return `${raw.toLocaleString('en-US')} records${artifacts ? `, ${artifacts.toLocaleString('en-US')} source artifacts retained` : ''}.`;
}

function series(participantId: number, c: ConceptRow, db: Db): NodeDetail['series'] {
  const to = DEMO_TODAY;
  const from = addDays(to, -365);
  const empty = { keys: [], points: [], window: { from, to } };
  if (c.data_type === 'file' || c.data_type === 'dicom') return empty;
  if (c.slug === 'physiology.cardiovascular.blood_pressure') {
    const rows = db.all<{ d: string; sys: number; dia: number }>(
      `SELECT substr(observed_at, 1, 10) AS d, AVG(value_num) AS sys, AVG(json_extract(value_json, '$.diastolic')) AS dia FROM observation
        WHERE participant_id = ? AND concept_id = ? AND deleted_at IS NULL AND derivation IS NULL AND substr(observed_at, 1, 10) BETWEEN ? AND ? GROUP BY d ORDER BY d`, participantId, c.id, from, to);
    return {
      keys: [{ key: 'systolic', label: 'Systolic', color: '#1d6ef5' }, { key: 'diastolic', label: 'Diastolic', color: '#8b5cf6' }],
      points: rows.map((r) => ({ t: r.d, values: { systolic: Math.round(r.sys), diastolic: Math.round(r.dia) } })),
      window: { from, to },
    };
  }
  const key = c.slug.split('.').pop() ?? 'value';
  const windowed = c.data_type === 'time_series';
  const rows = db.all<{ d: string; v: number }>(
    `SELECT substr(observed_at, 1, 10) AS d, AVG(value_num) AS v FROM observation
      WHERE participant_id = ? AND concept_id = ? AND deleted_at IS NULL AND derivation IS NULL AND value_num IS NOT NULL ${windowed ? 'AND substr(observed_at, 1, 10) BETWEEN ? AND ?' : ''} GROUP BY d ORDER BY d`,
    ...(windowed ? [participantId, c.id, from, to] : [participantId, c.id]));
  if (!rows.length) return empty;
  const points: SeriesPoint[] = rows.map((r) => ({ t: r.d, values: { [key]: Math.round(r.v * 10) / 10 } }));
  return { keys: [{ key, label: c.name, color: '#1d6ef5' }], points, window: windowed ? { from, to } : { from: rows[0].d, to: rows[rows.length - 1].d } };
}

/** Research use of one node: licenses whose lines cover it (reuse fees) plus verified protocol contributions paid for it. */
function research(participantId: number, c: ConceptRow, db: Db): NodeDetail['research'] {
  const lines = db.all<{ number: number; study: string; org: string; cents: number; date: string }>(
    `SELECT l.number, s.name AS study, o.name AS org, ll.cents, l.term_start AS date FROM license_line ll JOIN license l ON l.id = ll.license_id
       JOIN study s ON s.id = l.study_id JOIN buyer_org o ON o.id = l.buyer_org_id WHERE l.participant_id = ? AND ll.concept_id = ? AND l.revoked_at IS NULL ORDER BY l.term_start`, participantId, c.id);
  // contribution payments for this concept (the license of the same enrollment, when there is one, names the row)
  const payments = db.all<{ number: number | null; study: string; org: string; cents: number; date: string }>(
    `SELECT (SELECT l.number FROM license l JOIN enrollment e ON e.id = l.enrollment_id WHERE e.opportunity_id = ct.opportunity_id ORDER BY l.id DESC LIMIT 1) AS number,
            s.name AS study, o.name AS org, le.participant_cents AS cents, substr(le.occurred_at, 1, 10) AS date
       FROM ledger_entry le JOIN contribution ct ON ct.id = le.contribution_id JOIN study s ON s.id = le.study_id JOIN buyer_org o ON o.id = s.buyer_org_id
      WHERE le.participant_id = ? AND le.kind = 'contribution_payment' AND ct.concept_id = ? ORDER BY le.occurred_at`, participantId, c.id);
  const collecting = db.all<{ vars: string }>("SELECT variables_json AS vars FROM campaign WHERE status = 'active'")
    .filter((r) => (JSON.parse(r.vars) as { conceptSlug: string; mode: string }[]).some((v) => v.conceptSlug === c.slug && v.mode !== 'reuse')).length;
  return {
    licenses: new Set(lines.map((l) => l.number)).size,
    earningsCents: lines.reduce((a, l) => a + l.cents, 0) + payments.reduce((a, l) => a + l.cents, 0),
    requestedBy: collecting,
    lines: [
      ...lines.map((l) => ({ licenseNumber: licenseNumber(l.number), studyName: l.study, orgName: l.org, cents: l.cents, date: l.date })),
      ...payments.map((l) => ({ licenseNumber: l.number ? licenseNumber(l.number) : 'Protocol payment', studyName: l.study, orgName: l.org, cents: l.cents, date: l.date })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
