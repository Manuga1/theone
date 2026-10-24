// Campaign / study side of the loop: draft → proposal → launch (offers, never licenses), counters (always GROUP BY
// status), study reads (B7), the scoped participant list and recontact (replacement offers).
import { DEMO_TODAY, nowIso } from '@shared/clock';
import { CohortCriteria as CriteriaSchema, type CohortCriteria } from '@shared/criteria';
import { shortName } from '@shared/ontology';
import { Rng } from '@shared/rng';
import type { CampaignVariable } from '@shared/requirement';
import type { Campaign, CampaignCreate, CampaignStatus, CostLine, Estimate, StudyCounters, StudyDetail, StudyParticipants, StudySummary } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, forbidden, notFound, conflict } from '../errors';
import { logActivity } from './activity';
import { kfloorN, orgConsent, recruitablePool, evaluateCohort, spanLabel } from './cohort';
import { buildEstimate, contactsForTarget } from './estimate';
import { conceptBySlug, concepts } from './ontology';
import { makeSalt, scopedPseudonym } from './pseudonym';
import { assertTransition, CAMPAIGN_TRANSITIONS, OPPORTUNITY_TRANSITIONS, REPLACEABLE_STATUSES, STARTED_STATUSES, sqlList } from './state';
import { currentDataset } from './dataset';

export type SeedVariable = CampaignVariable & { label?: string };

export type StudyRow = {
  id: number; buyer_org_id: number; cohort_definition_id: number | null; name: string; purpose: string; use_tags_json: string; license_term_months: number;
  target_n: number; salt: string; status: StudySummary['status']; advanced_days: number; updated_at: string; created_at: string; org_name: string; criteria_json: string | null;
};
export type CampaignRow = {
  id: number; study_id: number; parent_campaign_id: number | null; name: string; status: CampaignStatus; target_complete_n: number; eligible_n: number;
  variables_json: string; estimate_json: string | null; launched_at: string | null; closed_at: string | null; created_at: string;
};

const STUDY_SELECT = `SELECT s.*, o.name AS org_name, cd.criteria_json FROM study s JOIN buyer_org o ON o.id = s.buyer_org_id LEFT JOIN cohort_definition cd ON cd.id = s.cohort_definition_id`;

export function studyRow(id: number, db: Db = graph()): StudyRow | undefined {
  if (!db.tableExists('study')) return undefined;
  return db.get<StudyRow>(`${STUDY_SELECT} WHERE s.id = ?`, id);
}
export function studyForOrg(orgId: number, id: number, db: Db = graph()): StudyRow {
  const s = studyRow(id, db);
  if (!s || s.buyer_org_id !== orgId) throw notFound('study');
  return s;
}
export function campaignRow(id: number, db: Db = graph()): CampaignRow | undefined {
  if (!db.tableExists('campaign')) return undefined;
  return db.get<CampaignRow>('SELECT * FROM campaign WHERE id = ?', id);
}
export function campaignForOrg(orgId: number, id: number, db: Db = graph()): { campaign: CampaignRow; study: StudyRow } {
  const campaign = campaignRow(id, db);
  const study = campaign ? studyRow(campaign.study_id, db) : undefined;
  if (!campaign || !study || study.buyer_org_id !== orgId) throw notFound('campaign');
  return { campaign, study };
}
export function studyCriteria(s: StudyRow): CohortCriteria {
  return CriteriaSchema.parse(s.criteria_json ? JSON.parse(s.criteria_json) : {});
}
export function parseVariables(json: string): SeedVariable[] {
  return JSON.parse(json) as SeedVariable[];
}
/** The study's root campaign (the one launched from the proposal; child campaigns are variable requests). */
export function rootCampaign(studyId: number, db: Db = graph()): CampaignRow | undefined {
  return db.get<CampaignRow>('SELECT * FROM campaign WHERE study_id = ? ORDER BY (parent_campaign_id IS NULL) DESC, id LIMIT 1', studyId);
}

