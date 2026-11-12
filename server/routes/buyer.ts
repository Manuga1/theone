// Buyer / researcher API. Never imports db/vault.ts; every response passes the noIdentity middleware; aggregates are k-floored.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { nowIso } from '@shared/clock';
import { CohortCriteria } from '@shared/criteria';
import type {
  AdvanceRequest, AdvanceResult, BuyerHome, Campaign, CampaignCreate, CampaignList, CohortCreate, CohortPreview, Dataset, DatasetList, DatasetRefreshResult, DatasetTab, Estimate, EstimateRequest,
  ExportRequestInput, ExportRequestResult, RecontactResult, SavedCohort, SavedCohortDetail, SavedCohortList, StudyDetail, StudyList, StudyParticipants, VariablePreview, VariablePreviewQuery, VariableRequest, VariableRequestResult, Workspace,
} from '@shared/api-types';
import type { CampaignVariable } from '@shared/requirement';
import { graph } from '../db/graph';
import { badRequest, forbidden, notFound } from '../errors';
import { requireAdmin } from '../middleware/admin';
import { orgActivity } from '../services/activity';
import { evaluateCohort, kfloorN, orgConsent, previewFor } from '../services/cohort';
import { criteriaHash } from '../services/cohort-hash';
import { buildEstimate } from '../services/estimate';
import { ontologyResponse, conceptBySlug } from '../services/ontology';
import { buyerSearch } from '../services/search';
import { createCampaign, getCampaign, launchCampaign, listCampaigns, listStudies, recontactStudy, requestProposal, studyDetail, studyParticipants, validateVariables } from '../services/campaign';
import { createExportRequest, datasetDetail, listDatasets, refreshDataset, workspace } from '../services/dataset';
import { advanceStudy } from '../services/simulate';
import { previewVariable, requestVariable } from '../services/variables';

export const buyerRouter = Router();

const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  await Promise.resolve().then(() => fn(req, res)).catch(next);
};
const orgId = (req: Request): number => (req.persona.kind === 'buyer' ? req.persona.orgId : 1);

