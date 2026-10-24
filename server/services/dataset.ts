// Built dataset versions (B8). A build snapshots the study's started members under a DATASET-scoped pseudonym; member
// rows are never deleted during the license term — a refresh builds a new version (revoked/withdrawn members drop out
// there, forward-only). Completions auto-bump the version. Every number is a query over dataset_member ⋈ coverage.
import { nowIso } from '@shared/clock';
import { PROVENANCE_CLASSES, type ProvenanceClass } from '@shared/provenance';
import type { Dataset, DatasetSummary, DatasetTab, DatasetVariable, TreeNode, Workspace } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, notFound } from '../errors';
import { logActivity } from './activity';
import { kfloorN } from './cohort';
import { buildTree, conceptBySlug, type ConceptRow } from './ontology';
import { makeSalt, scopedPseudonym } from './pseudonym';
import { STARTED_STATUSES, sqlList } from './state';

/**
 * How a dataset variable is present for a member: 'protocol' = a verified protocol contribution in this study
 * (collect_all); 'reuse' = any existing coverage (reuse); 'either' = a verified contribution OR existing coverage
 * (collect_if_missing: collected from members who lacked it, licensed from the rest).
 */
export type DatasetVar = { slug: string; source: 'protocol' | 'reuse' | 'either' };
const SOURCE_RANK: Record<DatasetVar['source'], number> = { reuse: 0, either: 1, protocol: 2 };
type DatasetRow = { id: number; study_id: number; version: number; status: 'current' | 'superseded'; description: string | null; salt: string; variables_json: string; built_at: string; member_count: number; study_name: string; buyer_org_id: number; purpose: string; license_term_months: number };

const DATASET_LABELS: Record<string, string> = {
  'demographics.basics.age': 'Demographics', 'clinical.encounters.ehr_history': 'EHR', 'clinical.labs.lipid_panel': 'Labs', 'clinical.labs.hba1c': 'HbA1c',
  'biology.genomics.exome': 'Exome', 'physiology.cardiovascular.blood_pressure': 'Blood pressure', 'behavior.nutrition.food_log': 'Nutrition',
  'clinical.medications.medication_list': 'Medications', 'imaging.mri.mri_musculoskeletal': 'Imaging', 'outcomes.patient_reported.symptom_survey': 'Weekly survey',
  'biology.microbiome.gut_microbiome': 'Microbiome', 'physiology.strength.grip_strength': 'Grip strength', 'physiology.metabolic.cgm': 'CGM',
};
export function datasetLabel(c: ConceptRow): string {
  return DATASET_LABELS[c.slug] ?? c.name;
}
function typeOf(c: ConceptRow): DatasetVariable['type'] {
  return c.data_type === 'time_series' ? 'Time series' : c.data_type === 'file' ? 'File/variants' : c.data_type === 'dicom' ? 'DICOM' : 'Structured';
}
const DATASET_SELECT = 'SELECT d.*, s.name AS study_name, s.buyer_org_id, s.purpose, s.license_term_months FROM dataset d JOIN study s ON s.id = d.study_id';

export function currentDataset(studyId: number, db: Db = graph()): { id: number; version: number } | undefined {
  if (!db.tableExists('dataset')) return undefined;
  return db.get<{ id: number; version: number }>("SELECT id, version FROM dataset WHERE study_id = ? AND status = 'current' ORDER BY version DESC LIMIT 1", studyId);
}
function datasetRow(id: number, db: Db): DatasetRow | undefined {
  if (!db.tableExists('dataset')) return undefined;
  return db.get<DatasetRow>(`${DATASET_SELECT} WHERE d.id = ?`, id);
}
function datasetForOrg(orgId: number, id: number, db: Db): DatasetRow {
  const d = datasetRow(id, db);
  if (!d || d.buyer_org_id !== orgId) throw notFound('dataset');
  return d;
}
export function parseDatasetVars(json: string): DatasetVar[] {
  return JSON.parse(json) as DatasetVar[];
}

