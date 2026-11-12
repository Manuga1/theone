// Participant API. The ONLY importer of db/vault.ts (identity). Every number here is a query result.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { DEMO_TODAY } from '@shared/clock';
import type {
  NodeDetail, Ok, ParticipantHome, ParticipantLedger, ParticipantOpportunities, ParticipantPermissions, ParticipantProfile,
  ParticipantSignature, ParticipantSources, ParticipantTimeline, PermissionsUpdate, SelfReportInput, OpportunityTab,
} from '@shared/api-types';
import { graph } from '../db/graph';
import { vault } from '../db/vault';
import { notFound, badRequest } from '../errors';
import { participantActivity } from '../services/activity';
import { completenessSummary, ring, signatureTree, SIGNATURE_LEGEND } from '../services/completeness';
import { lifetimeEarnings, licensedUses, readLedger } from '../services/ledger';
import { nodeDetail } from '../services/node';
import { availableSummary, listOpportunities, opportunityDetail } from '../services/opportunities';
import { readPermissions, updatePermissions } from '../services/permissions';
import { connectSource, disconnectSource, missingDimensions, participantSources, selfReport, verifiedSourceCount, watchConcept } from '../services/sources';
import { timeline } from '../services/timeline';
import { acceptOpportunity, declineOpportunity, reviewOpportunity, viewOpportunity } from '../services/consent';
import { deleteCategory, revokeLicense, withdrawEnrollment } from '../services/governance';
import { simulateContribution } from '../services/simulate';
import { licenseNumber } from '../services/ledger';
import type { AcceptResult, SimulateResult, CategoryDeleteResult, AppleHealthImportResult, IngestQueue, QuickLogInput, QuickLogResult, ReviewAction, ReviewResult, UploadFileInput, UploadResult } from '@shared/api-types';
import { inboxCounts, ingestQueue, reviewItem, uploadFiles } from '../services/ingest';
import { quickLog } from '../services/quicklog';
import { importAppleHealth } from '../services/appleHealth';
import { classifierName } from '../services/classify';
import type { AuditLog, AuditVerify, CheckIn, CheckInInput, CheckInResult, LoggingRewards, OnboardingInput, OnboardingState } from '@shared/api-types';
import { auditLog, verifyChain } from '../services/audit';
import { getCheckIn, submitCheckIn } from '../services/checkin';
import { isVaultOnly } from '../services/consent';
import { advanceOnboarding, onboardingState, type IdentityView } from '../services/onboarding';
import { loggingRewards, rewardsToday } from '../services/rewards';

export const participantRouter = Router();

type ParticipantRow = { id: number; pseudonym: string; sex: string; birth_year: number; country: string; region: string | null; enrolled_at: string };
type IdentityRow = { legal_name: string; email: string; phone: string; dob: string; verification_status: string };

/** The detailed participant (Alex). Undefined on a schema-only database. */
async function detailed(): Promise<ParticipantRow | undefined> {
  const db = graph();
  if (!await db.tableExists('participant')) return undefined;
  return await db.get<ParticipantRow>('SELECT id, pseudonym, sex, birth_year, country, region, enrolled_at FROM participant WHERE is_detailed = 1 ORDER BY id LIMIT 1');
}
async function identity(participantId: number): Promise<IdentityRow | undefined> {
  const v = vault();
  if (!await v.tableExists('identity')) return undefined;
  return await v.get<IdentityRow>('SELECT legal_name, email, phone, dob, verification_status FROM identity WHERE participant_id = ?', participantId);
}
const ok = async (): Promise<Ok> => ({ ok: true, writeVersion: (await graph().version()) });
const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  await Promise.resolve().then(() => fn(req, res)).catch(next);
};
const wrapAsync = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => {
  await fn(req, res).catch(next);
};