// ---------------------------------------------------------------- counters (GROUP BY status, never state tables)
type CounterAgg = { invited: number; accepted: number; started: number; completed: number; quality: number; need: number };
const COUNTER_SQL = (where: string) => `
  SELECT COUNT(*) AS invited,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM enrollment e WHERE e.opportunity_id = op.id) THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN op.status IN ${sqlList(STARTED_STATUSES)} THEN 1 ELSE 0 END) AS started,
         SUM(CASE WHEN op.status IN ('paid','rejected','verified') THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN op.status = 'paid' THEN 1 ELSE 0 END) AS quality,
         SUM(CASE WHEN op.status IN ${sqlList(REPLACEABLE_STATUSES)} AND (op.status <> 'declined' OR op.viewed_at IS NOT NULL) THEN 1 ELSE 0 END) AS need
    FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id WHERE ${where}`;

function toCounters(a: CounterAgg | undefined, eligible: number, floor: boolean): StudyCounters {
  const f = floor ? kfloorN : (n: number) => n;
  return {
    eligible: f(eligible), invited: f(a?.invited ?? 0), accepted: f(a?.accepted ?? 0), started: f(a?.started ?? 0),
    completed: f(a?.completed ?? 0), qualityAccepted: f(a?.quality ?? 0), needReplacement: f(a?.need ?? 0),
  };
}
export function studyCounters(studyId: number, db: Db = graph(), floor = true): StudyCounters {
  if (!db.tableExists('opportunity')) return toCounters(undefined, 0, floor);
  const root = rootCampaign(studyId, db);
  return toCounters(db.get<CounterAgg>(COUNTER_SQL('cp.study_id = ?'), studyId), root?.eligible_n ?? 0, floor);
}
export function campaignCounters(campaignId: number, db: Db = graph(), floor = true): StudyCounters {
  const c = campaignRow(campaignId, db);
  return toCounters(db.get<CounterAgg>(COUNTER_SQL('op.campaign_id = ?'), campaignId), c?.eligible_n ?? 0, floor);
}

// ---------------------------------------------------------------- campaign reads
const EMPTY_LINES: CostLine[] = [
  { key: 'participant_comp', label: 'Participant compensation', cents: 0 }, { key: 'devices_testing', label: 'Devices / testing', cents: 0 },
  { key: 'data_preparation', label: 'Data preparation', cents: 0 }, { key: 'platform_recruitment', label: 'Platform & recruitment', cents: 0 },
];
export function emptyEstimate(targetN: number): Estimate {
  return { targetN, pool: 0, contacts: 0, accepted: 0, completed: 0, costLines: EMPTY_LINES, totalCents: 0, weeksLow: 0, weeksHigh: 0, groups: [] };
}

export function toCampaign(c: CampaignRow, study: StudyRow, db: Db = graph()): Campaign {
  const { bySlug } = concepts(db);
  const vars = parseVariables(c.variables_json).map((v) => ({ ...v, name: v.label ?? bySlug.get(v.conceptSlug)?.name ?? v.conceptSlug }));
  return {
    id: c.id, studyId: c.study_id, parentCampaignId: c.parent_campaign_id, name: c.name, status: c.status, targetN: c.target_complete_n,
    variables: vars, estimate: c.estimate_json ? (JSON.parse(c.estimate_json) as Estimate) : emptyEstimate(c.target_complete_n),
    cohortId: study.cohort_definition_id, licenseTermMonths: study.license_term_months, createdAt: c.created_at, launchedAt: c.launched_at,
    counters: c.status === 'draft' || c.status === 'proposal_requested' ? null : campaignCounters(c.id, db),
  };
}
export function listCampaigns(orgId: number, db: Db = graph()): Campaign[] {
  if (!db.tableExists('campaign')) return [];
  const rows = db.all<CampaignRow>('SELECT c.* FROM campaign c JOIN study s ON s.id = c.study_id WHERE s.buyer_org_id = ? ORDER BY c.created_at DESC, c.id DESC', orgId);
  return rows.map((c) => toCampaign(c, studyRow(c.study_id, db)!, db));
}
export function getCampaign(orgId: number, id: number, db: Db = graph()): Campaign {
  const { campaign, study } = campaignForOrg(orgId, id, db);
  return toCampaign(campaign, study, db);
}