/** Variables for a study's dataset: demographics first, then every campaign variable (collect_all → 'protocol', collect_if_missing → 'either', reuse → 'reuse'). */
export function defaultVariables(studyId: number, db: Db = graph()): DatasetVar[] {
  const out = new Map<string, DatasetVar>();
  out.set('demographics.basics.age', { slug: 'demographics.basics.age', source: 'reuse' });
  for (const c of db.all<{ variables_json: string }>('SELECT variables_json FROM campaign WHERE study_id = ? ORDER BY (parent_campaign_id IS NULL) DESC, id', studyId)) {
    for (const v of JSON.parse(c.variables_json) as { conceptSlug: string; mode: string }[]) {
      const source: DatasetVar['source'] = v.mode === 'collect_all' ? 'protocol' : v.mode === 'collect_if_missing' ? 'either' : 'reuse';
      const prev = out.get(v.conceptSlug);
      if (!prev || SOURCE_RANK[source] > SOURCE_RANK[prev.source]) out.set(v.conceptSlug, { slug: v.conceptSlug, source });
    }
  }
  return Array.from(out.values());
}

type Member = { pid: number; pseudonym: string; complete: number };
function memberQuery(studyId: number, db: Db): Member[] {
  return db.all<Member>(
    `SELECT e.participant_id AS pid, p.pseudonym, MAX(CASE WHEN op.status = 'paid' THEN 1 ELSE 0 END) AS complete
       FROM enrollment e JOIN opportunity op ON op.id = e.opportunity_id JOIN participant p ON p.id = e.participant_id
      WHERE e.study_id = ? AND e.status IN ('active','completed') AND op.status IN ${sqlList(STARTED_STATUSES)}
        AND EXISTS (SELECT 1 FROM license l WHERE l.enrollment_id = e.id AND l.revoked_at IS NULL)
      GROUP BY e.participant_id ORDER BY e.participant_id`, studyId);
}

/** Build the next version (inside its own tx). Previous versions are superseded, their member rows retained. */
export function buildDataset(db: Db, studyId: number, opts: { now?: string; variables?: DatasetVar[]; reason?: string; log?: boolean } = {}): { id: number; version: number; memberCount: number; added: number; dropped: number } {
  const now = opts.now ?? nowIso();
  const study = db.get<{ name: string; buyer_org_id: number; salt: string }>('SELECT name, buyer_org_id, salt FROM study WHERE id = ?', studyId);
  if (!study) throw notFound('study');
  return db.tx(() => {
    const prev = db.get<{ id: number; version: number; variables_json: string }>("SELECT id, version, variables_json FROM dataset WHERE study_id = ? AND status = 'current' ORDER BY version DESC LIMIT 1", studyId);
    const maxVersion = db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM dataset WHERE study_id = ?', studyId)?.v ?? 0;
    const version = maxVersion + 1;
    const variables = opts.variables ?? mergeVars(prev ? parseDatasetVars(prev.variables_json) : [], defaultVariables(studyId, db));
    const members = memberQuery(studyId, db);
    const prevIds = new Set(prev ? db.all<{ participant_id: number }>('SELECT participant_id FROM dataset_member WHERE dataset_id = ?', prev.id).map((r) => r.participant_id) : []);
    const salt = makeSalt('dataset', version, study.salt);
    const id = db.run(
      "INSERT INTO dataset (study_id, version, status, description, salt, variables_json, built_at, member_count, created_at) VALUES (?,?,'current',?,?,?,?,?,?)",
      studyId, version, `${study.name} — version ${version}: ${members.length.toLocaleString('en-US')} members, ${variables.length} variables${opts.reason ? ` (${opts.reason})` : ''}`, salt, JSON.stringify(variables), now, members.length, now).lastId;
    if (prev) db.run("UPDATE dataset SET status = 'superseded' WHERE id = ?", prev.id);
    for (const m of members) {
      db.run('INSERT INTO dataset_member (dataset_id, participant_id, member_pseudonym, status, added_at, created_at) VALUES (?,?,?,?,?,?)', id, m.pid, scopedPseudonym(m.pseudonym, salt, 'D'), m.complete ? 'row_level' : 'summary_only', now, now);
    }
    const added = members.filter((m) => !prevIds.has(m.pid)).length;
    const dropped = prev ? Array.from(prevIds).filter((p) => !members.some((m) => m.pid === p)).length : 0;
    if (opts.log !== false) logActivity(db, { orgId: study.buyer_org_id, kind: 'dataset', text: `New dataset version available: ${study.name} v${version} (${members.length.toLocaleString('en-US')} members${opts.reason ? `, ${opts.reason}` : ''})`, occurredAt: now });
    return { id, version, memberCount: members.length, added, dropped };
  });
}
function mergeVars(prev: DatasetVar[], next: DatasetVar[]): DatasetVar[] {
  const out = new Map(prev.map((v) => [v.slug, v]));
  for (const v of next) { const p = out.get(v.slug); if (!p || SOURCE_RANK[v.source] > SOURCE_RANK[p.source]) out.set(v.slug, v); }
  return Array.from(out.values());
}