const EMPTY_HOME: ParticipantHome = {
  participant: { pseudonym: '', firstName: '', age: 0 }, completeness: { pct: 0, deltaMonth: 0 }, verifiedSources: 0, lifetimeEarningsCents: 0,
  licensedUses: 0, opportunities: { count: 0, maxCents: 0 }, ring: [], whatChanged: [], empty: true,
};

participantRouter.get('/home', wrap(async (_req, res) => {
  const p = await detailed();
  if (!p) return void res.json(EMPTY_HOME);
  const db = graph();
  const id = await identity(p.id);
  const c = await completenessSummary(p.id, db);
  const body: ParticipantHome = {
    participant: { pseudonym: p.pseudonym, firstName: id ? id.legal_name.split(' ')[0] : 'Participant', age: Number(DEMO_TODAY.slice(0, 4)) - p.birth_year },
    completeness: { pct: c.pct, deltaMonth: c.deltaMonth },
    verifiedSources: await verifiedSourceCount(p.id, db),
    lifetimeEarningsCents: await lifetimeEarnings(p.id, db),
    licensedUses: await licensedUses(p.id, db),
    opportunities: await availableSummary(p.id, db),
    ring: await ring(c.now, db),
    whatChanged: await participantActivity(p.id, 6, db),
    // 2026-11-10 notes: inbox, vault mode, onboarding flag, today's check-in and logging rewards
    inbox: await inboxCounts(p.id, db),
    vaultOnly: await isVaultOnly(p.id, db),
    onboardingCompleted: !!(await db.get<{ o: string | null }>('SELECT onboarded_at AS o FROM participant WHERE id = ?', p.id))?.o,
    checkIn: await (async () => { const c = await getCheckIn(p.id, db); return { done: c.done, promptCount: c.prompts.length, streakDays: c.streakDays }; })(),
    rewardsToday: await rewardsToday(p.id, db),
  };
  res.json(body);
}));

// ---- 2026-11-10 notes: logging rewards, daily check-in, onboarding, the audit chain ----
const EMPTY_REWARDS: LoggingRewards = { enabled: false, disabledReason: 'No participant data — run `npm run seed`.', rules: [], todayCents: 0, weekCents: 0, streakDays: 0 };
participantRouter.get('/rewards', wrap(async (_req, res) => {
  const p = await detailed();
  const body: LoggingRewards = p ? await loggingRewards(p.id) : EMPTY_REWARDS;
  res.json(body);
}));
participantRouter.get('/checkin', wrap(async (_req, res) => {
  const p = await detailed();
  const body: CheckIn = p ? await getCheckIn(p.id) : { date: DEMO_TODAY, done: false, prompts: [], streakDays: 0, rewardCents: 0 };
  res.json(body);
}));
participantRouter.post('/checkin', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body: CheckInResult = await submitCheckIn(p.id, (req.body ?? {}) as CheckInInput);
  res.json(body);
}));
const identityView = async (participantId: number): Promise<IdentityView | undefined> => {
  const id = await identity(participantId);
  return id ? { legalName: id.legal_name, email: id.email, dob: id.dob, verificationStatus: id.verification_status } : undefined;
};
participantRouter.get('/onboarding', wrap(async (_req, res) => {
  const p = await detailed();
  const body: OnboardingState = p
    ? await onboardingState(p.id, (await identityView(p.id)))
    : { completed: false, step: 'identity', identity: { status: 'unverified', legalName: '', email: '', dob: '' }, consent: { recontactOptIn: true, commercialOk: true, excludedCategories: [], prohibitedUses: [] }, vaultOnly: false };
  res.json(body);
}));
participantRouter.post('/onboarding', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body: OnboardingState = await advanceOnboarding(p.id, (req.body ?? {}) as OnboardingInput, (await identityView(p.id)));
  res.json(body);
}));
participantRouter.get('/audit', wrap(async (_req, res) => {
  const p = await detailed();
  const body: AuditLog = await auditLog(p ? p.id : null);
  res.json(body);
}));
participantRouter.post('/audit/verify', wrap(async (_req, res) => {
  const body: AuditVerify = await verifyChain();
  res.json(body);
}));