// ---------------------------------------------------------------- create → proposal → launch
export function validateVariables(raw: unknown, db: Db): CampaignVariable[] {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('variables are required');
  for (const v of raw as CampaignVariable[]) {
    if (!v || typeof v.conceptSlug !== 'string' || !conceptBySlug(v.conceptSlug, db)) throw badRequest(`unknown concept ${v?.conceptSlug}`);
    if (!['reuse', 'collect_if_missing', 'collect_all'].includes(v.mode)) throw badRequest(`invalid mode for ${v.conceptSlug}`);
    if (!v.requirement || typeof v.requirement !== 'object') throw badRequest(`requirement missing for ${v.conceptSlug}`);
    if (!Number.isFinite(v.compCents) || v.compCents < 0) throw badRequest(`compCents invalid for ${v.conceptSlug}`);
    v.deviceCostCents = Number.isFinite(v.deviceCostCents) ? v.deviceCostCents : 0;
  }
  return raw as CampaignVariable[];
}

export function createCampaign(orgId: number, input: CampaignCreate, db: Db = graph()): Campaign {
  const consent = orgConsent(orgId, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const cohort = db.get<{ id: number; name: string; criteria_json: string }>('SELECT id, name, criteria_json FROM cohort_definition WHERE id = ? AND buyer_org_id = ?', Number(input.cohortId), orgId);
  if (!cohort) throw notFound('cohort');
  const targetN = Math.round(Number(input.targetN));
  if (!Number.isFinite(targetN) || targetN <= 0) throw badRequest('targetN must be a positive number');
  const variables = validateVariables(input.variables, db);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : `${cohort.name} campaign`;
  const purpose = typeof input.purpose === 'string' && input.purpose.trim() ? input.purpose.trim() : CriteriaSchema.parse(JSON.parse(cohort.criteria_json)).purpose;
  const term = Number.isFinite(Number(input.licenseTermMonths)) && Number(input.licenseTermMonths) > 0 ? Math.round(Number(input.licenseTermMonths)) : 12;
  const useTags = Array.isArray(input.useTags) ? input.useTags.filter((t) => typeof t === 'string') : [];
  const criteria = CriteriaSchema.parse(JSON.parse(cohort.criteria_json));
  const now = nowIso();
  const id = db.tx(() => {
    const studyId = db.run(
      "INSERT INTO study (buyer_org_id, cohort_definition_id, name, purpose, use_tags_json, license_term_months, target_n, salt, status, advanced_days, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,'draft',0,?,?)",
      orgId, cohort.id, name, purpose, JSON.stringify(useTags), term, targetN, '', now, now).lastId;
    db.run('UPDATE study SET salt = ? WHERE id = ?', makeSalt('study', studyId, name), studyId);
    const ev = evaluateCohort(criteria, { orgId, variables }, db);
    const estimate = buildEstimate({ targetN, readyNow: ev.readyNow, groups: ev.groups, variables });
    const campaignId = db.run(
      "INSERT INTO campaign (study_id, parent_campaign_id, name, status, target_complete_n, eligible_n, variables_json, estimate_json, launched_at, closed_at, created_at) VALUES (?,NULL,?,'draft',?,?,?,?,NULL,NULL,?)",
      studyId, name, targetN, ev.recontactBase, JSON.stringify(variables), JSON.stringify(estimate), now).lastId;
    logActivity(db, { orgId, kind: 'campaign_draft', text: `${name}: campaign drafted (target ${targetN.toLocaleString('en-US')} completers)`, occurredAt: now });
    return campaignId;
  });
  return getCampaign(orgId, id, db);
}

export function requestProposal(orgId: number, id: number, db: Db = graph()): Campaign {
  const { campaign, study } = campaignForOrg(orgId, id, db);
  assertTransition('campaign', CAMPAIGN_TRANSITIONS, campaign.status, 'proposal_requested');
  const now = nowIso();
  db.tx(() => {
    db.run("UPDATE campaign SET status = 'proposal_requested' WHERE id = ?", id);
    db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, study.id);
    logActivity(db, { orgId, kind: 'proposal', text: `${campaign.name}: proposal requested`, occurredAt: now });
  });
  return getCampaign(orgId, id, db);
}