export function refreshDataset(orgId: number, id: number, db: Db = graph()): { datasetId: number; version: number; memberCount: number; dropped: number; added: number } {
  const d = datasetForOrg(orgId, id, db);
  const r = buildDataset(db, d.study_id, { reason: 'manual refresh' });
  return { datasetId: r.id, version: r.version, memberCount: r.memberCount, dropped: r.dropped, added: r.added };
}

function toSummary(d: DatasetRow): DatasetSummary {
  return { id: d.id, studyId: d.study_id, studyName: d.study_name, version: d.version, builtAt: d.built_at, memberCount: kfloorN(d.member_count), status: d.status };
}
export function listDatasets(orgId: number, db: Db = graph()): DatasetSummary[] {
  if (!db.tableExists('dataset')) return [];
  return db.all<DatasetRow>(`${DATASET_SELECT} WHERE s.buyer_org_id = ? ORDER BY (d.status = 'current') DESC, d.built_at DESC, d.id DESC`, orgId).map(toSummary);
}

const RANK_CLASS: Record<number, ProvenanceClass> = { 4: 'clinical_source', 3: 'connected_device', 2: 'photo_derived', 1: 'self_report' };
const SPAN_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '< 30 d', min: -1, max: 29 }, { label: '30 d – 1 y', min: 30, max: 364 }, { label: '1 – 3 y', min: 365, max: 1094 }, { label: '> 3 y', min: 1095, max: 1e9 },
];
const AGE_BANDS = ['< 40', '40–49', '50–59', '60–69', '70+'];
const BAND_SQL = `CASE WHEN p.birth_year > ? THEN '< 40' WHEN p.birth_year > ? THEN '40–49' WHEN p.birth_year > ? THEN '50–59' WHEN p.birth_year > ? THEN '60–69' ELSE '70+' END`;

/**
 * The ONE membership predicate per dataset variable, shared by the variables tab (n / missing %), the missingness tab
 * and the workspace (n and stats): a protocol variable is present for members with a verified contribution for it in
 * this study; a reuse variable for members with any coverage; an 'either' variable (collect_if_missing) for members
 * with one or the other. Returns a subquery of participant ids with its parameters.
 */
const PROTOCOL_MEMBERS_SQL = `SELECT DISTINCT dm.participant_id FROM dataset_member dm JOIN contribution c ON c.participant_id = dm.participant_id AND c.concept_id = ? AND c.status = 'verified'
                JOIN opportunity op ON op.id = c.opportunity_id JOIN campaign cp ON cp.id = op.campaign_id WHERE dm.dataset_id = ? AND cp.study_id = ?`;