participantRouter.get('/signature', wrap(async (_req, res) => {
  const p = await detailed();
  const body: ParticipantSignature = { domains: p ? (await signatureTree(p.id)).tree : [], legend: SIGNATURE_LEGEND };
  res.json(body);
}));

participantRouter.get('/nodes/:slug', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body: NodeDetail | null = await nodeDetail(p.id, String(req.params.slug));
  if (!body) throw notFound('concept');
  res.json(body);
}));

participantRouter.get('/timeline', wrap(async (req, res) => {
  const p = await detailed();
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const body: ParticipantTimeline = p ? await timeline(p.id, category) : { categories: [{ key: 'all', label: 'All', n: 0 }], events: [], swimlane: { window: { from: DEMO_TODAY, to: DEMO_TODAY }, months: [], lanes: [] } };
  res.json(body);
}));

participantRouter.get('/sources', wrap(async (_req, res) => {
  const p = await detailed();
  const body: ParticipantSources = p ? await participantSources(p.id) : { sources: [], missing: [] };
  res.json(body);
}));
participantRouter.post('/sources/:id/connect', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const r = await connectSource(p.id, Number(req.params.id));
  res.json({ ...await ok(), ...r });
}));
participantRouter.post('/sources/:id/disconnect', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  await disconnectSource(p.id, Number(req.params.id));
  res.json((await ok()));
}));

participantRouter.get('/missing', wrap(async (_req, res) => {
  const p = await detailed();
  res.json({ missing: p ? await missingDimensions(p.id) : [] });
}));
participantRouter.post('/missing/:slug/notify', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  await watchConcept(p.id, String(req.params.slug));
  res.json((await ok()));
}));
participantRouter.post('/missing/:slug/self-report', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const input = (req.body ?? {}) as SelfReportInput;
  if (typeof input !== 'object') throw badRequest('invalid body');
  const id = await selfReport(p.id, String(req.params.slug), input);
  res.json({ ...await ok(), observationId: id });
}));

participantRouter.get('/opportunities', wrap(async (req, res) => {
  const p = await detailed();
  const tab = typeof req.query.tab === 'string' && ['available', 'in_progress', 'past'].includes(req.query.tab) ? (req.query.tab as OpportunityTab) : undefined;
  const body: ParticipantOpportunities = p ? await listOpportunities(p.id, tab) : { counts: { available: 0, in_progress: 0, past: 0 }, items: [] };
  res.json(body);
}));
participantRouter.get('/opportunities/:id', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body = await opportunityDetail(p.id, Number(req.params.id));
  if (!body) throw notFound('opportunity');
  res.json(body);
}));

// ---- loop: respond to an opportunity (P7), contribute, govern ----
participantRouter.post('/opportunities/:id/view', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  res.json({ ...await ok(), status: await viewOpportunity(p.id, Number(req.params.id)) });
}));
participantRouter.post('/opportunities/:id/review', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  res.json({ ...await ok(), status: await reviewOpportunity(p.id, Number(req.params.id)) });
}));
participantRouter.post('/opportunities/:id/accept', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const r = await acceptOpportunity(p.id, Number(req.params.id));
  const body: AcceptResult = { ...await ok(), enrollmentId: r.enrollmentId, licenseId: r.licenseId, licenseNumber: licenseNumber(r.licenseNumber), contributionIds: r.contributionIds };
  res.json(body);
}));
participantRouter.post('/opportunities/:id/decline', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  res.json({ ...await ok(), status: await declineOpportunity(p.id, Number(req.params.id)) });
}));
participantRouter.post('/contributions/:id/simulate', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body: SimulateResult = await simulateContribution(p.id, Number(req.params.id));
  res.json(body);
}));
participantRouter.post('/enrollments/:id/withdraw', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  res.json({ ...await ok(), ...await withdrawEnrollment(p.id, Number(req.params.id)) });
}));
participantRouter.post('/licenses/:id/revoke', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  res.json({ ...await ok(), ...await revokeLicense(p.id, Number(req.params.id)) });
}));
participantRouter.delete('/categories/:domain', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body: CategoryDeleteResult = await deleteCategory(p.id, String(req.params.domain));
  res.json(body);
}));

