// Campaign / study side of the loop: draft → proposal → launch (offers, never licenses), counters (always GROUP BY
// status), study reads (B7), the scoped participant list and recontact (replacement offers).
import { DEMO_TODAY, nowIso } from '@shared/clock';
import { CohortCriteria as CriteriaSchema, type CohortCriteria } from '@shared/criteria';
import { PROHIBITED_USE_KEYS, shortName } from '@shared/ontology';
import { Rng } from '@shared/rng';
import type { CampaignVariable } from '@shared/requirement';
import type { Campaign, CampaignCreate, CampaignStatus, CostLine, Estimate, StudyCounters, StudyDetail, StudyParticipants, StudySummary } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, forbidden, notFound, conflict } from '../errors';
import { logActivity } from './activity';
import { kfloorN, orgConsent, recruitablePool, evaluateCohort, spanLabel, type ReadyMember } from './cohort';
import { enroll, loadOpportunity, offerComp, reuseFeeFor } from './consent';
import { buildEstimate, contactsForTarget } from './estimate';
import { conceptBySlug, concepts, reuseFeeCents } from './ontology';
import { makeSalt, scopedPseudonym } from './pseudonym';
import { assertTransition, CAMPAIGN_TRANSITIONS, OPPORTUNITY_TRANSITIONS, REPLACEABLE_STATUSES, STARTED_STATUSES, sqlList } from './state';
import { currentDataset } from './dataset';
import { mapSeq } from '../util/async';

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

