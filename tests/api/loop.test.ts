// The whole flywheel over HTTP at scale 0.05: buyer requests microbiome → Alex (a watcher) is notified and offered →
// view → review → accept (reuse license + ledger row) → simulate contribution (payment row, node verified, study
// quality +1, dataset auto-bumped with a Microbiome row) → grip-strength flip → launch creates no license →
// revoke keeps ledger rows and built dataset members → red-lined org 403 → illegal transitions 409 → advance →
// recontact → demo reset.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES } from '../../shared/ontology';
import { satisfiesHistorical, satisfiesProtocol } from '../../shared/requirement';
import { PERSONA_HEADER } from '../../shared/api-types';
import type {
  AcceptResult, AdvanceResult, Campaign, Dataset, DemoResetResult, NodeDetail, OpportunityDetail, ParticipantHome, ParticipantLedger, ParticipantOpportunities, ParticipantSignature,
  ParticipantSources, RecontactResult, SavedCohortDetail, SimulateResult, StudyDetail, StudyList, StudyParticipants, VariablePreview, VariableRequestResult, DatasetList, CampaignList,
} from '../../shared/api-types';
import { graph } from '../../server/db/graph';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

const MICROBIOME = 'biology.microbiome.gut_microbiome';
const GRIP = 'physiology.strength.grip_strength';