participantRouter.get('/ledger', wrap(async (_req, res) => {
  const p = await detailed();
  const body: ParticipantLedger = p ? await readLedger(p.id) : { lifetimeEarningsCents: 0, activeLicenses: 0, licensedUses: 0, entries: [], split: { participant: 0.9, platform: 0.1 } };
  res.json(body);
}));

participantRouter.get('/permissions', wrap(async (_req, res) => {
  const p = await detailed();
  const body: ParticipantPermissions = await readPermissions(p?.id ?? 0);
  res.json(body);
}));
participantRouter.put('/permissions', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const patch = (req.body ?? {}) as PermissionsUpdate;
  res.json((await updatePermissions(p.id, patch)));
}));

participantRouter.get('/profile', wrap(async (_req, res) => {
  const p = await detailed();
  if (!p) {
    const empty: ParticipantProfile = { pseudonym: '', legalName: '', email: '', phone: '', dob: '', age: 0, sex: '', country: '', region: '', enrolledAt: '', verificationStatus: 'none', identityNote: 'No participant data — run `npm run seed`.' };
    return void res.json(empty);
  }
  const id = await identity(p.id);
  const body: ParticipantProfile = {
    pseudonym: p.pseudonym,
    legalName: id?.legal_name ?? '',
    email: id?.email ?? '',
    phone: id?.phone ?? '',
    dob: id?.dob ?? '',
    age: Number(DEMO_TODAY.slice(0, 4)) - p.birth_year,
    sex: p.sex,
    country: p.country,
    region: p.region ?? '',
    enrolledAt: p.enrolled_at,
    verificationStatus: id?.verification_status ?? 'unverified',
    identityNote: 'Your identity lives in a separate vault. Researchers only ever see a study-scoped pseudonym, an age band and a country — never your name, contact details or date of birth.',
  };
  res.json(body);
}));

// ---- ingestion (2026-11-10 notes): uploads are metadata only, quick logs run through the branching rules ----
participantRouter.get('/ingest', wrap(async (req, res) => {
  const p = await detailed();
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const body: IngestQueue = p ? await ingestQueue(p.id, status) : { items: [], counts: { queued: 0, auto_filed: 0, needs_review: 0, accepted: 0, discarded: 0 }, classifier: classifierName(), maxFileBytes: 0, acceptedTypes: [], reviewThreshold: 0.6 };
  res.json(body);
}));
participantRouter.post('/ingest/files', wrapAsync(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const raw = req.body as { files?: UploadFileInput[] } | UploadFileInput[];
  const files = Array.isArray(raw) ? raw : raw?.files;
  if (!Array.isArray(files)) throw badRequest('body must be { files: UploadFileInput[] }');
  const body: UploadResult = await uploadFiles(p.id, files);
  res.json(body);
}));
participantRouter.post('/ingest/:id/review', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body: ReviewResult = await reviewItem(p.id, Number(req.params.id), (req.body ?? {}) as ReviewAction);
  res.json(body);
}));
participantRouter.post('/log', wrapAsync(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const body: QuickLogResult = await quickLog(p.id, (req.body ?? {}) as QuickLogInput);
  res.json(body);
}));
participantRouter.post('/import/apple-health', wrap(async (req, res) => {
  const p = await detailed();
  if (!p) throw notFound('participant');
  const b = req.body as { xml?: string } | string | undefined;
  const xml = typeof b === 'string' ? b : b?.xml;
  if (typeof xml !== 'string') throw badRequest('body must be { xml: string } (JSON) or the export.xml text');
  const body: AppleHealthImportResult = await importAppleHealth(p.id, xml);
  res.json(body);
}));
