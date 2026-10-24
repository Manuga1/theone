// Cohort engine: one pass builds a temp table `pv` of demographic matches with per-modality flags; the funnel,
// missing-data matrix, heatmap and any-data bars are SUM(CASE …) aggregates over it. Results are cached by
// criteria hash + db.writeVersion. The B3 funnel uses the HISTORICAL requirement branch only.
import { performance } from 'node:perf_hooks';
import { DEMO_TODAY } from '@shared/clock';
import { CohortCriteria as CriteriaSchema, type CohortCriteria } from '@shared/criteria';
import { HEATMAP_COLUMNS, PROHIBITED_USE_KEYS, domainOf, shortName } from '@shared/ontology';
import type { CampaignVariable } from '@shared/requirement';
import type { CohortPreview, FunnelStage, HeatCell, MissingGroup } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { criteriaHash } from './cohort-hash';
import { estimatedAfter, type GroupInput } from './estimate';

export type CohortOptions = {
  orgId: number;
  /** Campaign variables: groups are then keyed by the set of variables that must be collected. */
  variables?: CampaignVariable[];
  /** Exclude participants with an open opportunity in this study from `recruitable`. */
  openOpportunityStudyId?: number;
  /** Exclude participants that already hold ANY opportunity in this campaign (recontact / replacement offers). */
  openOpportunityCampaignId?: number;
  skipCache?: boolean;
};

export type Evaluation = {
  total: number;
  funnel: FunnelStage[];
  readyNow: number;
  baseN: number;
  recontactBase: number;
  groups: GroupInput[];
  notRecruitable: { label: string; n: number }[];
  heatmap: CohortPreview['heatmap'];
  bars: CohortPreview['bars'];
  consent: { blocked: boolean; reason: string | null };
  timingMs: number;
  /** SQL fragments over the temp table `pv` (valid only right after an uncached evaluation; see recruitablePool). */
  poolSql: { where: string; collectExpr: string; specs: Spec[] } | null;
};

/** Ready-now member (satisfies every variable historically) eligible for a reuse-only license offer. */
export type ReadyMember = { pid: number; preauthorized: boolean };

export type PoolMember = { pid: number; slugs: string[] };

export type Spec = { slug: string; id: number; minSpanDays: number; minProvRank: number; enrichable: boolean; alwaysCollect: boolean; mustHave: boolean; name: string };
type ConceptRow = { id: number; slug: string; name: string; enrichable: number; sort_order: number };

/** What the B5 any-data bars measure (additive `CohortPreview.barsNote`). */
export const BARS_NOTE = 'Share of the cohort base with any data for the variable, including data collected by running campaigns — the bars move as collection campaigns complete.';

const DEMO_YEAR = Number(DEMO_TODAY.slice(0, 4));
const OPEN_STATUSES = "('offered','viewed','reviewed','accepted','in_progress','submitted')";

const caches = new WeakMap<Db, Map<string, Evaluation>>();

export function invalidateCohortCache(db: Db = graph()): void {
  caches.delete(db);
}

export function orgConsent(orgId: number, db: Db = graph()): { blocked: boolean; reason: string | null; type: string; name: string } {
  const org = db.tableExists('buyer_org') ? db.get<{ name: string; type: string; declared_uses_json: string }>('SELECT name, type, declared_uses_json FROM buyer_org WHERE id = ?', orgId) : undefined;
  if (!org) return { blocked: false, reason: null, type: 'other', name: '' };
  const uses = JSON.parse(org.declared_uses_json) as string[];
  const hit = uses.filter((u) => PROHIBITED_USE_KEYS.includes(u));
  return hit.length
    ? { blocked: true, reason: `Declared use "${hit[0].replace(/_/g, ' ')}" conflicts with participant red-lines; no participant data is available to ${org.name}.`, type: org.type, name: org.name }
    : { blocked: false, reason: null, type: org.type, name: org.name };
}