export async function studyRow(id: number, db: Db = graph()): Promise<StudyRow | undefined> {
  if (!await db.tableExists('study')) return undefined;
  return await db.get<StudyRow>(`${STUDY_SELECT} WHERE s.id = ?`, id);
}
export async function studyForOrg(orgId: number, id: number, db: Db = graph()): Promise<StudyRow> {
  const s = await studyRow(id, db);
  if (!s || s.buyer_org_id !== orgId) throw notFound('study');
  return s;
}
export async function campaignRow(id: number, db: Db = graph()): Promise<CampaignRow | undefined> {
  if (!await db.tableExists('campaign')) return undefined;
  return await db.get<CampaignRow>('SELECT * FROM campaign WHERE id = ?', id);
}
export async function campaignForOrg(orgId: number, id: number, db: Db = graph()): Promise<{ campaign: CampaignRow; study: StudyRow }> {
  const campaign = await campaignRow(id, db);
  const study = campaign ? await studyRow(campaign.study_id, db) : undefined;
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
export async function rootCampaign(studyId: number, db: Db = graph()): Promise<CampaignRow | undefined> {
  return await db.get<CampaignRow>('SELECT * FROM campaign WHERE study_id = ? ORDER BY (parent_campaign_id IS NULL) DESC, id LIMIT 1', studyId);
}

// ---------------------------------------------------------------- counters (GROUP BY status, never state tables)
type CounterAgg = { invited: number; accepted: number; started: number; completed: number; quality: number; need: number };
const COUNTER_SQL = (where: string) => `
  SELECT COUNT(*) AS invited,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM enrollment e WHERE e.opportunity_id = op.id) THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN op.status IN ${sqlList(STARTED_STATUSES)} THEN 1 ELSE 0 END) AS started,
         SUM(CASE WHEN op.status IN ('paid','rejected','verified') THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN op.status = 'paid' THEN 1 ELSE 0 END) AS quality,
         SUM(CASE WHEN op.status IN ${sqlList(REPLACEABLE_STATUSES)} AND (op.status <> 'declined' OR op.viewed_at IS NOT NULL) AND op.replaced_by_id IS NULL THEN 1 ELSE 0 END) AS need
    FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id WHERE ${where}`;

function toCounters(a: CounterAgg | undefined, eligible: number, floor: boolean): StudyCounters {
  const f = floor ? kfloorN : (n: number) => n;
  return {
    eligible: f(eligible), invited: f(a?.invited ?? 0), accepted: f(a?.accepted ?? 0), started: f(a?.started ?? 0),
    completed: f(a?.completed ?? 0), qualityAccepted: f(a?.quality ?? 0), needReplacement: f(a?.need ?? 0),
  };
}
/** The study's headline counters = its ROOT campaign only (variable-request child campaigns carry their own; see campaignCounters). */
export async function studyCounters(studyId: number, db: Db = graph(), floor = true): Promise<StudyCounters> {
  if (!await db.tableExists('opportunity')) return toCounters(undefined, 0, floor);
  const root = await rootCampaign(studyId, db);
  if (!root) return toCounters(undefined, 0, floor);
  return toCounters((await db.get<CounterAgg>(COUNTER_SQL('op.campaign_id = ?'), root.id)), root.eligible_n, floor);
}
/** Counters over EVERY campaign of the study (used for the recontact guard). */
export async function studyCountersAll(studyId: number, db: Db = graph(), floor = true): Promise<StudyCounters> {
  if (!await db.tableExists('opportunity')) return toCounters(undefined, 0, floor);
  const root = await rootCampaign(studyId, db);
  return toCounters((await db.get<CounterAgg>(COUNTER_SQL('cp.study_id = ?'), studyId)), root?.eligible_n ?? 0, floor);
}
export async function campaignCounters(campaignId: number, db: Db = graph(), floor = true): Promise<StudyCounters> {
  const c = await campaignRow(campaignId, db);
  return toCounters((await db.get<CounterAgg>(COUNTER_SQL('op.campaign_id = ?'), campaignId)), c?.eligible_n ?? 0, floor);
}

// ---------------------------------------------------------------- campaign reads
const EMPTY_LINES: CostLine[] = [
  { key: 'participant_comp', label: 'Participant compensation', cents: 0 }, { key: 'devices_testing', label: 'Devices / testing', cents: 0 },
  { key: 'data_preparation', label: 'Data preparation', cents: 0 }, { key: 'platform_recruitment', label: 'Platform & recruitment', cents: 0 },
];
export function emptyEstimate(targetN: number): Estimate {
  return { targetN, pool: 0, contacts: 0, accepted: 0, completed: 0, costLines: EMPTY_LINES, totalCents: 0, weeksLow: 0, weeksHigh: 0, groups: [] };
}

export async function toCampaign(c: CampaignRow, study: StudyRow, db: Db = graph()): Promise<Campaign> {
  const { bySlug } = await concepts(db);
  const vars = parseVariables(c.variables_json).map((v) => ({ ...v, name: v.label ?? bySlug.get(v.conceptSlug)?.name ?? v.conceptSlug }));
  return {
    id: c.id, studyId: c.study_id, parentCampaignId: c.parent_campaign_id, name: c.name, status: c.status, targetN: c.target_complete_n,
    variables: vars, estimate: c.estimate_json ? (JSON.parse(c.estimate_json) as Estimate) : emptyEstimate(c.target_complete_n),
    cohortId: study.cohort_definition_id, licenseTermMonths: study.license_term_months, createdAt: c.created_at, launchedAt: c.launched_at,
    counters: c.status === 'draft' || c.status === 'proposal_requested' ? null : await campaignCounters(c.id, db),
  };
}
export async function listCampaigns(orgId: number, db: Db = graph()): Promise<Campaign[]> {
  if (!await db.tableExists('campaign')) return [];
  const rows = await db.all<CampaignRow>('SELECT c.* FROM campaign c JOIN study s ON s.id = c.study_id WHERE s.buyer_org_id = ? ORDER BY c.created_at DESC, c.id DESC', orgId);
  return await mapSeq(rows, async (c) => await toCampaign(c, (await studyRow(c.study_id, db))!, db));
}
export async function getCampaign(orgId: number, id: number, db: Db = graph()): Promise<Campaign> {
  const { campaign, study } = await campaignForOrg(orgId, id, db);
  return await toCampaign(campaign, study, db);
}

// ---------------------------------------------------------------- create → proposal → launch
export async function validateVariables(raw: unknown, db: Db): Promise<CampaignVariable[]> {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('variables are required');
  for (const v of raw as CampaignVariable[]) {
    if (!v || typeof v.conceptSlug !== 'string' || !await conceptBySlug(v.conceptSlug, db)) throw badRequest(`unknown concept ${v?.conceptSlug}`);
    if (!['reuse', 'collect_if_missing', 'collect_all'].includes(v.mode)) throw badRequest(`invalid mode for ${v.conceptSlug}`);
    if (!v.requirement || typeof v.requirement !== 'object') throw badRequest(`requirement missing for ${v.conceptSlug}`);
    if (v.mode === 'reuse' && !(Number(v.compCents) > 0)) v.compCents = reuseFeeCents((await conceptBySlug(v.conceptSlug, db))!); // reuse = license fee, never free
    if (!Number.isFinite(v.compCents) || v.compCents < 0) throw badRequest(`compCents invalid for ${v.conceptSlug}`);
    v.deviceCostCents = Number.isFinite(v.deviceCostCents) ? v.deviceCostCents : 0;
  }
  return raw as CampaignVariable[];
}

export async function createCampaign(orgId: number, input: CampaignCreate, db: Db = graph()): Promise<Campaign> {
  const consent = await orgConsent(orgId, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const cohort = await db.get<{ id: number; name: string; criteria_json: string }>('SELECT id, name, criteria_json FROM cohort_definition WHERE id = ? AND buyer_org_id = ?', Number(input.cohortId), orgId);
  if (!cohort) throw notFound('cohort');
  const targetN = Math.round(Number(input.targetN));
  if (!Number.isFinite(targetN) || targetN <= 0) throw badRequest('targetN must be a positive number');
  const variables = await validateVariables(input.variables, db);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : `${cohort.name} campaign`;
  const purpose = typeof input.purpose === 'string' && input.purpose.trim() ? input.purpose.trim() : CriteriaSchema.parse(JSON.parse(cohort.criteria_json)).purpose;
  const term = Number.isFinite(Number(input.licenseTermMonths)) && Number(input.licenseTermMonths) > 0 ? Math.round(Number(input.licenseTermMonths)) : 12;
  const useTags = Array.isArray(input.useTags) ? input.useTags.filter((t) => typeof t === 'string') : [];
  // the same banned-uses list that blocks an organisation also blocks a single campaign tagged with a banned use
  const banned = useTags.filter((t) => PROHIBITED_USE_KEYS.includes(t));
  if (banned.length) throw forbidden(`Use "${banned[0].replace(/_/g, ' ')}" conflicts with participant red-lines; a campaign cannot be created for it.`);
  const criteria = CriteriaSchema.parse(JSON.parse(cohort.criteria_json));
  const now = nowIso();
  const id = await db.tx(async () => {
      const studyId = (await db.run(
            "INSERT INTO study (buyer_org_id, cohort_definition_id, name, purpose, use_tags_json, license_term_months, target_n, salt, status, advanced_days, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,'draft',0,?,?)",
            orgId, cohort.id, name, purpose, JSON.stringify(useTags), term, targetN, '', now, now)).lastId;
      await db.run('UPDATE study SET salt = ? WHERE id = ?', makeSalt('study', studyId, name), studyId);
      const ev = await evaluateCohort(criteria, { orgId, variables }, db);
      const estimate = buildEstimate({ targetN, readyNow: ev.readyNow, groups: ev.groups, variables });
      const campaignId = (await db.run(
            "INSERT INTO campaign (study_id, parent_campaign_id, name, status, target_complete_n, eligible_n, variables_json, estimate_json, launched_at, closed_at, created_at) VALUES (?,NULL,?,'draft',?,?,?,?,NULL,NULL,?)",
            studyId, name, targetN, ev.recontactBase, JSON.stringify(variables), JSON.stringify(estimate), now)).lastId;
      await logActivity(db, { orgId, kind: 'campaign_draft', text: `${name}: campaign drafted (target ${targetN.toLocaleString('en-US')} completers)`, occurredAt: now });
      return campaignId;
    });
  return await getCampaign(orgId, id, db);
}

export async function requestProposal(orgId: number, id: number, db: Db = graph()): Promise<Campaign> {
  const { campaign, study } = await campaignForOrg(orgId, id, db);
  assertTransition('campaign', CAMPAIGN_TRANSITIONS, campaign.status, 'proposal_requested');
  const now = nowIso();
  await db.tx(async () => {
        await db.run("UPDATE campaign SET status = 'proposal_requested' WHERE id = ?", id);
        await db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, study.id);
        await logActivity(db, { orgId, kind: 'proposal', text: `${campaign.name}: proposal requested`, occurredAt: now });
      });
  return await getCampaign(orgId, id, db);
}

/**
 * Launch: compute the recruitable pool and offer `contacts` collection opportunities (Alex always included when
 * recruitable). When the campaign reuses ≥ 1 variable, every READY-NOW cohort member (all variables satisfied
 * historically, recontactable, consent ok, no open opportunity in this study) is ALSO offered a reuse-only opportunity
 * whose compensation is the license fee (Σ reuse fees) — Alex first. Offers mint no license; a member who has
 * pre-authorised reuse-only licenses accepts that offer at once (license + ledger row through the same enroll()).
 */
export async function launchCampaign(orgId: number, id: number, db: Db = graph()): Promise<Campaign> {
  const { campaign, study } = await campaignForOrg(orgId, id, db);
  assertTransition('campaign', CAMPAIGN_TRANSITIONS, campaign.status, 'active');
  const consent = await orgConsent(orgId, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const variables = parseVariables(campaign.variables_json);
  const now = nowIso();
  await db.tx(async () => {
        const { ev, members, ready } = await recruitablePool(studyCriteria(study), { orgId, variables, openOpportunityStudyId: study.id }, db);
        const estimate = buildEstimate({ targetN: campaign.target_complete_n, readyNow: ev.readyNow, groups: ev.groups, variables });
        const contacts = contactsForTarget(campaign.target_complete_n, members.length);
        const offered = await offerOpportunities(db, campaign, variables, members, contacts, new Rng(`launch:${campaign.id}`), now);
        // ready-now members hold every variable, so they always get a reuse-only offer (fee = Σ reuse fees of what they hold);
        // offerReuseOnly is a no-op when the ready set is empty (e.g. any collect_all variable)
        const reuseOnly = await offerReuseOnly(db, campaign, variables, ready, now);
        await db.run("UPDATE campaign SET status = 'active', launched_at = ?, eligible_n = ?, estimate_json = ? WHERE id = ?", now.slice(0, 10), ev.recontactBase, JSON.stringify({ ...estimate, contacts, reuseOnlyOffered: reuseOnly.offered }), id);
        await db.run("UPDATE study SET status = 'active', updated_at = ? WHERE id = ?", now, study.id);
        const reuseText = reuseOnly.offered ? `, ${reuseOnly.offered.toLocaleString('en-US')} ready-now participants offered a reuse-only license${reuseOnly.preauthorized ? ` (${reuseOnly.preauthorized.toLocaleString('en-US')} pre-authorised)` : ''}` : '';
        await logActivity(db, { orgId, kind: 'campaign_launched', text: `${campaign.name} launched — ${offered.toLocaleString('en-US')} participants invited${reuseText}`, occurredAt: now });
      });
  return await getCampaign(orgId, id, db);
}

/**
 * License fee of a reuse-only offer (nothing to collect): Σ reuse fees of the `reuse` variables AND of every
 * `collect_if_missing` variable (a ready-now member holds them all, so they are licensed, not collected).
 */
export async function reuseFeeOf(variables: CampaignVariable[], db: Db = graph()): Promise<number> {
  return await reuseFeeFor(variables, [], db);
}

/** Reuse-only offers (missing_concepts = []) for ready-now members; the detailed participant goes first. Pre-authorised members accept immediately. */
export async function offerReuseOnly(db: Db, campaign: CampaignRow, variables: SeedVariable[], ready: ReadyMember[], at: string): Promise<{ offered: number; preauthorized: number }> {
  if (!ready.length) return { offered: 0, preauthorized: 0 };
  const detailed = new Set((await db.all<{ id: number }>('SELECT id FROM participant WHERE is_detailed = 1')).map((r) => r.id));
  const order = ready.slice().sort((a, b) => Number(detailed.has(b.pid)) - Number(detailed.has(a.pid)) || a.pid - b.pid);
  const fee = await reuseFeeOf(variables, db);
  const study = await studyRow(campaign.study_id, db);
  let preauthorized = 0;
  for (const m of order) {
    const oppId = (await db.run("INSERT INTO opportunity (campaign_id, participant_id, status, missing_concepts_json, comp_max_cents, offered_at, created_at) VALUES (?,?,'offered','[]',?,?,?)", campaign.id, m.pid, fee, at, at)).lastId;
    if (detailed.has(m.pid)) {
      await logActivity(db, { participantId: m.pid, kind: 'opportunity', text: `New opportunity: ${study?.name ?? campaign.name} — ${study?.org_name ?? ''} (reuse-only license, nothing to collect)`.trim(), amountCents: fee, occurredAt: at });
    }
    if (m.preauthorized && !detailed.has(m.pid)) {
      // pre-authorised reuse-only: the participant consented in advance → accept now (the same accept core as P7)
      await db.run("UPDATE opportunity SET status = 'accepted', viewed_at = ?, reviewed_at = ?, responded_at = ? WHERE id = ?", at, at, at, oppId);
      const joined = (await loadOpportunity(oppId, db))!;
      const r = await enroll(db, joined, { at, termStart: at.slice(0, 10) });
      await db.run("UPDATE opportunity SET status = 'paid', completed_at = ? WHERE id = ?", at, oppId);
      await db.run("UPDATE enrollment SET status = 'completed', completed_at = ? WHERE id = ?", at, r.enrollmentId);
      preauthorized++;
    }
  }
  return { offered: order.length, preauthorized };
}

export type PoolMember = { pid: number; slugs: string[] };

/** Insert `contacts` offered opportunities from the pool (deterministic shuffle; the detailed participant goes first). Returns the count. */
export async function offerOpportunities(db: Db, campaign: CampaignRow, variables: SeedVariable[], members: PoolMember[], contacts: number, rng: Rng, at: string, extraPids: number[] = []): Promise<number> {
  if (!members.length && !extraPids.length) return 0;
  const detailed = new Set((await db.all<{ id: number }>('SELECT id FROM participant WHERE is_detailed = 1')).map((r) => r.id));
  const order = rng.shuffle(members.slice());
  order.sort((a, b) => Number(detailed.has(b.pid)) - Number(detailed.has(a.pid)));
  const chosen = order.slice(0, Math.max(0, contacts));
  const seen = new Set(chosen.map((m) => m.pid));
  const collectSlugs = variables.filter((v) => v.mode !== 'reuse').map((v) => v.conceptSlug);
  for (const pid of extraPids) if (!seen.has(pid)) { seen.add(pid); chosen.push({ pid, slugs: collectSlugs }); }
  // comp = collection comps of the member's missing variables + license fees of what is reused (reuse vars + held collect_if_missing vars)
  const comp = async (slugs: string[]) => await offerComp(variables, slugs, db);
  for (const m of chosen) {
    await db.run("INSERT INTO opportunity (campaign_id, participant_id, status, missing_concepts_json, comp_max_cents, offered_at, created_at) VALUES (?,?,'offered',?,?,?,?)",
            campaign.id, m.pid, JSON.stringify(m.slugs), (await comp(m.slugs)), at, at);
    if (detailed.has(m.pid)) {
      const study = await studyRow(campaign.study_id, db);
      await logActivity(db, { participantId: m.pid, kind: 'opportunity', text: `New opportunity: ${study?.name ?? campaign.name} — ${study?.org_name ?? ''}`.trim(), amountCents: await comp(m.slugs), occurredAt: at });
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

async function toSummary(s: StudyRow, db: Db): Promise<StudySummary> {
  return {
    id: s.id, name: s.name, orgName: s.org_name, purpose: s.purpose, status: s.status, targetN: s.target_n,
    counters: await studyCounters(s.id, db), datasetId: (await currentDataset(s.id, db))?.id ?? null, updatedAt: s.updated_at,
  };
}
export async function listStudies(orgId: number, db: Db = graph()): Promise<StudySummary[]> {
  if (!await db.tableExists('study')) return [];
  return await mapSeq(await db.all<StudyRow>(`${STUDY_SELECT} WHERE s.buyer_org_id = ? ORDER BY (s.status = 'active') DESC, s.updated_at DESC, s.id DESC`, orgId), async (s) => await toSummary(s, db));
}

/** Every variable the study collects or reuses (root campaign first, then child campaigns), de-duplicated by slug. */
export async function studyVariables(studyId: number, db: Db = graph()): Promise<(SeedVariable & { campaignId: number })[]> {
  const out: (SeedVariable & { campaignId: number })[] = [];
  const seen = new Set<string>();
  for (const c of await db.all<CampaignRow>('SELECT * FROM campaign WHERE study_id = ? ORDER BY (parent_campaign_id IS NULL) DESC, id', studyId)) {
    for (const v of parseVariables(c.variables_json)) {
      const key = `${v.conceptSlug}:${v.mode === 'reuse' ? 'reuse' : 'collect'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...v, campaignId: c.id });
    }
  }
  return out;
}

/**
 * Per-variable coverage over STARTED members of the campaign that carries the variable (root or a child campaign):
 * `collect_all` counts verified contributions; `reuse` counts historical data; `collect_if_missing` counts a verified
 * contribution OR — for members who were not asked to collect it (no contribution row) — historical data that satisfies
 * the requirement (the variable was licensed, not collected).
 */
export async function studyCoverage(studyId: number, db: Db = graph(), floor = true): Promise<StudyDetail['coverage']> {
  const startedBy = new Map<number, number>();
  const startedOf = async (campaignId: number) => {
    let n = startedBy.get(campaignId);
    if (n === undefined) {
      n = (await db.get<{ n: number }>(`SELECT COUNT(DISTINCT op.participant_id) AS n FROM opportunity op WHERE op.campaign_id = ? AND op.status IN ${sqlList(STARTED_STATUSES)}`, campaignId))?.n ?? 0;
      startedBy.set(campaignId, n);
    }
    return n;
  };
  const f = floor ? kfloorN : (n: number) => n;
  return await mapSeq(await studyVariables(studyId, db), async (v) => {
    const k = await conceptBySlug(v.conceptSlug, db);
    const started = await startedOf(v.campaignId);
    let verified = 0;
    if (k && v.mode === 'collect_all') {
      verified = (await db.get<{ n: number }>(
              `SELECT COUNT(DISTINCT c.participant_id) AS n FROM contribution c JOIN opportunity op ON op.id = c.opportunity_id
          WHERE op.campaign_id = ? AND c.concept_id = ? AND c.status = 'verified' AND op.status IN ${sqlList(STARTED_STATUSES)}`, v.campaignId, k.id))?.n ?? 0;
    } else if (k && v.mode === 'collect_if_missing') {
      const h = v.requirement.historical;
      verified = (await db.get<{ n: number }>(
              `SELECT COUNT(DISTINCT op.participant_id) AS n FROM opportunity op
          WHERE op.campaign_id = ? AND op.status IN ${sqlList(STARTED_STATUSES)}
            AND (EXISTS (SELECT 1 FROM contribution c WHERE c.opportunity_id = op.id AND c.concept_id = ? AND c.status = 'verified')
              OR (NOT EXISTS (SELECT 1 FROM contribution c WHERE c.opportunity_id = op.id AND c.concept_id = ?)
                  AND EXISTS (SELECT 1 FROM participant_coverage cv WHERE cv.participant_id = op.participant_id AND cv.concept_id = ? AND cv.n_obs > 0 AND cv.span_days >= ? AND cv.best_prov_rank >= ?)))`,
              v.campaignId, k.id, k.id, k.id, h?.minSpanDays ?? 0, h?.minProvRank ?? 0))?.n ?? 0;
    } else if (k) {
      const h = v.requirement.historical;
      verified = (await db.get<{ n: number }>(
              `SELECT COUNT(DISTINCT op.participant_id) AS n FROM opportunity op
           JOIN participant_coverage cv ON cv.participant_id = op.participant_id AND cv.concept_id = ? AND cv.n_obs > 0 AND cv.span_days >= ? AND cv.best_prov_rank >= ?
          WHERE op.campaign_id = ? AND op.status IN ${sqlList(STARTED_STATUSES)}`, k.id, h?.minSpanDays ?? 0, h?.minProvRank ?? 0, v.campaignId))?.n ?? 0;
    }
    return { slug: v.conceptSlug, label: v.label ?? shortName(v.conceptSlug), pct: started ? Math.round((verified / started) * 1000) / 10 : 0, verified: f(verified), started: f(started), campaignId: v.campaignId };
  });
}

export async function studyDetail(orgId: number, id: number, db: Db = graph()): Promise<StudyDetail> {
  const s = await studyForOrg(orgId, id, db);
  const need = (await studyCountersAll(s.id, db, false)).needReplacement;
  const campaigns = await mapSeq(await db.all<CampaignRow>('SELECT * FROM campaign WHERE study_id = ? ORDER BY id', s.id), async (c) => ({ id: c.id, name: c.name, status: c.status, parentCampaignId: c.parent_campaign_id, counters: await campaignCounters(c.id, db) }));
  return {
    ...await toSummary(s, db),
    cohortId: s.cohort_definition_id,
    cohortSummary: cohortSummary(studyCriteria(s)),
    campaigns,
    coverage: await studyCoverage(s.id, db),
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
export async function studyParticipants(orgId: number, id: number, opts: { limit?: number; offset?: number } = {}, db: Db = graph()): Promise<StudyParticipants> {
  const s = await studyForOrg(orgId, id, db);
  const vars = await studyVariables(s.id, db);
  const columns = vars.map((v) => ({ slug: v.conceptSlug, label: v.label ?? shortName(v.conceptSlug) }));
  const n = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id WHERE cp.study_id = ? AND EXISTS (SELECT 1 FROM enrollment e WHERE e.opportunity_id = op.id)', s.id))?.n ?? 0;
  if (n < 20) return { n: kfloorN(n), floored: n > 0, columns, rows: [] };
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await db.all<{ opp_id: number; status: string; pseudonym: string; birth_year: number; country: string; pid: number }>(
      `SELECT op.id AS opp_id, op.status, p.pseudonym, p.birth_year, p.country, p.id AS pid FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id JOIN participant p ON p.id = op.participant_id
      WHERE cp.study_id = ? AND EXISTS (SELECT 1 FROM enrollment e WHERE e.opportunity_id = op.id) ORDER BY op.id LIMIT ? OFFSET ?`, s.id, limit, offset);
  if (!rows.length) return { n, floored: false, columns, rows: [] };
  const oppIds = rows.map((r) => r.opp_id);
  const pids = Array.from(new Set(rows.map((r) => r.pid)));
  const contrib = new Map<string, string>();
  for (const c of await db.all<{ opportunity_id: number; slug: string; status: string }>(`SELECT c.opportunity_id, k.slug, c.status FROM contribution c JOIN concept k ON k.id = c.concept_id WHERE c.opportunity_id IN (${oppIds.map(() => '?').join(',')})`, ...oppIds)) {
    contrib.set(`${c.opportunity_id}:${c.slug}`, c.status);
  }
  const cov = new Set<string>();
  for (const c of await db.all<{ participant_id: number; slug: string }>(`SELECT cv.participant_id, k.slug FROM participant_coverage cv JOIN concept k ON k.id = cv.concept_id WHERE cv.n_obs > 0 AND cv.participant_id IN (${pids.map(() => '?').join(',')})`, ...pids)) {
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
export async function recontactStudy(orgId: number, id: number, db: Db = graph()): Promise<{ replaced: number; offered: number; poolExhausted: boolean; counters: StudyCounters }> {
  const s = await studyForOrg(orgId, id, db);
  const now = nowIso();
  let replaced = 0, offered = 0, poolExhausted = false;
  await db.tx(async () => {
        for (const c of await db.all<CampaignRow>("SELECT * FROM campaign WHERE study_id = ? AND status = 'active' ORDER BY id", s.id)) {
          const stale = await db.all<{ id: number; status: string }>(`SELECT id, status FROM opportunity WHERE campaign_id = ? AND status IN ${sqlList(REPLACEABLE_STATUSES)} AND (status <> 'declined' OR viewed_at IS NOT NULL) AND replaced_by_id IS NULL ORDER BY id`, c.id);
          if (!stale.length) continue;
          const variables = parseVariables(c.variables_json);
          const { members } = await recruitablePool(studyCriteria(s), { orgId, variables, openOpportunityCampaignId: c.id }, db);
          const rng = new Rng(`recontact:${c.id}:${(await db.version())}`);
          const pool = rng.shuffle(members.slice());
          const comp = async (slugs: string[]) => await offerComp(variables, slugs, db);
          for (const o of stale) {
            const m = pool.pop();
            if (!m) { poolExhausted = true; break; }
            const newId = (await db.run("INSERT INTO opportunity (campaign_id, participant_id, status, missing_concepts_json, comp_max_cents, offered_at, created_at) VALUES (?,?,'offered',?,?,?,?)", c.id, m.pid, JSON.stringify(m.slugs), (await comp(m.slugs)), now, now)).lastId;
            // the original keeps its terminal status (counters never go backwards); replaced_by_id links the replacement
            assertTransition('opportunity', OPPORTUNITY_TRANSITIONS, o.status as never, 'replaced');
            await db.run('UPDATE opportunity SET replaced_by_id = ? WHERE id = ?', newId, o.id);
            replaced++; offered++;
          }
        }
        if (offered) {
          await db.run('UPDATE study SET updated_at = ? WHERE id = ?', now, s.id);
          await logActivity(db, { orgId, kind: 'recontact', text: `${s.name}: ${offered.toLocaleString('en-US')} replacement participants invited`, occurredAt: now });
        }
      });
  if (!replaced && !offered && (await studyCountersAll(s.id, db, false)).needReplacement === 0) throw conflict('no participants need replacement');
  return { replaced, offered, poolExhausted, counters: await studyCounters(s.id, db) };
}