/** Launch: compute the recruitable pool, offer `contacts` opportunities (Alex always included when recruitable). No licenses. */
export function launchCampaign(orgId: number, id: number, db: Db = graph()): Campaign {
  const { campaign, study } = campaignForOrg(orgId, id, db);
  assertTransition('campaign', CAMPAIGN_TRANSITIONS, campaign.status, 'active');
  const consent = orgConsent(orgId, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const variables = parseVariables(campaign.variables_json);
  const now = nowIso();
  db.tx(() => {
    const { ev, members } = recruitablePool(studyCriteria(study), { orgId, variables, openOpportunityStudyId: study.id }, db);
    const estimate = buildEstimate({ targetN: campaign.target_complete_n, readyNow: ev.readyNow, groups: ev.groups, variables });
    const contacts = contactsForTarget(campaign.target_complete_n, members.length);
    const offered = offerOpportunities(db, campaign, variables, members, contacts, new Rng(`launch:${campaign.id}`), now);
    db.run("UPDATE campaign SET status = 'active', launched_at = ?, eligible_n = ?, estimate_json = ? WHERE id = ?", now.slice(0, 10), ev.recontactBase, JSON.stringify({ ...estimate, contacts }), id);
    db.run("UPDATE study SET status = 'active', updated_at = ? WHERE id = ?", now, study.id);
    logActivity(db, { orgId, kind: 'campaign_launched', text: `${campaign.name} launched — ${offered.toLocaleString('en-US')} participants invited`, occurredAt: now });
  });
  return getCampaign(orgId, id, db);
}

export type PoolMember = { pid: number; slugs: string[] };

/** Insert `contacts` offered opportunities from the pool (deterministic shuffle; the detailed participant goes first). Returns the count. */
export function offerOpportunities(db: Db, campaign: CampaignRow, variables: SeedVariable[], members: PoolMember[], contacts: number, rng: Rng, at: string, extraPids: number[] = []): number {
  if (!members.length && !extraPids.length) return 0;
  const detailed = new Set(db.all<{ id: number }>('SELECT id FROM participant WHERE is_detailed = 1').map((r) => r.id));
  const order = rng.shuffle(members.slice());
  order.sort((a, b) => Number(detailed.has(b.pid)) - Number(detailed.has(a.pid)));
  const chosen = order.slice(0, Math.max(0, contacts));
  const seen = new Set(chosen.map((m) => m.pid));
  const collectSlugs = variables.filter((v) => v.mode !== 'reuse').map((v) => v.conceptSlug);
  for (const pid of extraPids) if (!seen.has(pid)) { seen.add(pid); chosen.push({ pid, slugs: collectSlugs }); }
  const comp = (slugs: string[]) => variables.reduce((a, v) => a + (v.mode === 'reuse' || slugs.includes(v.conceptSlug) ? v.compCents : 0), 0);
  for (const m of chosen) {
    db.run("INSERT INTO opportunity (campaign_id, participant_id, status, missing_concepts_json, comp_max_cents, offered_at, created_at) VALUES (?,?,'offered',?,?,?,?)",
      campaign.id, m.pid, JSON.stringify(m.slugs), comp(m.slugs), at, at);
    if (detailed.has(m.pid)) {
      const study = studyRow(campaign.study_id, db);
      logActivity(db, { participantId: m.pid, kind: 'opportunity', text: `New opportunity: ${study?.name ?? campaign.name} — ${study?.org_name ?? ''}`.trim(), amountCents: comp(m.slugs), occurredAt: at });
    }
  }
  return chosen.length;
}

// ---------------------------------------------------------------- studies (B7)
export function cohortSummary(c: CohortCriteria): string {
  const parts: string[] = [];
  if (c.conditions.length) parts.push(c.conditions.map((s) => shortName(s)).join(' + '));
  const d = c.demographics;
  if (d.country) parts.push(d.country);
  if (d.ageMin !== undefined || d.ageMax !== undefined) parts.push(`age ${d.ageMin ?? ''}–${d.ageMax ?? ''}`);
  if (d.sex && d.sex !== 'any') parts.push(d.sex);
  for (const l of c.labs) parts.push(`${shortName(l.slug)} ${l.op} ${l.value}`);
  for (const m of c.modalities) parts.push(`${shortName(m.slug)}${m.minSpanDays ? ` ≥ ${spanLabel(m.minSpanDays)}` : ''}`);
  return parts.join(' · ') || 'All participants';
}

function toSummary(s: StudyRow, db: Db): StudySummary {
  return {
    id: s.id, name: s.name, orgName: s.org_name, purpose: s.purpose, status: s.status, targetN: s.target_n,
    counters: studyCounters(s.id, db), datasetId: currentDataset(s.id, db)?.id ?? null, updatedAt: s.updated_at,
  };
}
export function listStudies(orgId: number, db: Db = graph()): StudySummary[] {
  if (!db.tableExists('study')) return [];
  return db.all<StudyRow>(`${STUDY_SELECT} WHERE s.buyer_org_id = ? ORDER BY (s.status = 'active') DESC, s.updated_at DESC, s.id DESC`, orgId).map((s) => toSummary(s, db));
}

/** Every variable the study collects or reuses (root campaign first, then child campaigns), de-duplicated by slug. */
export function studyVariables(studyId: number, db: Db = graph()): (SeedVariable & { campaignId: number })[] {
  const out: (SeedVariable & { campaignId: number })[] = [];
  const seen = new Set<string>();
  for (const c of db.all<CampaignRow>('SELECT * FROM campaign WHERE study_id = ? ORDER BY (parent_campaign_id IS NULL) DESC, id', studyId)) {
    for (const v of parseVariables(c.variables_json)) {
      const key = `${v.conceptSlug}:${v.mode === 'reuse' ? 'reuse' : 'collect'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...v, campaignId: c.id });
    }
  }
  return out;
}

/** Per-variable coverage over STARTED members: collect variables count verified contributions, reuse variables count historical data. */
export function studyCoverage(studyId: number, db: Db = graph(), floor = true): StudyDetail['coverage'] {
  const started = db.get<{ n: number }>(`SELECT COUNT(DISTINCT op.participant_id) AS n FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id WHERE cp.study_id = ? AND op.status IN ${sqlList(STARTED_STATUSES)}`, studyId)?.n ?? 0;
  const f = floor ? kfloorN : (n: number) => n;
  return studyVariables(studyId, db).map((v) => {
    const k = conceptBySlug(v.conceptSlug, db);
    let verified = 0;
    if (k && v.mode !== 'reuse') {
      verified = db.get<{ n: number }>(
        `SELECT COUNT(DISTINCT c.participant_id) AS n FROM contribution c JOIN opportunity op ON op.id = c.opportunity_id JOIN campaign cp ON cp.id = op.campaign_id
          WHERE cp.study_id = ? AND c.concept_id = ? AND c.status = 'verified' AND op.status IN ${sqlList(STARTED_STATUSES)}`, studyId, k.id)?.n ?? 0;
    } else if (k) {
      const h = v.requirement.historical;
      verified = db.get<{ n: number }>(
        `SELECT COUNT(DISTINCT op.participant_id) AS n FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id
           JOIN participant_coverage cv ON cv.participant_id = op.participant_id AND cv.concept_id = ? AND cv.n_obs > 0 AND cv.span_days >= ? AND cv.best_prov_rank >= ?
          WHERE cp.study_id = ? AND op.status IN ${sqlList(STARTED_STATUSES)}`, k.id, h?.minSpanDays ?? 0, h?.minProvRank ?? 0, studyId)?.n ?? 0;
    }
    return { slug: v.conceptSlug, label: v.label ?? shortName(v.conceptSlug), pct: started ? Math.round((verified / started) * 1000) / 10 : 0, verified: f(verified), started: f(started) };
  });
}

export function studyDetail(orgId: number, id: number, db: Db = graph()): StudyDetail {
  const s = studyForOrg(orgId, id, db);
  const counters = studyCounters(s.id, db, false);
  const need = counters.needReplacement;
  const campaigns = db.all<CampaignRow>('SELECT * FROM campaign WHERE study_id = ? ORDER BY id', s.id).map((c) => ({ id: c.id, name: c.name, status: c.status, parentCampaignId: c.parent_campaign_id }));
  return {
    ...toSummary(s, db),
    cohortId: s.cohort_definition_id,
    cohortSummary: cohortSummary(studyCriteria(s)),
    campaigns,
    coverage: studyCoverage(s.id, db),
    licenseTermMonths: s.license_term_months,
    replacementNote: need === 0 ? 'No replacements needed' : `${need < 20 ? '<20' : need.toLocaleString('en-US')} participants need replacement / recontact`,
    lastAdvancedDays: s.advanced_days,
  };
}

const DEMO_YEAR = Number(DEMO_TODAY.slice(0, 4));
export function ageBand(birthYear: number): string {
  const age = DEMO_YEAR - birthYear;
  if (age < 40) return '< 40';
  if (age < 50) return '40–49';
  if (age < 60) return '50–59';
  if (age < 70) return '60–69';
  return '70+';
}

/** Enrolled participants with a STUDY-scoped pseudonym, an age band, a country and per-variable status. Row-level lists need ≥ 20 rows. */
export function studyParticipants(orgId: number, id: number, opts: { limit?: number; offset?: number } = {}, db: Db = graph()): StudyParticipants {
  const s = studyForOrg(orgId, id, db);
  const vars = studyVariables(s.id, db);
  const columns = vars.map((v) => ({ slug: v.conceptSlug, label: v.label ?? shortName(v.conceptSlug) }));
  const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id WHERE cp.study_id = ? AND EXISTS (SELECT 1 FROM enrollment e WHERE e.opportunity_id = op.id)', s.id)?.n ?? 0;
  if (n < 20) return { n: kfloorN(n), floored: n > 0, columns, rows: [] };
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = db.all<{ opp_id: number; status: string; pseudonym: string; birth_year: number; country: string; pid: number }>(
    `SELECT op.id AS opp_id, op.status, p.pseudonym, p.birth_year, p.country, p.id AS pid FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id JOIN participant p ON p.id = op.participant_id
      WHERE cp.study_id = ? AND EXISTS (SELECT 1 FROM enrollment e WHERE e.opportunity_id = op.id) ORDER BY op.id LIMIT ? OFFSET ?`, s.id, limit, offset);
  if (!rows.length) return { n, floored: false, columns, rows: [] };
  const oppIds = rows.map((r) => r.opp_id);
  const pids = Array.from(new Set(rows.map((r) => r.pid)));
  const contrib = new Map<string, string>();
  for (const c of db.all<{ opportunity_id: number; slug: string; status: string }>(`SELECT c.opportunity_id, k.slug, c.status FROM contribution c JOIN concept k ON k.id = c.concept_id WHERE c.opportunity_id IN (${oppIds.map(() => '?').join(',')})`, ...oppIds)) {
    contrib.set(`${c.opportunity_id}:${c.slug}`, c.status);
  }
  const cov = new Set<string>();
  for (const c of db.all<{ participant_id: number; slug: string }>(`SELECT cv.participant_id, k.slug FROM participant_coverage cv JOIN concept k ON k.id = cv.concept_id WHERE cv.n_obs > 0 AND cv.participant_id IN (${pids.map(() => '?').join(',')})`, ...pids)) {
    cov.add(`${c.participant_id}:${c.slug}`);
  }
  return {
    n, floored: false, columns,
    rows: rows.map((r) => {
      const variables: Record<string, 'complete' | 'pending' | 'missing'> = {};
      for (const v of vars) {
        const cs = contrib.get(`${r.opp_id}:${v.conceptSlug}`);
        if (v.mode !== 'reuse') variables[v.conceptSlug] = cs === 'verified' ? 'complete' : cs === 'pending' || cs === 'submitted' ? 'pending' : cov.has(`${r.pid}:${v.conceptSlug}`) ? 'complete' : 'missing';
        else variables[v.conceptSlug] = cov.has(`${r.pid}:${v.conceptSlug}`) ? 'complete' : 'missing';
      }
      return { memberPseudonym: scopedPseudonym(r.pseudonym, s.salt), ageBand: ageBand(r.birth_year), country: r.country, status: r.status, variables };
    }),
  };
}

// ---------------------------------------------------------------- recontact (replacement offers)
export function recontactStudy(orgId: number, id: number, db: Db = graph()): { replaced: number; offered: number; poolExhausted: boolean; counters: StudyCounters } {
  const s = studyForOrg(orgId, id, db);
  const now = nowIso();
  let replaced = 0, offered = 0, poolExhausted = false;
  db.tx(() => {
    for (const c of db.all<CampaignRow>("SELECT * FROM campaign WHERE study_id = ? AND status = 'active' ORDER BY id", s.id)) {
      const stale = db.all<{ id: number; status: string }>(`SELECT id, status FROM opportunity WHERE campaign_id = ? AND status IN ${sqlList(REPLACEABLE_STATUSES)} AND (status <> 'declined' OR viewed_at IS NOT NULL) ORDER BY id`, c.id);
      if (!stale.length) continue;
      const variables = parseVariables(c.variables_json);
      const { members } = recruitablePool(studyCriteria(s), { orgId, variables, openOpportunityCampaignId: c.id }, db);
      const rng = new Rng(`recontact:${c.id}:${db.writeVersion}`);
      const pool = rng.shuffle(members.slice());
      const comp = (slugs: string[]) => variables.reduce((a, v) => a + (v.mode === 'reuse' || slugs.includes(v.conceptSlug) ? v.compCents : 0), 0);
      for (const o of stale) {
        const m = pool.pop();
        if (!m) { poolExhausted = true; break; }
        const newId = db.run("INSERT INTO opportunity (campaign_id, participant_id, status, missing_concepts_json, comp_max_cents, offered_at, created_at) VALUES (?,?,'offered',?,?,?,?)", c.id, m.pid, JSON.stringify(m.slugs), comp(m.slugs), now, now).lastId;
        assertTransition('opportunity', OPPORTUNITY_TRANSITIONS, o.status as never, 'replaced');
        db.run("UPDATE opportunity SET status = 'replaced', replaced_by_id = ? WHERE id = ?", newId, o.id);
        replaced++; offered++;
      }
    }
    if (offered) {
      db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, s.id);
      logActivity(db, { orgId, kind: 'recontact', text: `${s.name}: ${offered.toLocaleString('en-US')} replacement participants invited`, occurredAt: now });
    }
  });
  if (!replaced && !offered && studyCounters(s.id, db, false).needReplacement === 0) throw conflict('no participants need replacement');
  return { replaced, offered, poolExhausted, counters: studyCounters(s.id, db) };
}