export function evaluateCohort(rawCriteria: CohortCriteria, opts: CohortOptions, db: Db = graph()): Evaluation {
  const criteria = CriteriaSchema.parse(rawCriteria);
  const key = criteriaHash(criteria, { orgId: opts.orgId, variables: opts.variables ?? null, study: opts.openOpportunityStudyId ?? null, campaign: opts.openOpportunityCampaignId ?? null }) + ':' + db.writeVersion;
  let cache = caches.get(db);
  if (!cache) { cache = new Map(); caches.set(db, cache); }
  if (!opts.skipCache) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const t0 = performance.now();
  const ev = compute(criteria, opts, db);
  ev.timingMs = Math.round((performance.now() - t0) * 10) / 10;
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  cache.set(key, ev);
  return ev;
}

function compute(c: CohortCriteria, opts: CohortOptions, db: Db): Evaluation {
  const consent = orgConsent(opts.orgId, db);
  const ready = db.tableExists('participant') && db.tableExists('concept');
  const conceptRows = ready ? db.all<ConceptRow>('SELECT id, slug, name, enrichable, sort_order FROM concept') : [];
  const concepts = new Map(conceptRows.map((r) => [r.slug, r]));
  const total = ready ? (db.get<{ n: number }>('SELECT COUNT(*) AS n FROM participant')?.n ?? 0) : 0;

  // ---- specs: the modalities we evaluate (criteria modalities, or campaign variables) ----
  const modSpecs: Spec[] = c.modalities.filter((m) => concepts.has(m.slug)).map((m) => {
    const k = concepts.get(m.slug)!;
    return { slug: m.slug, id: k.id, minSpanDays: m.minSpanDays, minProvRank: m.minProvRank, enrichable: !!k.enrichable, alwaysCollect: false, mustHave: !k.enrichable, name: k.name };
  });
  const varSpecs: Spec[] | null = opts.variables
    ? opts.variables.filter((v) => concepts.has(v.conceptSlug)).map((v) => {
        const k = concepts.get(v.conceptSlug)!;
        const h = v.requirement.historical;
        return { slug: v.conceptSlug, id: k.id, minSpanDays: h?.minSpanDays ?? 0, minProvRank: h?.minProvRank ?? 1, enrichable: v.mode !== 'reuse', alwaysCollect: v.mode === 'collect_all', mustHave: v.mode === 'reuse' && !!h, name: k.name };
      })
    : null;
  const groupSpecs = varSpecs ?? modSpecs;
  const funnelLabels = [
    'Total participants',
    'Demographic match',
    conditionLabel(c, concepts),
    ...modSpecs.map((s) => stageLabel(s)),
  ];

  const blockedResult = (): Evaluation => ({
    total: 0, funnel: funnelLabels.map((label, i) => ({ key: `s${i}`, label, n: 0 })), readyNow: 0, baseN: 0, recontactBase: 0, groups: [], notRecruitable: [],
    heatmap: { columns: HEATMAP_COLUMNS, rows: [] }, bars: HEATMAP_COLUMNS.map((h) => ({ slug: h.slug, label: h.label, pct: 0 })), consent, timingMs: 0, poolSql: null,
  });
  if (!ready || consent.blocked) return blockedResult();

  // ---- build pv: one GROUP BY pass over participant ⋈ coverage. Each distinct coverage predicate is computed once
  // as MAX(CASE …) (aliases x0..xn); the outer SELECT maps them onto the m/v/h/a/lab flag names the aggregates use.
  const params: (number | string)[] = [];
  const wanted = new Set<number>();
  const exprs: string[] = [];
  const exprParams: (number | string)[] = [];
  const aliasOf = new Map<string, string>();
  const register = (key: string, sql: string, ps: (number | string)[]): string => {
    let a = aliasOf.get(key);
    if (!a) { a = `x${exprs.length}`; aliasOf.set(key, a); exprs.push(`${sql} AS ${a}`); exprParams.push(...ps); }
    return a;
  };
  const histExpr = (s: Spec) => {
    wanted.add(s.id);
    return register(`h:${s.id}:${s.minSpanDays}:${s.minProvRank}`, 'MAX(CASE WHEN cv.concept_id = ? AND cv.span_days >= ? AND cv.best_prov_rank >= ? THEN 1 ELSE 0 END)', [s.id, s.minSpanDays, s.minProvRank]);
  };
  const anyExpr = (id: number) => {
    wanted.add(id);
    return register(`a:${id}`, 'MAX(CASE WHEN cv.concept_id = ? THEN 1 ELSE 0 END)', [id]);
  };
  // NOTE: per-participant predicates come first in the SQL text, so their params are pushed first.
  const condExprs = c.conditions.filter((s) => concepts.has(s)).map((s) => {
    params.push(concepts.get(s)!.id);
    return `EXISTS (SELECT 1 FROM condition cd WHERE cd.participant_id = p.id AND cd.concept_id = ? AND cd.status = 'active')`;
  });
  const openParts: string[] = [];
  if (opts.openOpportunityStudyId) {
    params.push(opts.openOpportunityStudyId);
    openParts.push(`EXISTS (SELECT 1 FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id WHERE op.participant_id = p.id AND cp.study_id = ? AND op.status IN ${OPEN_STATUSES})`);
  }
  if (opts.openOpportunityCampaignId) {
    params.push(opts.openOpportunityCampaignId);
    openParts.push('EXISTS (SELECT 1 FROM opportunity op WHERE op.participant_id = p.id AND op.campaign_id = ?)');
  }
  const openOpp = openParts.length ? `(${openParts.join(' OR ')})` : '0';
  const outer: string[] = [];
  modSpecs.forEach((s, i) => outer.push(`${histExpr(s)} AS m${i}`));
  if (varSpecs) varSpecs.forEach((s, i) => outer.push(`${histExpr(s)} AS v${i}`));
  HEATMAP_COLUMNS.forEach((h, i) => {
    const ms = modSpecs.find((s) => s.slug === h.slug);
    const k = concepts.get(h.slug);
    outer.push(`${ms ? histExpr(ms) : k ? anyExpr(k.id) : '0'} AS h${i}`);
    outer.push(`${k ? anyExpr(k.id) : '0'} AS a${i}`);
  });
  const labAliases = c.labs.filter((l) => concepts.has(l.slug)).map((l) => {
    const id = concepts.get(l.slug)!.id;
    wanted.add(id);
    return register(`l:${id}:${l.op}:${l.value}`, `MAX(CASE WHEN cv.concept_id = ? AND cv.last_value_num ${l.op} ? THEN 1 ELSE 0 END)`, [id, l.value]);
  });
  params.push(...exprParams);
  const inList = Array.from(wanted);
  params.push(...inList);

  const where: string[] = [];
  const d = c.demographics;
  if (d.country) { params.push(d.country); where.push('p.country = ?'); }
  if (d.ageMin !== undefined) { params.push(DEMO_YEAR - d.ageMin); where.push('p.birth_year <= ?'); }
  if (d.ageMax !== undefined) { params.push(DEMO_YEAR - d.ageMax); where.push('p.birth_year >= ?'); }
  if (d.sex && d.sex !== 'any') { params.push(d.sex); where.push('p.sex = ?'); }
  if (c.requireRecontact) where.push('cs.recontact_opt_in = 1');

  // Participant is scanned in rowid order (NOT INDEXED): the consent/coverage joins then read sequentially and the
  // GROUP BY needs no temp B-tree. A full scan of the participant table is ~15 ms at full scale.
  const inner = `SELECT p.id AS pid, COALESCE(cs.recontact_opt_in, 0) AS recontact, COALESCE(cs.commercial_ok, 1) AS commercial, COALESCE(cs.excluded_categories_json, '[]') AS excl,
      ${condExprs.length ? `(${condExprs.join(' AND ')})` : '1'} AS cond_ok, ${openOpp} AS open_opp${exprs.length ? ', ' + exprs.join(', ') : ''}
    FROM participant p NOT INDEXED
    LEFT JOIN consent_setting cs ON cs.participant_id = p.id
    LEFT JOIN participant_coverage cv ON cv.participant_id = p.id AND cv.n_obs > 0 AND cv.concept_id IN (${inList.map(() => '?').join(', ') || 'NULL'})
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY p.id`;
  const baseExpr = ['cond_ok', ...labAliases].join(' AND ');
  const sel = `SELECT pid, recontact, commercial, excl, open_opp, (${baseExpr}) AS base${outer.length ? ', ' + outer.join(', ') : ''} FROM (${inner})`;
  db.exec('DROP TABLE IF EXISTS temp.pv');
  db.run(`CREATE TEMP TABLE pv AS ${sel}`, ...params);

  // ---- funnel ----
  const prefix = (n: number) => ['base', ...modSpecs.slice(0, n).map((_, i) => `m${i}`)].join(' AND ');
  const allM = prefix(modSpecs.length);
  const sums = [
    'COUNT(*) AS demo',
    'SUM(base) AS base_n',
    ...modSpecs.map((_, i) => `SUM(CASE WHEN ${prefix(i + 1)} THEN 1 ELSE 0 END) AS f${i}`),
    `SUM(CASE WHEN ${allM} AND recontact = 1 THEN 1 ELSE 0 END) AS ready_recontact`,
    'SUM(CASE WHEN base AND recontact = 1 THEN 1 ELSE 0 END) AS recontact_base',
    ...HEATMAP_COLUMNS.map((_, i) => `SUM(CASE WHEN base AND a${i} THEN 1 ELSE 0 END) AS bar${i}`),
  ];
  const agg = db.get<Record<string, number>>(`SELECT ${sums.join(', ')} FROM pv`)!;
  const funnelN = [total, agg.demo ?? 0, agg.base_n ?? 0, ...modSpecs.map((_, i) => agg[`f${i}`] ?? 0)];
  const funnel: FunnelStage[] = funnelN.map((n, i) => ({ key: i === 0 ? 'total' : i === 1 ? 'demographics' : i === 2 ? 'conditions' : modSpecs[i - 3].slug, label: funnelLabels[i], n: n ?? 0 }));
  const readyNow = funnelN[funnelN.length - 1] ?? 0;
  const baseN = agg.base_n ?? 0;

  // ---- recruitable predicate ----
  const requiredDomains = Array.from(new Set(groupSpecs.map((s) => domainOf(s.slug))));
  const exclOk = requiredDomains.length ? requiredDomains.map((dm) => `instr(excl, '"${dm}"') = 0`).join(' AND ') : '1';
  const commercialOk = consent.type === 'academic' ? '1' : 'commercial = 1';
  const recruitable = `(recontact = 1 AND ${exclOk} AND ${commercialOk} AND open_opp = 0)`;

  // ---- missing-data matrix: groups keyed by the set of (enrichable) specs that must be collected ----
  const flag = (s: Spec, i: number) => (varSpecs ? `v${i}` : `m${i}`);
  const mustHave = groupSpecs.map((s, i) => (s.mustHave ? flag(s, i) : null)).filter((x): x is string => !!x);
  const collectExpr = groupSpecs.map((s, i) => (s.mustHave ? "''" : s.alwaysCollect ? `'${i},'` : `(CASE WHEN ${flag(s, i)} THEN '' ELSE '${i},' END)`)).join(' || ');
  const groupWhere = ['base', ...mustHave].join(' AND ');
  const groupRows = groupSpecs.length
    ? db.all<{ gkey: string; eligible: number; recruitable: number }>(
        `SELECT gkey, COUNT(*) AS eligible, SUM(CASE WHEN ${recruitable} THEN 1 ELSE 0 END) AS recruitable
           FROM (SELECT ${collectExpr} AS gkey, recontact, excl, commercial, open_opp FROM pv WHERE ${groupWhere}) g
          WHERE gkey <> '' GROUP BY gkey`)
    : [];
  // group labels follow the canonical ontology order (concept.sort_order), whatever order the criteria listed the modalities in
  const sortOrder = (slug: string) => concepts.get(slug)?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const groups: GroupInput[] = groupRows.map((r) => {
    const idx = r.gkey.split(',').filter(Boolean).map(Number);
    const slugs = idx.map((i) => groupSpecs[i].slug).sort((a, b) => sortOrder(a) - sortOrder(b));
    return { key: groupKey(slugs), label: groupLabel(slugs), slugs, eligible: r.eligible, recruitable: r.recruitable };
  });
  groups.sort((a, b) => a.slugs.length - b.slugs.length || b.eligible - a.eligible);

  const notRecruitable = groupSpecs
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.mustHave)
    .map(({ s, i }) => ({
      label: `Not recruitable — requires history: ${shortName(s.slug)}${s.minSpanDays ? ` ≥ ${spanLabel(s.minSpanDays)}` : ''}`,
      n: db.get<{ n: number }>(`SELECT SUM(CASE WHEN base AND NOT ${flag(s, i)} THEN 1 ELSE 0 END) AS n FROM pv`)?.n ?? 0,
    }));

  // ---- heatmap rows: complete cohort + the first three groups ----
  const cellSums = HEATMAP_COLUMNS.map((_, i) => `SUM(CASE WHEN h${i} THEN 1 ELSE 0 END) AS c${i}`).join(', ');
  const rowFor = (label: string, cond: string): { label: string; n: number; cells: HeatCell[] } => {
    const r = db.get<Record<string, number>>(`SELECT COUNT(*) AS n, ${cellSums} FROM pv WHERE ${cond}`)!;
    const n = r.n ?? 0;
    return { label, n, cells: HEATMAP_COLUMNS.map((_, i) => cell(n ? (r[`c${i}`] ?? 0) / n : 0)) };
  };
  const heatRows = [rowFor('Complete cohort', allM)];
  const groupCond = (g: GroupInput) => {
    const key = g.slugs.map((s) => groupSpecs.findIndex((x) => x.slug === s)).sort((a, b) => a - b).map((i) => `${i},`).join('');
    return `${groupWhere} AND (${collectExpr}) = '${key}'`;
  };
  groups.slice(0, 3).forEach((g, i) => heatRows.push(rowFor(`Group ${'ABC'[i]} — ${g.label}`, groupCond(g))));

  const bars = HEATMAP_COLUMNS.map((h, i) => ({ slug: h.slug, label: h.label, pct: baseN ? Math.round(((agg[`bar${i}`] ?? 0) / baseN) * 1000) / 10 : 0 }));

  return {
    total, funnel, readyNow, baseN, recontactBase: agg.recontact_base ?? 0, groups, notRecruitable,
    heatmap: { columns: HEATMAP_COLUMNS, rows: heatRows }, bars, consent, timingMs: 0,
    poolSql: groupSpecs.length ? { where: `${groupWhere} AND ${recruitable}`, collectExpr, specs: groupSpecs } : null,
  };
}