function parseCriteria(raw: unknown): CohortCriteria {
  const r = CohortCriteria.safeParse(raw ?? {});
  if (!r.success) throw badRequest(`invalid criteria: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}
async function scalar(sql: string, ...params: (number | string)[]): Promise<number> {
  return (await graph().get<{ n: number }>(sql, ...params))?.n ?? 0;
}

buyerRouter.get('/home', wrap(async (req, res) => {
  const db = graph();
  const id = orgId(req);
  const consent = await orgConsent(id, db);
  const org = await db.tableExists('buyer_org') ? await db.get<{ id: number; name: string; type: string; declared_uses_json: string }>('SELECT id, name, type, declared_uses_json FROM buyer_org WHERE id = ?', id) : undefined;
  const ready = await db.tableExists('participant');
  const ehr = await conceptBySlug('clinical.encounters.ehr_history', db);
  const exome = await conceptBySlug('biology.genomics.exome', db);
  const tiles = consent.blocked || !ready
    ? { availableParticipants: 0, longitudinalProfiles: 0, genomicsAvailable: 0, recontactable: 0 }
    : {
        // vault-only participants (2026-11-10 notes) are not available to research at all
        availableParticipants: kfloorN((await scalar('SELECT COUNT(*) AS n FROM participant p LEFT JOIN consent_setting cs ON cs.participant_id = p.id WHERE COALESCE(cs.vault_only, 0) = 0'))),
        longitudinalProfiles: kfloorN(ehr ? await scalar('SELECT COUNT(*) AS n FROM participant_coverage cv LEFT JOIN consent_setting cs ON cs.participant_id = cv.participant_id WHERE cv.concept_id = ? AND cv.span_days >= 365 AND cv.n_obs > 0 AND COALESCE(cs.vault_only, 0) = 0', ehr.id) : 0),
        genomicsAvailable: kfloorN(exome ? await scalar('SELECT COUNT(*) AS n FROM participant_coverage cv LEFT JOIN consent_setting cs ON cs.participant_id = cv.participant_id WHERE cv.concept_id = ? AND cv.n_obs > 0 AND COALESCE(cs.vault_only, 0) = 0', exome.id) : 0),
        recontactable: kfloorN((await scalar('SELECT COUNT(*) AS n FROM consent_setting WHERE recontact_opt_in = 1 AND vault_only = 0'))),
      };
  const body: BuyerHome = {
    org: { id, name: org?.name ?? 'Unknown organisation', type: org?.type ?? 'other', declaredUses: org ? (JSON.parse(org.declared_uses_json) as string[]) : [] },
    tiles,
    activity: await orgActivity(id, 8, db),
    counts: ready
      ? {
          studies: await scalar('SELECT COUNT(*) AS n FROM study WHERE buyer_org_id = ?', id),
          datasets: await scalar('SELECT COUNT(*) AS n FROM dataset d JOIN study s ON s.id = d.study_id WHERE s.buyer_org_id = ?', id),
          campaigns: await scalar("SELECT COUNT(*) AS n FROM campaign c JOIN study s ON s.id = c.study_id WHERE s.buyer_org_id = ? AND c.status IN ('draft','proposal_requested','active')", id),
        }
      : { studies: 0, datasets: 0, campaigns: 0 },
  };
  res.json(body);
}));

buyerRouter.get('/search', wrap(async (req, res) => {
  res.json((await buyerSearch(orgId(req), typeof req.query.q === 'string' ? req.query.q : '')));
}));

buyerRouter.post('/cohorts/preview', wrap(async (req, res) => {
  const criteria = parseCriteria(req.body);
  const body: CohortPreview = await previewFor(criteria, orgId(req));
  res.json(body);
}));

function toSaved(r: { id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }): SavedCohort {
  return { id: r.id, name: r.name, criteria: CohortCriteria.parse(JSON.parse(r.criteria_json)), createdAt: r.created_at, orgId: r.buyer_org_id };
}

buyerRouter.post('/cohorts', wrap(async (req, res) => {
  const db = graph();
  const id = orgId(req);
  const consent = await orgConsent(id, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const input = (req.body ?? {}) as CohortCreate;
  const criteria = parseCriteria(input.criteria);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Untitled cohort';
  const now = nowIso();
  const cohortId = await db.tx(async () => (await db.run('INSERT INTO cohort_definition (buyer_org_id, name, criteria_json, criteria_hash, created_at) VALUES (?,?,?,?,?)', id, name, JSON.stringify(criteria), criteriaHash(criteria), now)).lastId);
  const row = (await db.get<{ id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }>('SELECT * FROM cohort_definition WHERE id = ?', cohortId))!;
  const body: SavedCohortDetail = { ...toSaved(row), preview: await previewFor(criteria, id) };
  res.status(201).json(body);
}));

buyerRouter.get('/cohorts', wrap(async (req, res) => {
  const db = graph();
  const rows = await db.tableExists('cohort_definition') ? await db.all<{ id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }>('SELECT * FROM cohort_definition WHERE buyer_org_id = ? ORDER BY id DESC', orgId(req)) : [];
  const body: SavedCohortList = { cohorts: rows.map(toSaved) };
  res.json(body);
}));

buyerRouter.get('/cohorts/:id', wrap(async (req, res) => {
  const db = graph();
  const row = await db.tableExists('cohort_definition') ? await db.get<{ id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }>('SELECT * FROM cohort_definition WHERE id = ? AND buyer_org_id = ?', Number(req.params.id), orgId(req)) : undefined;
  if (!row) throw notFound('cohort');
  const saved = toSaved(row);
  const body: SavedCohortDetail = { ...saved, preview: await previewFor(saved.criteria, orgId(req)) };
  res.json(body);
}));

buyerRouter.post('/campaigns/estimate', wrap(async (req, res) => {
  const db = graph();
  const id = orgId(req);
  const consent = await orgConsent(id, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const input = (req.body ?? {}) as EstimateRequest;
  let criteria: CohortCriteria;
  if (input.cohortId) {
    const row = await db.get<{ criteria_json: string }>('SELECT criteria_json FROM cohort_definition WHERE id = ? AND buyer_org_id = ?', input.cohortId, id);
    if (!row) throw notFound('cohort');
    criteria = parseCriteria(JSON.parse(row.criteria_json));
  } else criteria = parseCriteria(input.criteria);
  const targetN = Number(input.targetN);
  if (!Number.isFinite(targetN) || targetN <= 0) throw badRequest('targetN must be a positive number');
  const variables: CampaignVariable[] = await validateVariables(input.variables, db);
  const ev = await evaluateCohort(criteria, { orgId: id, variables }, db);
  const body: Estimate = buildEstimate({ targetN: Math.round(targetN), readyNow: ev.readyNow, groups: ev.groups, variables });
  res.json(body);
}));

// ---- campaigns: draft → proposal → launch ----
buyerRouter.post('/campaigns', wrap(async (req, res) => {
  const body: Campaign = await createCampaign(orgId(req), (req.body ?? {}) as CampaignCreate);
  res.status(201).json(body);
}));
buyerRouter.get('/campaigns', wrap(async (req, res) => {
  const body: CampaignList = { campaigns: await listCampaigns(orgId(req)) };
  res.json(body);
}));
buyerRouter.get('/campaigns/:id', wrap(async (req, res) => {
  const body: Campaign = await getCampaign(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.post('/campaigns/:id/request-proposal', wrap(async (req, res) => {
  const body: Campaign = await requestProposal(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.post('/campaigns/:id/launch', wrap(async (req, res) => {
  const body: Campaign = await launchCampaign(orgId(req), Number(req.params.id));
  res.json(body);
}));

// ---- studies (B7) ----
buyerRouter.get('/studies', wrap(async (req, res) => {
  const body: StudyList = { studies: await listStudies(orgId(req)) };
  res.json(body);
}));
buyerRouter.get('/studies/:id', wrap(async (req, res) => {
  const body: StudyDetail = await studyDetail(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.get('/studies/:id/participants', wrap(async (req, res) => {
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const body: StudyParticipants = await studyParticipants(orgId(req), Number(req.params.id), { limit: Number.isFinite(limit) ? limit : undefined, offset: Number.isFinite(offset) ? offset : undefined });
  res.json(body);
}));
// simulation control (moves a study forward in time): on a hosted deployment it needs the admin token header
buyerRouter.post('/studies/:id/advance', requireAdmin, wrap(async (req, res) => {
  const input = (req.body ?? {}) as AdvanceRequest;
  const body: AdvanceResult = await advanceStudy(orgId(req), Number(req.params.id), Number(input.days ?? 7));
  res.json(body);
}));
buyerRouter.post('/studies/:id/recontact', wrap(async (req, res) => {
  const body: RecontactResult = { ...await recontactStudy(orgId(req), Number(req.params.id)), ok: true, writeVersion: (await graph().version()) };
  res.json(body);
}));
buyerRouter.get('/studies/:id/variables/preview', wrap(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const query: VariablePreviewQuery = { concept: q.concept ?? '', durationDays: Number(q.durationDays ?? 1), minProvRank: Number(q.minProvRank ?? 3), targetN: Number(q.targetN ?? 0), compCents: q.compCents !== undefined ? Number(q.compCents) : undefined };
  const body: VariablePreview = await previewVariable(orgId(req), Number(req.params.id), query);
  res.json(body);
}));
buyerRouter.post('/studies/:id/variables', wrap(async (req, res) => {
  const body: VariableRequestResult = await requestVariable(orgId(req), Number(req.params.id), (req.body ?? {}) as VariableRequest);
  res.status(201).json(body);
}));

// ---- datasets (B8) ----
buyerRouter.get('/datasets', wrap(async (req, res) => {
  const body: DatasetList = { datasets: await listDatasets(orgId(req)) };
  res.json(body);
}));
buyerRouter.get('/datasets/:id', wrap(async (req, res) => {
  const tabs: DatasetTab[] = ['variables', 'documentation', 'provenance', 'missingness', 'longitudinal', 'ontology'];
  const tab = typeof req.query.tab === 'string' && tabs.includes(req.query.tab as DatasetTab) ? (req.query.tab as DatasetTab) : undefined;
  const body: Dataset = await datasetDetail(orgId(req), Number(req.params.id), tab);
  res.json(body);
}));
buyerRouter.get('/datasets/:id/workspace', wrap(async (req, res) => {
  const body: Workspace = await workspace(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.post('/datasets/:id/refresh', wrap(async (req, res) => {
  const body: DatasetRefreshResult = { ...await refreshDataset(orgId(req), Number(req.params.id)), ok: true, writeVersion: (await graph().version()) };
  res.json(body);
}));
buyerRouter.post('/datasets/:id/export-request', wrap(async (req, res) => {
  const input = (req.body ?? {}) as ExportRequestInput;
  const r = await createExportRequest(orgId(req), Number(req.params.id), Array.isArray(input.variables) ? input.variables.map(String) : undefined);
  const body: ExportRequestResult = { ...r, ok: true, writeVersion: (await graph().version()) };
  res.status(201).json(body);
}));

buyerRouter.get('/ontology', wrap(async (_req, res) => {
  res.json((await ontologyResponse()));
}));