describe('the loop (scale 0.05)', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  let pid: number;
  const buyer = { [PERSONA_HEADER]: 'buyer:1' };
  beforeAll(() => { t = seededDbs(); app = createApp(); pid = alexId(t.graph); });
  const pget = (url: string) => request(app).get(`/api/participant${url}`);
  const ppost = (url: string, body: unknown = {}) => request(app).post(`/api/participant${url}`).send(body as object);
  const bget = (url: string, org = 1) => request(app).get(`/api/buyer${url}`).set({ [PERSONA_HEADER]: `buyer:${org}` });
  const bpost = (url: string, body: unknown = {}, org = 1) => request(app).post(`/api/buyer${url}`).set({ [PERSONA_HEADER]: `buyer:${org}` }).send(body as object);
  const n = (sql: string, ...p: (number | string)[]) => graph().get<{ n: number }>(sql, ...p)!.n;

  let studyId = 0;
  let qualityBefore = 0;
  let datasetVersionBefore = 0;
  let earningsBefore = 0;
  let childCampaignId = 0;
  let microOppId = 0;
  let microLicenseId = 0;

  it('B7: the seeded study reads from queries; a seeded completer is study-complete but NOT funnel-complete', async () => {
    const list = (await bget('/studies').expect(200)).body as StudyList;
    const s = list.studies.find((x) => x.name === 'Metabolic Monitoring Study')!;
    studyId = s.id;
    expect(s.status).toBe('active');
    expect(s.counters.invited).toBeGreaterThan(s.counters.accepted);
    expect(s.counters.accepted).toBeGreaterThan(s.counters.started);
    expect(s.counters.started).toBeGreaterThan(s.counters.completed);
    expect(s.counters.completed).toBeGreaterThan(s.counters.qualityAccepted);
    expect(s.datasetId).toBeTypeOf('number');
    const d = (await bget(`/studies/${studyId}`).expect(200)).body as StudyDetail;
    expect(d.coverage.map((c) => c.slug)).toContain('physiology.cardiovascular.blood_pressure');
    expect(d.coverage.find((c) => c.slug === 'biology.genomics.exome')!.pct).toBe(100);
    expect(d.coverage.find((c) => c.slug === 'physiology.cardiovascular.blood_pressure')!.pct).toBeGreaterThan(90);
    expect(d.replacementNote).toMatch(/need replacement/);
    expect(d.campaigns).toHaveLength(1);
    qualityBefore = d.counters.qualityAccepted;
    datasetVersionBefore = ((await bget(`/datasets/${s.datasetId}`).expect(200)).body as Dataset).version;
    // a T4 completer: BP protocol verified (14 d) while the historical branch (≥ 365 d device) fails
    const bp = t.graph.get<{ id: number }>("SELECT id FROM concept WHERE slug = 'physiology.cardiovascular.blood_pressure'")!.id;
    const cov = t.graph.get<{ span_days: number; best_prov_rank: number; protocol_days: number; n_obs: number }>(
      `SELECT cv.span_days, cv.best_prov_rank, cv.protocol_days, cv.n_obs FROM opportunity op JOIN participant p ON p.id = op.participant_id JOIN participant_coverage cv ON cv.participant_id = p.id AND cv.concept_id = ?
        WHERE op.status = 'paid' AND p.tier = 4 ORDER BY op.id LIMIT 1`, bp)!;
    const like = { spanDays: cov.span_days, bestProvRank: cov.best_prov_rank, protocolDays: cov.protocol_days, nObs: cov.n_obs };
    expect(satisfiesProtocol(like, { method: 'device', durationDays: 14, minProvRank: 3 })).toBe(true);
    expect(satisfiesHistorical(like, { minSpanDays: 365, minProvRank: 3 })).toBe(false);
    const parts = (await bget(`/studies/${studyId}/participants?limit=5`).expect(200)).body as StudyParticipants;
    expect(parts.n).toBeGreaterThanOrEqual(20);
    expect(parts.rows).toHaveLength(5);
    expect(parts.rows[0].memberPseudonym).toMatch(/^S-[0-9a-f]{12}$/);
    expect(parts.rows[0].ageBand).toMatch(/^\d\d–\d\d$/);
  });

  it('S11: buyer previews and requests microbiome → Alex (watcher) is notified and offered; P2/P5 flip', async () => {
    const pv = (await bget(`/studies/${studyId}/variables/preview?concept=${MICROBIOME}&durationDays=1&minProvRank=3&targetN=50`).expect(200)).body as VariablePreview;
    expect(pv.isNewConcept).toBe(false);
    expect(pv.missingN).toBeGreaterThan(50);
    expect(pv.recruitableN).toBeGreaterThan(0);
    expect(pv.estimate.contacts).toBeGreaterThan(0);
    const before = ((await pget('/sources')).body as ParticipantSources).missing.find((m) => m.slug === MICROBIOME)!;
    expect(before.action).toBe('watching');
    const licensesBefore = n('SELECT COUNT(*) AS n FROM license');
    const r = (await bpost(`/studies/${studyId}/variables`, { concept: MICROBIOME, protocol: { method: 'kit', durationDays: 1 }, minProvRank: 3, targetN: 50, compCents: 9000 }).expect(201)).body as VariableRequestResult;
    expect(r.conceptSlug).toBe(MICROBIOME);
    expect(r.campaign.status).toBe('active');
    expect(r.campaign.parentCampaignId).toBeTypeOf('number');
    expect(r.offered).toBeGreaterThanOrEqual(r.campaign.estimate.contacts);
    expect(r.watchersNotified).toBe(1);
    expect(n('SELECT COUNT(*) AS n FROM license')).toBe(licensesBefore); // offers never mint licenses
    childCampaignId = r.campaign.id;
    const home = (await pget('/home').expect(200)).body as ParticipantHome;
    expect(home.opportunities.count).toBe(5);
    expect(home.whatChanged[0].text).toContain('Gut microbiome');
    earningsBefore = home.lifetimeEarningsCents;
    const after = ((await pget('/sources')).body as ParticipantSources).missing.find((m) => m.slug === MICROBIOME)!;
    expect(after.action).toBe('see_opportunities');
    microOppId = after.opportunityId!;
    const sig = (await pget('/signature')).body as ParticipantSignature;
    const leaf = sig.domains.flatMap((d) => d.children.flatMap((g) => g.children)).find((l) => l.slug === MICROBIOME)!;
    expect(leaf.state).toBe('missing');
    expect(leaf.overlay).toMatchObject({ opportunity: true, demand: true, opportunityId: microOppId });
    const node = (await pget(`/nodes/${MICROBIOME}`)).body as NodeDetail;
    expect(node.research.requestedBy).toBe(1);
    const campaigns = (await bget('/campaigns').expect(200)).body as CampaignList;
    expect(campaigns.campaigns.find((c) => c.id === childCampaignId)!.counters!.invited).toBeGreaterThan(0);
  });

  it('P7: view → review → accept mints the reuse license + ledger row; accept before review is 409', async () => {
    await ppost(`/opportunities/${microOppId}/accept`).expect(409);
    await ppost(`/opportunities/${microOppId}/view`).expect(200);
    let d = (await pget(`/opportunities/${microOppId}`).expect(200)).body as OpportunityDetail;
    expect(d.status).toBe('viewed');
    expect(d.reviewed).toBe(false);
    expect(d.campaignId).toBe(childCampaignId);
    expect(d.consent.perTask.map((p) => p.conceptSlug)).toEqual([MICROBIOME]);
    expect(d.title).toBe('Gut microbiome collection'); // a child campaign is titled by its campaign name
    expect(d.consent.reusedCompCents).toBe(4000); // the root's reuse variables (EHR 1,500 + exome 2,000 + medications 500) travel with the child campaign
    expect(d.compCents).toBe(9000 + 4000);
    await ppost(`/opportunities/${microOppId}/review`).expect(200);
    d = (await pget(`/opportunities/${microOppId}`)).body as OpportunityDetail;
    expect(d.reviewed).toBe(true);
    const ledgerBefore = (await pget('/ledger')).body as ParticipantLedger;
    const r = (await ppost(`/opportunities/${microOppId}/accept`).expect(200)).body as AcceptResult;
    expect(r.contributionIds).toHaveLength(1);
    expect(r.licenseNumber).toMatch(/^#\d+$/);
    microLicenseId = r.licenseId;
    const ledger = (await pget('/ledger')).body as ParticipantLedger;
    expect(ledger.entries).toHaveLength(ledgerBefore.entries.length + 1);
    expect(ledger.entries[0]).toMatchObject({ kind: 'license_fee', licenseId: r.licenseId, licenseStatus: 'active', studyName: 'Gut microbiome collection', participantCents: 4000, grossCents: 4444, platformCents: 444 });
    expect(ledger.lifetimeEarningsCents).toBe(ledgerBefore.lifetimeEarningsCents + 4000); // no more $0 licenses
    expect(ledger.activeLicenses).toBe(ledgerBefore.activeLicenses + 1);
    expect(ledger.licensedUses).toBe(ledgerBefore.licensedUses + 1);
    const opps = (await pget('/opportunities')).body as ParticipantOpportunities;
    expect(opps.counts).toEqual({ available: 4, in_progress: 2, past: 5 });
    const card = opps.items.find((o) => o.id === microOppId)!;
    expect(card.status).toBe('accepted');
    expect(card.contributions[0]).toMatchObject({ conceptSlug: MICROBIOME, status: 'pending', compCents: 9000 });
    await ppost(`/opportunities/${microOppId}/accept`).expect(409);
  });

  it('contribute: simulate → payment row, earnings rise by the net, node verified, quality +1, dataset bumped with a Microbiome row', async () => {
    const opps = (await pget('/opportunities?tab=in_progress')).body as ParticipantOpportunities;
    const cid = opps.items.find((o) => o.id === microOppId)!.contributions[0].id;
    const r = (await ppost(`/contributions/${cid}/simulate`).expect(200)).body as SimulateResult;
    expect(r).toMatchObject({ status: 'verified', paidCents: 9000, opportunityStatus: 'paid', opportunityComplete: true });
    expect(r.artifactCount).toBeGreaterThan(0);
    await ppost(`/contributions/${cid}/simulate`).expect(409);
    const home = (await pget('/home')).body as ParticipantHome;
    expect(home.lifetimeEarningsCents).toBe(earningsBefore + 4000 + 9000); // reuse license fee + protocol payment
    expect(home.verifiedSources).toBe(13); // the stool kit source was connected by the protocol
    expect(home.whatChanged.some((a) => a.amountCents === 9000)).toBe(true);
    const ledger = (await pget('/ledger')).body as ParticipantLedger;
    expect(ledger.entries[0]).toMatchObject({ kind: 'contribution_payment', participantCents: 9000, grossCents: 10000, platformCents: 1000, studyName: 'Gut microbiome collection' });
    const node = (await pget(`/nodes/${MICROBIOME}`)).body as NodeDetail;
    expect(node.state).toBe('verified');
    // research use: the license gained a (0¢) line for the newly scoped concept and the payment counts toward the node's earnings
    expect(node.research).toMatchObject({ licenses: 1, earningsCents: 9000 });
    expect(n('SELECT COUNT(*) AS n FROM license_line ll JOIN concept k ON k.id = ll.concept_id WHERE ll.license_id = ? AND k.slug = ?', microLicenseId, MICROBIOME)).toBe(1);
    expect(node.summary.provenanceClass).toBe('protocol_measurement');
    expect(node.summary.verification).toBe('Protocol verified');
    expect(node.rawVsDerived.artifactCount).toBe(1);
    expect(node.overlay.opportunity).toBe(false);
    const sources = (await pget('/sources')).body as ParticipantSources;
    expect(sources.missing.find((m) => m.slug === MICROBIOME)).toBeUndefined();
    expect(((await pget('/opportunities')).body as ParticipantOpportunities).counts).toEqual({ available: 4, in_progress: 1, past: 6 });
    // buyer side
    const d = (await bget(`/studies/${studyId}`)).body as StudyDetail;
    expect(d.counters.qualityAccepted).toBe(qualityBefore); // headline counters = the root campaign only
    expect(d.campaigns).toHaveLength(2);
    const child = d.campaigns.find((c) => c.id === childCampaignId)!;
    expect(child.counters.qualityAccepted).toBeGreaterThanOrEqual(1); // Alex (k-floored on the buyer side)
    expect(d.campaigns.find((c) => c.parentCampaignId === null)!.counters).toEqual(d.counters);
    const microCov = d.coverage.find((c) => c.slug === MICROBIOME)!;
    expect(microCov.verified).toBeGreaterThanOrEqual(19);
    expect(microCov).toMatchObject({ campaignId: childCampaignId, started: child.counters.started }); // the child's started count is the denominator
    const ds = (await bget(`/datasets/${d.datasetId}`)).body as Dataset;
    expect(ds.version).toBe(datasetVersionBefore + 1);
    expect(ds.status).toBe('current');
    const micro = ds.variables.find((v) => v.slug === MICROBIOME)!;
    expect(micro).toMatchObject({ label: 'Microbiome', type: 'File/variants' });
    expect(micro.missingPct).toBeGreaterThan(90);
    expect(ds.ontology.some((dom) => dom.slug === 'biology' && dom.children.some((g) => g.children.some((l) => l.slug === MICROBIOME)))).toBe(true);
    const list = (await bget('/datasets')).body as DatasetList;
    expect(list.datasets[0].id).toBe(d.datasetId);
    expect(list.datasets.filter((x) => x.status === 'superseded').length).toBeGreaterThanOrEqual(2);
  });

  it('a completed grip-strength contribution flips the P2 grip node from opportunity to verified', async () => {
    const avail = (await pget('/opportunities?tab=available')).body as ParticipantOpportunities;
    const cardio = avail.items.find((o) => o.title === 'Longitudinal Cardiovascular Study')!;
    await ppost(`/opportunities/${cardio.id}/view`).expect(200);
    await ppost(`/opportunities/${cardio.id}/review`).expect(200);
    const r = (await ppost(`/opportunities/${cardio.id}/accept`).expect(200)).body as AcceptResult;
    expect(r.contributionIds.length).toBeGreaterThanOrEqual(4);
    const card = ((await pget('/opportunities?tab=in_progress')).body as ParticipantOpportunities).items.find((o) => o.id === cardio.id)!;
    const grip = card.contributions.find((c) => c.conceptSlug === GRIP)!;
    const before = (await pget(`/nodes/${GRIP}`)).body as NodeDetail;
    expect(before.state).toBe('missing');
    const sim = (await ppost(`/contributions/${grip.id}/simulate`).expect(200)).body as SimulateResult;
    expect(sim.observationCount).toBe(7); // 3 trials × 2 hands + best-of
    expect(sim.opportunityComplete).toBe(false);
    const after = (await pget(`/nodes/${GRIP}`)).body as NodeDetail;
    expect(after.state).toBe('verified');
    expect(after.overlay.opportunity).toBe(false);
    expect(after.summary.nObs).toBe(6);
    expect(after.lineage[0].key).toBe('device');
    const sig = (await pget('/signature')).body as ParticipantSignature;
    const leaf = sig.domains.flatMap((d) => d.children.flatMap((g) => g.children)).find((l) => l.slug === GRIP)!;
    expect(leaf.state).toBe('verified');
    const strength = sig.domains.find((d) => d.slug === 'physiology')!.children.find((g) => g.slug === 'physiology.strength')!;
    expect(strength.pct).toBeGreaterThan(80);
  });

  it('B6: draft → proposal → launch offers collection opportunities AND reuse-only offers to ready-now members (Alex first); offers mint no license; illegal transitions 409; red-lined org 403', async () => {
    const cohort = (await bpost('/cohorts', { name: 'Loop cohort', criteria: DEFAULT_CRITERIA }).expect(201)).body as SavedCohortDetail;
    const draft = (await bpost('/campaigns', { cohortId: cohort.id, name: 'Loop campaign', purpose: 'Loop test', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES, licenseTermMonths: 12, useTags: ['clinical_research'] }).expect(201)).body as Campaign;
    expect(draft.status).toBe('draft');
    expect(draft.counters).toBeNull();
    expect(draft.estimate.contacts).toBeGreaterThan(0);
    expect(draft.variables.every((v) => typeof v.name === 'string')).toBe(true);
    await bpost(`/campaigns/${draft.id}/launch`, {}, 2).expect(404);
    const proposed = (await bpost(`/campaigns/${draft.id}/request-proposal`).expect(200)).body as Campaign;
    expect(proposed.status).toBe('proposal_requested');
    await bpost(`/campaigns/${draft.id}/request-proposal`).expect(409);
    const licenses = n('SELECT COUNT(*) AS n FROM license');
    const launched = (await bpost(`/campaigns/${draft.id}/launch`).expect(200)).body as Campaign;
    expect(launched.status).toBe('active');
    expect(launched.launchedAt).toBeTruthy();
    expect(launched.counters!.invited).toBeGreaterThanOrEqual(20);
    // reuse-only offers reach every ready-now member (reuse variable present); only members who PRE-AUTHORISED reuse-only licenses accept at once
    const reuseOnly = launched.estimate.reuseOnlyOffered!;
    expect(reuseOnly).toBeGreaterThan(1);
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE campaign_id = ? AND missing_concepts_json = '[]'", draft.id)).toBe(reuseOnly);
    const preauth = n("SELECT COUNT(*) AS n FROM opportunity op JOIN consent_setting cs ON cs.participant_id = op.participant_id WHERE op.campaign_id = ? AND op.missing_concepts_json = '[]' AND cs.preauthorize_reuse_only = 1 AND op.participant_id <> ?", draft.id, pid);
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE campaign_id = ? AND status = 'paid'", draft.id)).toBe(preauth);
    expect(n('SELECT COUNT(*) AS n FROM license')).toBe(licenses + preauth); // an OFFER never mints a license
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE campaign_id = ? AND status = 'offered'", draft.id)).toBe(launched.estimate.contacts + reuseOnly - preauth);
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE campaign_id = ? AND status NOT IN ('offered','paid')", draft.id)).toBe(0);
    // Alex (ready-now, not pre-authorised) holds the FIRST reuse-only offer: nothing to collect, compensation = Σ reuse fees of
    // the reuse variable (EHR 1,200) AND of the collect_if_missing variables he already holds (exome 2,000 + BP 1,400 + food log 825)
    const REUSE_ONLY_FEE = 1200 + 2000 + 1400 + 825;
    const alexOpp = t.graph.get<{ id: number; status: string; comp: number; missing: string }>("SELECT id, status, comp_max_cents AS comp, missing_concepts_json AS missing FROM opportunity WHERE campaign_id = ? AND participant_id = ?", draft.id, pid)!;
    expect(alexOpp).toMatchObject({ status: 'offered', comp: REUSE_ONLY_FEE, missing: '[]' });
    expect(alexOpp.id).toBe(n("SELECT MIN(id) AS n FROM opportunity WHERE campaign_id = ? AND missing_concepts_json = '[]'", draft.id));
    const avail = (await pget('/opportunities?tab=available')).body as ParticipantOpportunities;
    const card = avail.items.find((o) => o.id === alexOpp.id)!;
    expect(card).toMatchObject({ title: 'Loop campaign', compCents: REUSE_ONLY_FEE, requirements: [], reused: ['EHR history', 'Exome', 'Blood Pressure', 'Food log'] });
    await ppost(`/opportunities/${alexOpp.id}/view`).expect(200);
    await ppost(`/opportunities/${alexOpp.id}/review`).expect(200);
    const detail = (await pget(`/opportunities/${alexOpp.id}`)).body as OpportunityDetail;
    expect(detail.consent.perTask).toEqual([]);
    expect(detail.consent.reusedCompCents).toBe(REUSE_ONLY_FEE);
    const earnings = ((await pget('/ledger')).body as ParticipantLedger).lifetimeEarningsCents;
    const acc = (await ppost(`/opportunities/${alexOpp.id}/accept`).expect(200)).body as AcceptResult;
    expect(acc.contributionIds).toEqual([]);
    expect(n('SELECT COUNT(*) AS n FROM license')).toBe(licenses + preauth + 1);
    const led = (await pget('/ledger')).body as ParticipantLedger;
    expect(led.entries[0]).toMatchObject({ kind: 'license_fee', licenseId: acc.licenseId, participantCents: REUSE_ONLY_FEE, grossCents: 6028, platformCents: 603, dataIncluded: ['EHR history', 'Exome', 'Blood Pressure', 'Food log'], studyName: 'Loop campaign' });
    expect(led.lifetimeEarningsCents).toBe(earnings + REUSE_ONLY_FEE);
    expect(n('SELECT COUNT(*) AS n FROM license_line WHERE license_id = ?', acc.licenseId)).toBe(4);
    expect(t.graph.get<{ status: string }>('SELECT status FROM opportunity WHERE id = ?', alexOpp.id)!.status).toBe('paid'); // reuse-only: paid at accept, no contributions
    expect(((await pget('/opportunities?tab=past')).body as ParticipantOpportunities).items.find((o) => o.id === alexOpp.id)!.status).toBe('paid');
    await bpost(`/campaigns/${draft.id}/launch`).expect(409);
    expect(((await bget(`/campaigns/${draft.id}`).expect(200)).body as Campaign).status).toBe('active');
    const studies = (await bget('/studies')).body as StudyList;
    expect(studies.studies.find((s) => s.id === launched.studyId)!.status).toBe('active');
    await bpost('/campaigns', { cohortId: cohort.id, name: 'x', purpose: 'x', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES }, 4).expect(403);
    await bpost('/campaigns', { cohortId: 999999, name: 'x', purpose: 'x', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(404);
    await bpost('/campaigns', { cohortId: cohort.id, name: 'x', purpose: 'x', targetN: 0, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(400);
    await bpost(`/studies/${studyId}/variables`, { concept: MICROBIOME, protocol: { method: 'kit', durationDays: 1 }, minProvRank: 3, targetN: 10 }, 4).expect(404); // not AdTarget's study
    await bget(`/studies/${studyId}`, 4).expect(404);
  });

  it('revoke is forward-only over HTTP: ledger rows and built dataset members stay; the next refresh drops Alex', async () => {
    const d = (await bget(`/studies/${studyId}`)).body as StudyDetail;
    const members = n('SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ?', d.datasetId!);
    expect(n('SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ? AND participant_id = ?', d.datasetId!, pid)).toBe(1);
    const before = (await pget('/ledger')).body as ParticipantLedger;
    await ppost(`/licenses/${microLicenseId}/revoke`).expect(200);
    await ppost(`/licenses/${microLicenseId}/revoke`).expect(409);
    await ppost('/licenses/999999/revoke').expect(404);
    const after = (await pget('/ledger')).body as ParticipantLedger;
    expect(after.entries).toHaveLength(before.entries.length);
    expect(after.lifetimeEarningsCents).toBe(before.lifetimeEarningsCents);
    expect(after.entries.find((e) => e.licenseId === microLicenseId)!.licenseStatus).toBe('revoked');
    expect(after.activeLicenses).toBe(before.activeLicenses - 1);
    expect(n('SELECT COUNT(*) AS n FROM dataset_member WHERE dataset_id = ?', d.datasetId!)).toBe(members);
    const refreshed = (await bpost(`/datasets/${d.datasetId}/refresh`).expect(200)).body as { version: number; dropped: number; memberCount: number };
    expect(refreshed.dropped).toBe(1);
    expect(refreshed.memberCount).toBe(members - 1);
    expect((await bget('/datasets')).body.datasets[0].version).toBe(refreshed.version);
    const exp = (await bpost(`/datasets/${refreshed.version && (await bget('/datasets')).body.datasets[0].id}/export-request`, { variables: [MICROBIOME] }).expect(201)).body as { id: number; status: string };
    expect(exp.status).toBe('requested');
    await bpost(`/datasets/${(await bget('/datasets')).body.datasets[0].id}/export-request`, { variables: ['nope'] }).expect(400);
    // withdraw the in-progress cardiovascular enrollment: licenses revoked, payment for grip kept
    const inProgress = ((await pget('/opportunities?tab=in_progress')).body as ParticipantOpportunities).items;
    expect(inProgress).toHaveLength(2); // seeded Wearable Sleep Study + the cardiovascular study
    const card = inProgress.find((o) => o.title === 'Longitudinal Cardiovascular Study')!;
    await ppost(`/enrollments/${card.enrollmentId}/withdraw`).expect(200);
    await ppost(`/enrollments/${card.enrollmentId}/withdraw`).expect(409);
    expect(((await pget('/ledger')).body as ParticipantLedger).lifetimeEarningsCents).toBe(after.lifetimeEarningsCents);
    const counts = ((await pget('/opportunities')).body as ParticipantOpportunities).counts;
    expect(counts.in_progress).toBe(1);
    expect(counts.past).toBe(8); // 5 seeded + microbiome + the reuse-only Loop license + the withdrawn cardiovascular enrollment
  });

  it('DELETE categories/:domain soft-deletes, rebuilds coverage and excludes the category from new licenses', async () => {
    const before = (await pget('/home')).body as ParticipantHome;
    const r = (await request(app).delete('/api/participant/categories/imaging').expect(200)).body as { observationsDeleted: number; excluded: boolean };
    expect(r.observationsDeleted).toBeGreaterThan(0);
    expect(r.excluded).toBe(true);
    const home = (await pget('/home')).body as ParticipantHome;
    expect(home.ring.find((x) => x.slug === 'imaging')!.pct).toBe(0);
    expect(home.completeness.pct).toBeLessThan(before.completeness.pct);
    await request(app).delete('/api/participant/categories/nope').expect(404);
  });

  it('advance moves bulk opportunities (never Alex); recontact replaces the stale ones', async () => {
    const before = (await bget(`/studies/${studyId}`)).body as StudyDetail;
    const alexOpp = t.graph.get<{ status: string }>("SELECT status FROM opportunity WHERE participant_id = ? AND campaign_id = (SELECT id FROM campaign WHERE name = 'Metabolic Monitoring Study')", pid)!.status;
    const adv = (await bpost(`/studies/${studyId}/advance`, { days: 14 }).expect(200)).body as AdvanceResult;
    expect(adv.days).toBe(14);
    expect(adv.totalDays).toBe(14);
    expect(Object.keys(adv.transitions).length).toBeGreaterThan(2);
    expect(adv.completions).toBeGreaterThan(0);
    expect(adv.counters.started).toBeGreaterThan(before.counters.started);
    expect(adv.datasetVersion).toBeGreaterThan(0);
    expect(t.graph.get<{ status: string }>("SELECT status FROM opportunity WHERE participant_id = ? AND campaign_id = (SELECT id FROM campaign WHERE name = 'Metabolic Monitoring Study')", pid)!.status).toBe(alexOpp);
    expect(((await bget(`/studies/${studyId}`)).body as StudyDetail).lastAdvancedDays).toBe(14);
    await bpost(`/studies/${studyId}/advance`, { days: 0 }).expect(400);
    // every bulk acceptance produced exactly one license + one ledger row; every verified contribution one payment row
    expect(n('SELECT COUNT(*) AS n FROM license')).toBe(n('SELECT COUNT(*) AS n FROM enrollment') + 1); // + Alex's reuse-only #1842 (no enrollment)
    expect(n("SELECT COUNT(*) AS n FROM ledger_entry WHERE kind = 'contribution_payment'")).toBe(n("SELECT COUNT(*) AS n FROM contribution WHERE status = 'verified'"));
    const need = n(`SELECT COUNT(*) AS n FROM opportunity op JOIN campaign c ON c.id = op.campaign_id WHERE c.study_id = ? AND op.status IN ('declined','rejected','expired','withdrawn') AND (op.status <> 'declined' OR op.viewed_at IS NOT NULL)`, studyId);
    expect(need).toBeGreaterThan(0);
    const invited = n('SELECT COUNT(*) AS n FROM opportunity op JOIN campaign c ON c.id = op.campaign_id WHERE c.study_id = ?', studyId);
    const rootBefore = ((await bget(`/studies/${studyId}`)).body as StudyDetail).counters;
    const statusesBefore = t.graph.all<{ id: number; status: string }>(`SELECT id, status FROM opportunity WHERE campaign_id IN (SELECT id FROM campaign WHERE study_id = ?) AND status IN ('declined','rejected','expired','withdrawn') ORDER BY id`, studyId);
    const rc = (await bpost(`/studies/${studyId}/recontact`).expect(200)).body as RecontactResult;
    expect(rc.replaced).toBe(need);
    expect(rc.offered).toBe(need);
    expect(rc.counters.needReplacement).toBe(0);
    expect(n('SELECT COUNT(*) AS n FROM opportunity op JOIN campaign c ON c.id = op.campaign_id WHERE c.study_id = ?', studyId)).toBe(invited + need);
    // the originals keep their terminal status (no 'replaced' rewrite) and point at their replacement; started / completed never move backwards
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE replaced_by_id IS NOT NULL")).toBe(need);
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE status = 'replaced'")).toBe(0);
    expect(t.graph.all<{ id: number; status: string }>(`SELECT id, status FROM opportunity WHERE id IN (${statusesBefore.map(() => '?').join(',')}) ORDER BY id`, ...statusesBefore.map((r) => r.id))).toEqual(statusesBefore);
    expect(rc.counters).toMatchObject({ started: rootBefore.started, completed: rootBefore.completed, accepted: rootBefore.accepted, qualityAccepted: rootBefore.qualityAccepted });
    expect(rc.counters.invited).toBeGreaterThan(rootBefore.invited);
    await bpost(`/studies/${studyId}/recontact`).expect(409);
    expect(((await bget(`/studies/${studyId}`)).body as StudyDetail).replacementNote).toBe('No replacements needed');
  });

  it('a new concept can be requested (dynamic dimension) and shows up in the ontology and in P2', async () => {
    const r = (await bpost(`/studies/${studyId}/variables`, { concept: { name: 'Sleep apnea screen', parentSlug: 'physiology.sleep', method: 'survey', unit: 'score' }, protocol: { method: 'survey', durationDays: 1 }, minProvRank: 3, targetN: 20, compCents: 2500 }).expect(201)).body as VariableRequestResult;
    expect(r.isNewConcept).toBe(true);
    expect(r.conceptSlug).toBe('physiology.sleep.sleep_apnea_screen');
    expect(r.offered).toBeGreaterThan(0);
    const sig = (await pget('/signature')).body as ParticipantSignature;
    const leaf = sig.domains.flatMap((d) => d.children.flatMap((g) => g.children)).find((l) => l.slug === r.conceptSlug);
    expect(leaf).toBeTruthy();
    expect(leaf!.overlay.demand).toBe(true);
    expect(((await bget('/ontology')).body as { conceptCount: number }).conceptCount).toBe(103);
    await bpost(`/studies/${studyId}/variables`, { concept: 'nope.nope', protocol: { method: 'survey', durationDays: 1 }, minProvRank: 3, targetN: 20 }).expect(404);
    await bpost(`/studies/${studyId}/variables`, { concept: { name: 'x', parentSlug: 'nope' }, protocol: { method: 'survey', durationDays: 1 }, minProvRank: 3, targetN: 20 }).expect(400);
  });

  it('POST /demo/reset reseeds in-process and leaves the server usable', async () => {
    const r = (await request(app).post('/api/demo/reset').send({ scale: 0.05 }).expect(200)).body as DemoResetResult;
    expect(r.seeded).toBe(true);
    expect(r.participants).toBe(t.report.participants);
    const home = (await pget('/home').expect(200)).body as ParticipantHome;
    expect(home.completeness).toEqual({ pct: 74, deltaMonth: 6 });
    expect(home.opportunities.count).toBe(4);
    expect(((await bget('/studies').expect(200)).body as StudyList).studies.find((s) => s.name === 'Metabolic Monitoring Study')!.counters.qualityAccepted).toBe(qualityBefore);
    await request(app).post('/api/demo/reset').send({ scale: 7 }).expect(400);
  });
});