/**
 * The recruitable pool for a campaign: every base member that must collect at least one variable and passes the
 * recruitable predicate, with the slugs to collect. Runs an uncached evaluation and reads `pv` in the same
 * synchronous block (the temp table is connection-global). Members with nothing to collect are excluded.
 */
export function recruitablePool(criteria: CohortCriteria, opts: CohortOptions, db: Db = graph()): { ev: Evaluation; members: PoolMember[]; ready: ReadyMember[] } {
  const ev = evaluateCohort(criteria, { ...opts, skipCache: true }, db);
  if (!ev.poolSql) return { ev, members: [], ready: [] };
  const { where, collectExpr, specs } = ev.poolSql;
  const rows = db.all<{ pid: number; gkey: string }>(`SELECT pid, (${collectExpr}) AS gkey FROM pv WHERE ${where} AND (${collectExpr}) <> '' ORDER BY pid`);
  const members = rows.map((r) => ({ pid: r.pid, slugs: r.gkey.split(',').filter(Boolean).map((i) => specs[Number(i)].slug) }));
  // ready-now: nothing to collect (every variable satisfied historically) but still recruitable → reuse-only license offer
  const ready = db.all<{ pid: number; pre: number }>(
    `SELECT pv.pid, COALESCE(cs.preauthorize_reuse_only, 0) AS pre FROM pv LEFT JOIN consent_setting cs ON cs.participant_id = pv.pid WHERE ${where} AND (${collectExpr}) = '' ORDER BY pv.pid`)
    .map((r) => ({ pid: r.pid, preauthorized: r.pre === 1 }));
  return { ev, members, ready };
}

