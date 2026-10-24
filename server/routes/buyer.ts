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

const wrap = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response, next: NextFunction) => {
  try { fn(req, res); } catch (e) { next(e); }
};
const orgId = (req: Request): number => (req.persona.kind === 'buyer' ? req.persona.orgId : 1);

function parseCriteria(raw: unknown): CohortCriteria {
  const r = CohortCriteria.safeParse(raw ?? {});
  if (!r.success) throw badRequest(`invalid criteria: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return r.data;
}
function scalar(sql: string, ...params: (number | string)[]): number {
  return graph().get<{ n: number }>(sql, ...params)?.n ?? 0;
}

buyerRouter.get('/home', wrap((req, res) => {
  const db = graph();
  const id = orgId(req);
  const consent = orgConsent(id, db);
  const org = db.tableExists('buyer_org') ? db.get<{ id: number; name: string; type: string; declared_uses_json: string }>('SELECT id, name, type, declared_uses_json FROM buyer_org WHERE id = ?', id) : undefined;
  const ready = db.tableExists('participant');
  const ehr = conceptBySlug('clinical.encounters.ehr_history', db);
  const exome = conceptBySlug('biology.genomics.exome', db);
  const tiles = consent.blocked || !ready
    ? { availableParticipants: 0, longitudinalProfiles: 0, genomicsAvailable: 0, recontactable: 0 }
    : {
        availableParticipants: kfloorN(scalar('SELECT COUNT(*) AS n FROM participant')),
        longitudinalProfiles: kfloorN(ehr ? scalar('SELECT COUNT(*) AS n FROM participant_coverage WHERE concept_id = ? AND span_days >= 365 AND n_obs > 0', ehr.id) : 0),
        genomicsAvailable: kfloorN(exome ? scalar('SELECT COUNT(*) AS n FROM participant_coverage WHERE concept_id = ? AND n_obs > 0', exome.id) : 0),
        recontactable: kfloorN(scalar('SELECT COUNT(*) AS n FROM consent_setting WHERE recontact_opt_in = 1')),
      };
  const body: BuyerHome = {
    org: { id, name: org?.name ?? 'Unknown organisation', type: org?.type ?? 'other', declaredUses: org ? (JSON.parse(org.declared_uses_json) as string[]) : [] },
    tiles,
    activity: orgActivity(id, 8, db),
    counts: ready
      ? {
          studies: scalar('SELECT COUNT(*) AS n FROM study WHERE buyer_org_id = ?', id),
          datasets: scalar('SELECT COUNT(*) AS n FROM dataset d JOIN study s ON s.id = d.study_id WHERE s.buyer_org_id = ?', id),
          campaigns: scalar("SELECT COUNT(*) AS n FROM campaign c JOIN study s ON s.id = c.study_id WHERE s.buyer_org_id = ? AND c.status IN ('draft','proposal_requested','active')", id),
        }
      : { studies: 0, datasets: 0, campaigns: 0 },
  };
  res.json(body);
}));

buyerRouter.get('/search', wrap((req, res) => {
  res.json(buyerSearch(orgId(req), typeof req.query.q === 'string' ? req.query.q : ''));
}));

buyerRouter.post('/cohorts/preview', wrap((req, res) => {
  const criteria = parseCriteria(req.body);
  const body: CohortPreview = previewFor(criteria, orgId(req));
  res.json(body);
}));

function toSaved(r: { id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }): SavedCohort {
  return { id: r.id, name: r.name, criteria: CohortCriteria.parse(JSON.parse(r.criteria_json)), createdAt: r.created_at, orgId: r.buyer_org_id };
}

buyerRouter.post('/cohorts', wrap((req, res) => {
  const db = graph();
  const id = orgId(req);
  const consent = orgConsent(id, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const input = (req.body ?? {}) as CohortCreate;
  const criteria = parseCriteria(input.criteria);
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : 'Untitled cohort';
  const now = nowIso();
  const cohortId = db.tx(() => db.run('INSERT INTO cohort_definition (buyer_org_id, name, criteria_json, criteria_hash, created_at) VALUES (?,?,?,?,?)', id, name, JSON.stringify(criteria), criteriaHash(criteria), now).lastId);
  const row = db.get<{ id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }>('SELECT * FROM cohort_definition WHERE id = ?', cohortId)!;
  const body: SavedCohortDetail = { ...toSaved(row), preview: previewFor(criteria, id) };
  res.status(201).json(body);
}));

buyerRouter.get('/cohorts', wrap((req, res) => {
  const db = graph();
  const rows = db.tableExists('cohort_definition') ? db.all<{ id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }>('SELECT * FROM cohort_definition WHERE buyer_org_id = ? ORDER BY id DESC', orgId(req)) : [];
  const body: SavedCohortList = { cohorts: rows.map(toSaved) };
  res.json(body);
}));

buyerRouter.get('/cohorts/:id', wrap((req, res) => {
  const db = graph();
  const row = db.tableExists('cohort_definition') ? db.get<{ id: number; name: string; criteria_json: string; created_at: string; buyer_org_id: number }>('SELECT * FROM cohort_definition WHERE id = ? AND buyer_org_id = ?', Number(req.params.id), orgId(req)) : undefined;
  if (!row) throw notFound('cohort');
  const saved = toSaved(row);
  const body: SavedCohortDetail = { ...saved, preview: previewFor(saved.criteria, orgId(req)) };
  res.json(body);
}));

buyerRouter.post('/campaigns/estimate', wrap((req, res) => {
  const db = graph();
  const id = orgId(req);
  const consent = orgConsent(id, db);
  if (consent.blocked) throw forbidden(consent.reason ?? 'blocked by participant red-lines');
  const input = (req.body ?? {}) as EstimateRequest;
  let criteria: CohortCriteria;
  if (input.cohortId) {
    const row = db.get<{ criteria_json: string }>('SELECT criteria_json FROM cohort_definition WHERE id = ? AND buyer_org_id = ?', input.cohortId, id);
    if (!row) throw notFound('cohort');
    criteria = parseCriteria(JSON.parse(row.criteria_json));
  } else criteria = parseCriteria(input.criteria);
  const targetN = Number(input.targetN);
  if (!Number.isFinite(targetN) || targetN <= 0) throw badRequest('targetN must be a positive number');
  const variables: CampaignVariable[] = validateVariables(input.variables, db);
  const ev = evaluateCohort(criteria, { orgId: id, variables }, db);
  const body: Estimate = buildEstimate({ targetN: Math.round(targetN), readyNow: ev.readyNow, groups: ev.groups, variables });
  res.json(body);
}));

// ---- campaigns: draft → proposal → launch ----
buyerRouter.post('/campaigns', wrap((req, res) => {
  const body: Campaign = createCampaign(orgId(req), (req.body ?? {}) as CampaignCreate);
  res.status(201).json(body);
}));
buyerRouter.get('/campaigns', wrap((req, res) => {
  const body: CampaignList = { campaigns: listCampaigns(orgId(req)) };
  res.json(body);
}));
buyerRouter.get('/campaigns/:id', wrap((req, res) => {
  const body: Campaign = getCampaign(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.post('/campaigns/:id/request-proposal', wrap((req, res) => {
  const body: Campaign = requestProposal(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.post('/campaigns/:id/launch', wrap((req, res) => {
  const body: Campaign = launchCampaign(orgId(req), Number(req.params.id));
  res.json(body);
}));

// ---- studies (B7) ----
buyerRouter.get('/studies', wrap((req, res) => {
  const body: StudyList = { studies: listStudies(orgId(req)) };
  res.json(body);
}));
buyerRouter.get('/studies/:id', wrap((req, res) => {
  const body: StudyDetail = studyDetail(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.get('/studies/:id/participants', wrap((req, res) => {
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
  const body: StudyParticipants = studyParticipants(orgId(req), Number(req.params.id), { limit: Number.isFinite(limit) ? limit : undefined, offset: Number.isFinite(offset) ? offset : undefined });
  res.json(body);
}));
buyerRouter.post('/studies/:id/advance', wrap((req, res) => {
  const input = (req.body ?? {}) as AdvanceRequest;
  const body: AdvanceResult = advanceStudy(orgId(req), Number(req.params.id), Number(input.days ?? 7));
  res.json(body);
}));
buyerRouter.post('/studies/:id/recontact', wrap((req, res) => {
  const body: RecontactResult = { ...recontactStudy(orgId(req), Number(req.params.id)), ok: true, writeVersion: graph().writeVersion };
  res.json(body);
}));
buyerRouter.get('/studies/:id/variables/preview', wrap((req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const query: VariablePreviewQuery = { concept: q.concept ?? '', durationDays: Number(q.durationDays ?? 1), minProvRank: Number(q.minProvRank ?? 3), targetN: Number(q.targetN ?? 0), compCents: q.compCents !== undefined ? Number(q.compCents) : undefined };
  const body: VariablePreview = previewVariable(orgId(req), Number(req.params.id), query);
  res.json(body);
}));
buyerRouter.post('/studies/:id/variables', wrap((req, res) => {
  const body: VariableRequestResult = requestVariable(orgId(req), Number(req.params.id), (req.body ?? {}) as VariableRequest);
  res.status(201).json(body);
}));

// ---- datasets (B8) ----
buyerRouter.get('/datasets', wrap((req, res) => {
  const body: DatasetList = { datasets: listDatasets(orgId(req)) };
  res.json(body);
}));
buyerRouter.get('/datasets/:id', wrap((req, res) => {
  const tabs: DatasetTab[] = ['variables', 'documentation', 'provenance', 'missingness', 'longitudinal', 'ontology'];
  const tab = typeof req.query.tab === 'string' && tabs.includes(req.query.tab as DatasetTab) ? (req.query.tab as DatasetTab) : undefined;
  const body: Dataset = datasetDetail(orgId(req), Number(req.params.id), tab);
  res.json(body);
}));
buyerRouter.get('/datasets/:id/workspace', wrap((req, res) => {
  const body: Workspace = workspace(orgId(req), Number(req.params.id));
  res.json(body);
}));
buyerRouter.post('/datasets/:id/refresh', wrap((req, res) => {
  const body: DatasetRefreshResult = { ...refreshDataset(orgId(req), Number(req.params.id)), ok: true, writeVersion: graph().writeVersion };
  res.json(body);
}));
buyerRouter.post('/datasets/:id/export-request', wrap((req, res) => {
  const input = (req.body ?? {}) as ExportRequestInput;
  const r = createExportRequest(orgId(req), Number(req.params.id), Array.isArray(input.variables) ? input.variables.map(String) : undefined);
  const body: ExportRequestResult = { ...r, ok: true, writeVersion: graph().writeVersion };
  res.status(201).json(body);
}));

buyerRouter.get('/ontology', wrap((_req, res) => {
  res.json(ontologyResponse());
}));