const REUSE_MEMBERS_SQL = 'SELECT dm.participant_id FROM dataset_member dm JOIN participant_coverage cv ON cv.participant_id = dm.participant_id AND cv.concept_id = ? AND cv.n_obs > 0 WHERE dm.dataset_id = ?';
function presentMembersSql(d: Pick<DatasetRow, 'id' | 'study_id'>, v: DatasetVar & { concept: ConceptRow }): { sql: string; params: number[] } {
  const protocol = { sql: PROTOCOL_MEMBERS_SQL, params: [v.concept.id, d.id, d.study_id] };
  const reuse = { sql: REUSE_MEMBERS_SQL, params: [v.concept.id, d.id] };
  if (v.source === 'protocol') return protocol;
  if (v.source === 'reuse') return reuse;
  return { sql: `${protocol.sql} UNION ${reuse.sql}`, params: [...protocol.params, ...reuse.params] };
}

export function datasetDetail(orgId: number, id: number, tab: DatasetTab | undefined, db: Db = graph()): Dataset {
  const d = datasetForOrg(orgId, id, db);
  const vars = parseDatasetVars(d.variables_json).map((v) => ({ ...v, concept: conceptBySlug(v.slug, db) })).filter((v): v is DatasetVar & { concept: ConceptRow } => !!v.concept);
  const total = d.member_count;
  const scalar = (sql: string, ...p: (number | string)[]) => db.get<{ n: number }>(sql, ...p)?.n ?? 0;
  const presentCount = (v: DatasetVar & { concept: ConceptRow }) => { const m = presentMembersSql(d, v); return scalar(`SELECT COUNT(*) AS n FROM (${m.sql})`, ...m.params); };
  const pct = (present: number) => (total ? Math.round(((total - present) / total) * 1000) / 10 : 0);
  const variables: DatasetVariable[] = vars.map((v) => { const n = presentCount(v); return { slug: v.slug, label: datasetLabel(v.concept), type: typeOf(v.concept), missingPct: pct(n), n: kfloorN(n) }; });
  const rowLevel = scalar("SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ? AND status = 'row_level'", d.id);
  const want = (t: DatasetTab) => !tab || tab === t;
  const year = Number(nowIso().slice(0, 4));
  const bandParams = [year - 40, year - 50, year - 60, year - 70];
  const bandTotals = new Map(db.all<{ band: string; n: number }>(`SELECT ${BAND_SQL} AS band, COUNT(*) AS n FROM dataset_member dm JOIN participant p ON p.id = dm.participant_id WHERE dm.dataset_id = ? GROUP BY band`, ...bandParams, d.id).map((r) => [r.band, r.n]));

  const provenance = want('provenance') ? vars.map((v) => {
    const classes: { cls: ProvenanceClass; pct: number }[] = [];
    if (v.source === 'protocol') {
      const n = presentCount(v);
      for (const cls of PROVENANCE_CLASSES) classes.push({ cls, pct: cls === 'protocol_measurement' && n ? 100 : 0 });
    } else {
      // reuse: by the member's best provenance rank; either: verified contributors count as protocol measurement, the rest by rank
      const protocolN = v.source === 'either' ? scalar(`SELECT COUNT(*) AS n FROM (${PROTOCOL_MEMBERS_SQL})`, v.concept.id, d.id, d.study_id) : 0;
      const rows = db.all<{ r: number; n: number }>(
        `SELECT cv.best_prov_rank AS r, COUNT(*) AS n FROM dataset_member dm JOIN participant_coverage cv ON cv.participant_id = dm.participant_id AND cv.concept_id = ? AND cv.n_obs > 0
          WHERE dm.dataset_id = ?${v.source === 'either' ? ` AND dm.participant_id NOT IN (${PROTOCOL_MEMBERS_SQL})` : ''} GROUP BY r`,
        ...(v.source === 'either' ? [v.concept.id, d.id, v.concept.id, d.id, d.study_id] : [v.concept.id, d.id]));
      const n = rows.reduce((a, r) => a + r.n, 0) + protocolN;
      const byClass = new Map<ProvenanceClass, number>();
      if (protocolN) byClass.set('protocol_measurement', protocolN);
      for (const r of rows) byClass.set(RANK_CLASS[r.r] ?? 'self_report', (byClass.get(RANK_CLASS[r.r] ?? 'self_report') ?? 0) + r.n);
      for (const cls of PROVENANCE_CLASSES) classes.push({ cls, pct: n ? Math.round(((byClass.get(cls) ?? 0) / n) * 1000) / 10 : 0 });
    }
    return { slug: v.slug, label: datasetLabel(v.concept), classes };
  }) : [];

  const missingness = want('missingness') ? vars.map((v) => {
    const m = presentMembersSql(d, v);
    const rows = db.all<{ band: string; n: number }>(`SELECT ${BAND_SQL} AS band, COUNT(*) AS n FROM (${m.sql}) pm JOIN participant p ON p.id = pm.participant_id GROUP BY band`, ...bandParams, ...m.params);
    const present = new Map(rows.map((r) => [r.band, r.n]));
    const n = rows.reduce((a, r) => a + r.n, 0);
    return {
      slug: v.slug, label: datasetLabel(v.concept), missingPct: pct(n),
      byGroup: AGE_BANDS.filter((b) => (bandTotals.get(b) ?? 0) > 0).map((b) => ({ label: b, missingPct: Math.round((((bandTotals.get(b) ?? 0) - (present.get(b) ?? 0)) / (bandTotals.get(b) ?? 1)) * 1000) / 10 })),
    };
  }) : [];

  const longitudinal = want('longitudinal') ? vars.map((v) => {
    const rows = db.all<{ span: number; n: number }>('SELECT cv.span_days AS span, COUNT(*) AS n FROM dataset_member dm JOIN participant_coverage cv ON cv.participant_id = dm.participant_id AND cv.concept_id = ? AND cv.n_obs > 0 WHERE dm.dataset_id = ? GROUP BY span', v.concept.id, d.id);
    return { slug: v.slug, label: datasetLabel(v.concept), buckets: SPAN_BUCKETS.map((b) => ({ label: b.label, n: kfloorN(rows.filter((r) => r.span >= b.min && r.span <= b.max).reduce((a, r) => a + r.n, 0)) })) };
  }) : [];

  const ontology: TreeNode[] = want('ontology') ? pruneTree(buildTree((c) => ({ state: vars.some((v) => v.slug === c.slug) ? 'verified' : 'missing', overlay: { opportunity: false, demand: false }, pct: vars.some((v) => v.slug === c.slug) ? 100 : 0 }), db, { includeHidden: true }), new Set(vars.map((v) => v.slug))) : [];

  const documentation = want('documentation') ? [
    { title: 'Purpose', body: `${d.purpose}. Licensed to the sponsor for this purpose only; participants may revoke forward-only at any time.` },
    { title: 'Membership', body: `Version ${d.version} built ${d.built_at.slice(0, 10)}: ${d.member_count.toLocaleString('en-US')} enrolled participants who started the protocol; ${rowLevel.toLocaleString('en-US')} completed every task (row-level access), the rest contribute to summaries only. Members who withdraw or revoke leave the next version; versions already built are retained for the ${d.license_term_months}-month license term.` },
    { title: 'Identity', body: 'No direct identifiers are ever present. Each member carries a pseudonym scoped to this dataset version (sha256 of the platform pseudonym and a version salt); age is banded, location is country-level, and aggregates under 20 are floored.' },
    { title: 'Provenance', body: 'Every value carries a provenance class (clinical source, connected device, protocol measurement, photo-derived, self-report) and a verification flag. Protocol variables were collected under the study protocol and verified by the platform before payment.' },
    { title: 'Consent terms', body: `Each member accepted a ${d.license_term_months}-month license covering exactly the listed variables, no future reuse without a new consent, and recontact only through the platform. The sponsor pays the gross fee; 90 % is passed to the participant.` },
    { title: 'Versioning', body: 'A new version is built automatically when enrolled participants complete their protocol, when a variable is added, or on manual refresh. Superseded versions remain queryable for reproducibility.' },
  ] : [];

  const exportRequests = db.tableExists('export_request') ? db.all<{ id: number; status: string; created_at: string; variables_json: string }>('SELECT id, status, created_at, variables_json FROM export_request WHERE dataset_id = ? ORDER BY id DESC', d.id)
    .map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, variables: JSON.parse(r.variables_json) as string[] })) : [];

  return {
    ...toSummary(d),
    tab,
    description: d.description ?? '',
    rowLevelN: kfloorN(rowLevel), summaryOnlyN: kfloorN(total - rowLevel),
    variables, documentation, provenance, missingness, longitudinal, ontology, exportRequests,
  };
}