function cell(share: number): HeatCell {
  return share >= 0.9 ? 'complete' : share >= 0.3 ? 'partial' : 'missing';
}
export function spanLabel(days: number): string {
  if (days >= 365) return `${Math.round(days / 365)} y`;
  if (days >= 60) return `${Math.round(days / 30)} mo`;
  return `${days} d`;
}
function stageLabel(s: Spec): string {
  const name = shortName(s.slug);
  if (s.slug.endsWith('ehr_history')) return `Sufficient EHR (≥ ${spanLabel(s.minSpanDays)})`;
  if (s.minSpanDays >= 365) return `Longitudinal ${name} (≥ ${spanLabel(s.minSpanDays)})`;
  if (s.minSpanDays > 0) return `${name} history (≥ ${spanLabel(s.minSpanDays)})`;
  return name;
}
function conditionLabel(c: CohortCriteria, concepts: Map<string, ConceptRow>): string {
  const names = c.conditions.map((s) => shortName(s).toLowerCase());
  const labs = c.labs.map((l) => `${shortName(l.slug)} ${l.op} ${l.value}`);
  const parts = [...names, ...labs];
  if (!parts.length) return 'Clinical match';
  const label = parts.join(' + ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export function groupKey(slugs: string[]): string {
  const names = slugs.map((s) => shortName(s).toLowerCase().replace(/[^a-z0-9]+/g, '_'));
  return names.length === 1 ? `${names[0]}_only` : names.join('_');
}
export function groupLabel(slugs: string[]): string {
  const names = slugs.map((s) => shortName(s));
  if (names.length === 1) return `${names[0]} only`;
  return names.map((n, i) => (i === 0 || n === n.toUpperCase() ? n : n.toLowerCase())).join(' + ');
}

/** Buyer-facing preview with the k-anonymity floor applied (counts 1–19 are reported as 19 → rendered "<20"). */
export function previewFor(criteria: CohortCriteria, orgId: number, db: Db = graph()): CohortPreview {
  const ev = evaluateCohort(criteria, { orgId }, db);
  const after = estimatedAfter(ev.readyNow, ev.groups);
  const groups: MissingGroup[] = ev.groups.map((g) => ({ key: g.key, label: g.label, conceptSlugs: g.slugs, eligible: kfloorN(g.eligible), recruitable: kfloorN(g.recruitable) }));
  return {
    total: kfloorN(ev.total),
    funnel: ev.funnel.map((f) => ({ ...f, n: kfloorN(f.n) })),
    readyNow: kfloorN(ev.readyNow),
    matrix: { groups, notRecruitable: ev.notRecruitable.map((r) => ({ ...r, n: kfloorN(r.n) })), estimatedAfter: { low: kfloorN(after.low), high: kfloorN(after.high), point: kfloorN(after.point) } },
    heatmap: { columns: ev.heatmap.columns, rows: ev.heatmap.rows.map((r) => ({ ...r, n: kfloorN(r.n) })) },
    bars: ev.bars,
    barsNote: BARS_NOTE,
    consent: ev.consent,
    timingMs: ev.timingMs,
  };
}

/** k-floor for buyer aggregates: 0 stays 0, 1–19 become 19 (the client renders anything < 20 as "<20"). */
export function kfloorN(n: number): number {
  return n > 0 && n < 20 ? 19 : n;
}