function pruneTree(tree: TreeNode[], keep: Set<string>): TreeNode[] {
  return tree.map((d) => ({ ...d, children: d.children.map((g) => ({ ...g, children: g.children.filter((l) => keep.has(l.slug)) })).filter((g) => g.children.length) })).filter((d) => d.children.length);
}

/** Workspace: per variable, n = the SAME member subset as the variables tab (presentMembersSql); stats over that subset's latest values. */
export function workspace(orgId: number, id: number, db: Db = graph()): Workspace {
  const d = datasetForOrg(orgId, id, db);
  const vars = parseDatasetVars(d.variables_json).map((v) => ({ ...v, concept: conceptBySlug(v.slug, db) })).filter((v): v is DatasetVar & { concept: ConceptRow } => !!v.concept);
  const rowLevel = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ? AND status = 'row_level'", d.id)?.n ?? 0;
  return {
    datasetId: d.id, rowLevelN: kfloorN(rowLevel), summaryOnlyN: kfloorN(d.member_count - rowLevel),
    variables: vars.map((v) => {
      const c = v.concept;
      const m = presentMembersSql(d, v);
      const r = db.get<{ n: number; numeric: number; mean: number | null; sq: number | null; min: number | null; max: number | null }>(
        `SELECT COUNT(*) AS n, COUNT(cv.last_value_num) AS numeric, AVG(cv.last_value_num) AS mean, AVG(cv.last_value_num * cv.last_value_num) AS sq, MIN(cv.last_value_num) AS min, MAX(cv.last_value_num) AS max
           FROM (${m.sql}) pm LEFT JOIN participant_coverage cv ON cv.participant_id = pm.participant_id AND cv.concept_id = ? AND cv.n_obs > 0`, ...m.params, c.id);
      const n = r?.n ?? 0;
      const numeric = (r?.numeric ?? 0) > 0 && r?.mean !== null && r?.mean !== undefined;
      const sd = numeric && r ? Math.sqrt(Math.max(0, (r.sq ?? 0) - (r.mean ?? 0) ** 2)) : null;
      const round = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
      return { slug: c.slug, label: datasetLabel(c), n: kfloorN(n), mean: numeric ? round(r!.mean) : null, sd: numeric ? round(sd) : null, min: numeric ? round(r!.min) : null, max: numeric ? round(r!.max) : null, unit: c.unit };
    }),
  };
}

export function createExportRequest(orgId: number, id: number, variables: string[] | undefined, db: Db = graph()): { id: number; status: string; variables: string[] } {
  const d = datasetForOrg(orgId, id, db);
  const allowed = new Set(parseDatasetVars(d.variables_json).map((v) => v.slug));
  const vars = variables && variables.length ? variables : Array.from(allowed);
  for (const v of vars) if (!allowed.has(v)) throw badRequest(`variable ${v} is not part of this dataset`);
  const now = nowIso();
  const reqId = db.tx(() => {
    const rid = db.run("INSERT INTO export_request (dataset_id, buyer_org_id, status, variables_json, created_at) VALUES (?,?,'requested',?,?)", d.id, orgId, JSON.stringify(vars), now).lastId;
    logActivity(db, { orgId, kind: 'export', text: `${d.study_name} v${d.version}: approved export requested (${vars.length} variables) — pending governance review`, occurredAt: now });
    return rid;
  });
  return { id: reqId, status: 'requested', variables: vars };
}
