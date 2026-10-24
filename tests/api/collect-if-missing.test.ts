// `collect_if_missing` semantics (B6 hint: "collect only from participants who lack it; reuse — and pay the fee — for the
// rest"): a variable a member ALREADY holds is licensed (reuse fee in comp_max, a license_line at accept, listed under
// "uses your …") and counted as present on the buyer side (B7 coverage, B8 dataset n / missingness). `collect_all`
// keeps re-measuring everyone (verified contributions only).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import { DEFAULT_CRITERIA } from '../../shared/criteria';
import { DEFAULT_CAMPAIGN_VARIABLES } from '../../shared/ontology';
import { PERSONA_HEADER } from '../../shared/api-types';
import type { AcceptResult, Campaign, Dataset, OpportunityCard, OpportunityDetail, ParticipantLedger, ParticipantOpportunities, SavedCohortDetail, StudyDetail, Workspace } from '../../shared/api-types';
import { buildDataset } from '../../server/services/dataset';
import { reuseScope, offerComp } from '../../server/services/consent';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

const EHR = 'clinical.encounters.ehr_history';
const EXOME = 'biology.genomics.exome';
const BP = 'physiology.cardiovascular.blood_pressure';
const FOOD = 'behavior.nutrition.food_log';
const FEES = { [EHR]: 1200, [EXOME]: 2000, [BP]: 1400, [FOOD]: 825 }; // reuse fees from the ontology (food log: 15 % of 5,500)
const REUSE_ONLY_FEE = FEES[EHR] + FEES[EXOME] + FEES[BP] + FEES[FOOD];

describe('collect_if_missing: held variables are licensed and counted (scale 0.05)', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  let pid: number;
  const buyer = { [PERSONA_HEADER]: 'buyer:1' };
  beforeAll(() => { t = seededDbs(); app = createApp(); pid = alexId(t.graph); });
  const pget = (url: string) => request(app).get(`/api/participant${url}`);
  const ppost = (url: string, body: unknown = {}) => request(app).post(`/api/participant${url}`).send(body as object);
  const bget = (url: string) => request(app).get(`/api/buyer${url}`).set(buyer);
  const bpost = (url: string, body: unknown = {}) => request(app).post(`/api/buyer${url}`).set(buyer).send(body as object);
  const n = (sql: string, ...p: (number | string)[]) => t.graph.get<{ n: number }>(sql, ...p)!.n;

  it('reuseScope / offerComp: reuse vars ∪ held collect_if_missing vars; collect_all is never licensed', () => {
    const vars = DEFAULT_CAMPAIGN_VARIABLES; // EHR reuse; exome / BP / food log collect_if_missing
    expect(reuseScope(vars, [], t.graph).map((s) => [s.conceptSlug, s.cents])).toEqual([[EHR, 1200], [EXOME, 2000], [BP, 1400], [FOOD, 825]]);
    expect(reuseScope(vars, [BP], t.graph).map((s) => s.conceptSlug)).toEqual([EHR, EXOME, FOOD]);
    expect(offerComp(vars, [], t.graph)).toBe(REUSE_ONLY_FEE);
    expect(offerComp(vars, [BP], t.graph)).toBe(11000 + FEES[EHR] + FEES[EXOME] + FEES[FOOD]); // collect BP, license the rest
    expect(offerComp(vars, [EXOME, BP, FOOD], t.graph)).toBe(5000 + 11000 + 5500 + FEES[EHR]); // nothing held: collection comps + EHR fee
    const collectAll = vars.map((v) => (v.mode === 'reuse' ? v : { ...v, mode: 'collect_all' as const }));
    expect(reuseScope(collectAll, [], t.graph).map((s) => s.conceptSlug)).toEqual([EHR]);
    expect(offerComp(collectAll, [EXOME, BP, FOOD], t.graph)).toBe(5000 + 11000 + 5500 + FEES[EHR]);
  });

  it('ready-now member accepted under collect_if_missing → license lines include the held variables, B7 coverage 100 %, dataset n counts the member', async () => {
    const cohort = (await bpost('/cohorts', { name: 'CIM cohort', criteria: DEFAULT_CRITERIA }).expect(201)).body as SavedCohortDetail;
    const draft = (await bpost('/campaigns', { cohortId: cohort.id, name: 'CIM campaign', purpose: 'collect_if_missing semantics', targetN: 30, variables: DEFAULT_CAMPAIGN_VARIABLES }).expect(201)).body as Campaign;
    await bpost(`/campaigns/${draft.id}/request-proposal`).expect(200);
    const launched = (await bpost(`/campaigns/${draft.id}/launch`).expect(200)).body as Campaign;
    expect(launched.estimate.reuseOnlyOffered).toBeGreaterThan(1);

    // every reuse-only offer carries the full fee; a collection offer prices the missing variables as comp and the held ones as fees
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE campaign_id = ? AND missing_concepts_json = '[]' AND comp_max_cents <> ?", draft.id, REUSE_ONLY_FEE)).toBe(0);
    for (const o of t.graph.all<{ missing: string; comp: number }>("SELECT missing_concepts_json AS missing, comp_max_cents AS comp FROM opportunity WHERE campaign_id = ? AND missing_concepts_json <> '[]'", draft.id)) {
      expect(o.comp).toBe(offerComp(DEFAULT_CAMPAIGN_VARIABLES, JSON.parse(o.missing) as string[], t.graph));
    }
    // pre-authorised accepts at launch wrote one license_line per licensed variable (4 for a reuse-only member)
    const preLicense = t.graph.get<{ id: number }>("SELECT l.id FROM license l JOIN enrollment e ON e.id = l.enrollment_id WHERE e.campaign_id = ? AND l.participant_id <> ? LIMIT 1", draft.id, pid);
    if (preLicense) expect(n('SELECT COUNT(*) AS n FROM license_line WHERE license_id = ?', preLicense.id)).toBe(4);

    // Alex: reuse-only offer, "uses your" lists the four variables, accept → license + 4 lines + ledger row of the full fee
    const avail = (await pget('/opportunities?tab=available')).body as ParticipantOpportunities;
    const card = avail.items.find((o) => o.campaignId === draft.id) as OpportunityCard;
    expect(card).toMatchObject({ compCents: REUSE_ONLY_FEE, requirements: [], reused: ['EHR history', 'Exome', 'Blood Pressure', 'Food log'] });
    await ppost(`/opportunities/${card.id}/view`).expect(200);
    await ppost(`/opportunities/${card.id}/review`).expect(200);
    const detail = (await pget(`/opportunities/${card.id}`)).body as OpportunityDetail;
    expect(detail.consent).toMatchObject({ compCents: REUSE_ONLY_FEE, reusedCompCents: REUSE_ONLY_FEE, perTask: [] });
    const acc = (await ppost(`/opportunities/${card.id}/accept`).expect(200)).body as AcceptResult;
    expect(t.graph.get<{ c: number }>('SELECT participant_cents AS c FROM license WHERE id = ?', acc.licenseId)!.c).toBe(REUSE_ONLY_FEE);
    const lines = t.graph.all<{ slug: string; cents: number }>('SELECT k.slug, ll.cents FROM license_line ll JOIN concept k ON k.id = ll.concept_id WHERE ll.license_id = ? ORDER BY ll.id', acc.licenseId);
    expect(lines).toEqual([{ slug: EHR, cents: 1200 }, { slug: EXOME, cents: 2000 }, { slug: BP, cents: 1400 }, { slug: FOOD, cents: 825 }]);
    expect(JSON.parse(t.graph.get<{ s: string }>('SELECT scope_concepts_json AS s FROM license WHERE id = ?', acc.licenseId)!.s)).toEqual([EHR, EXOME, BP, FOOD]);
    const led = (await pget('/ledger')).body as ParticipantLedger;
    expect(led.entries[0]).toMatchObject({ kind: 'license_fee', licenseId: acc.licenseId, participantCents: REUSE_ONLY_FEE, dataIncluded: ['EHR history', 'Exome', 'Blood Pressure', 'Food log'] });

    // B7: every variable reads 100 % over the started members (all reuse-only so far: nothing was collected, everything is held)
    const study = (await bget(`/studies/${launched.studyId}`).expect(200)).body as StudyDetail;
    expect(study.coverage.map((c) => c.slug).sort()).toEqual([EHR, EXOME, BP, FOOD].sort());
    for (const c of study.coverage) {
      expect(c.pct, c.slug).toBe(100);
      expect(c.verified, c.slug).toBe(c.started);
    }
    expect(study.counters.started).toBeGreaterThan(0);

    // B8: the dataset counts the held variables as present (n = members, missing 0 %) on the variables, missingness and workspace views
    const built = buildDataset(t.graph, launched.studyId, { reason: 'test' });
    expect(built.memberCount).toBe(n("SELECT COUNT(*) AS n FROM enrollment WHERE campaign_id = ?", draft.id));
    const ds = (await bget(`/datasets/${built.id}?tab=variables`).expect(200)).body as Dataset;
    expect(ds.tab).toBe('variables');
    for (const slug of [EHR, EXOME, BP, FOOD]) {
      const v = ds.variables.find((x) => x.slug === slug)!;
      expect(v.n, slug).toBe(ds.memberCount);
      expect(v.missingPct, slug).toBe(0);
    }
    const miss = (await bget(`/datasets/${built.id}?tab=missingness`).expect(200)).body as Dataset;
    expect(miss.tab).toBe('missingness');
    for (const slug of [EXOME, BP, FOOD]) expect(miss.missingness.find((x) => x.slug === slug)!.missingPct, slug).toBe(0);
    const prov = (await bget(`/datasets/${built.id}?tab=provenance`).expect(200)).body as Dataset;
    expect(prov.provenance.find((x) => x.slug === BP)!.classes.reduce((a, c) => a + c.pct, 0)).toBeGreaterThan(99);
    const ws = (await bget(`/datasets/${built.id}/workspace`).expect(200)).body as Workspace;
    for (const slug of [EHR, EXOME, BP, FOOD]) expect(ws.variables.find((x) => x.slug === slug)!.n, slug).toBe(ds.memberCount);
    expect(ws.variables.find((x) => x.slug === BP)!.mean).toBeGreaterThan(100);
  });

  it('all-collect_if_missing campaign (no Reuse variable): ready-now members still get a reuse-only offer = Σ reuse fees', async () => {
    const cohort = (await bpost('/cohorts', { name: 'CIM-only cohort', criteria: DEFAULT_CRITERIA }).expect(201)).body as SavedCohortDetail;
    const variables = DEFAULT_CAMPAIGN_VARIABLES.map((v) => (v.mode === 'reuse' ? { ...v, mode: 'collect_if_missing' as const } : v));
    const draft = (await bpost('/campaigns', { cohortId: cohort.id, name: 'CIM-only campaign', purpose: 'no reuse variable', targetN: 30, variables }).expect(201)).body as Campaign;
    const launched = (await bpost(`/campaigns/${draft.id}/launch`).expect(200)).body as Campaign;
    expect(launched.estimate.reuseOnlyOffered).toBeGreaterThan(1);
    const alex = t.graph.get<{ missing: string; comp: number }>('SELECT missing_concepts_json AS missing, comp_max_cents AS comp FROM opportunity WHERE campaign_id = ? AND participant_id = ?', draft.id, pid)!;
    expect(JSON.parse(alex.missing)).toEqual([]);
    expect(alex.comp).toBe(REUSE_ONLY_FEE);
    expect(n("SELECT COUNT(*) AS n FROM license WHERE study_id = ?", launched.studyId)).toBe(n("SELECT COUNT(*) AS n FROM opportunity WHERE campaign_id = ? AND status = 'paid'", draft.id)); // only pre-authorised accepts hold a license
  });

  it('collect_all is unchanged: re-measure everyone, no reuse-only offers, coverage counts verified contributions only', async () => {
    const cohort = (await bpost('/cohorts', { name: 'CA cohort', criteria: DEFAULT_CRITERIA }).expect(201)).body as SavedCohortDetail;
    const variables = DEFAULT_CAMPAIGN_VARIABLES.map((v) => (v.conceptSlug === BP ? { ...v, mode: 'collect_all' as const } : v));
    const draft = (await bpost('/campaigns', { cohortId: cohort.id, name: 'CA campaign', purpose: 'collect_all semantics', targetN: 30, variables }).expect(201)).body as Campaign;
    await bpost(`/campaigns/${draft.id}/request-proposal`).expect(200);
    const launched = (await bpost(`/campaigns/${draft.id}/launch`).expect(200)).body as Campaign;
    expect(launched.estimate.reuseOnlyOffered ?? 0).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM opportunity WHERE campaign_id = ? AND missing_concepts_json = '[]'", draft.id)).toBe(0);
    // Alex holds exome + food log historically → collection offer: BP task + fees for EHR, exome, food log
    const alex = t.graph.get<{ missing: string; comp: number }>('SELECT missing_concepts_json AS missing, comp_max_cents AS comp FROM opportunity WHERE campaign_id = ? AND participant_id = ?', draft.id, pid)!;
    expect(JSON.parse(alex.missing)).toEqual([BP]);
    expect(alex.comp).toBe(11000 + FEES[EHR] + FEES[EXOME] + FEES[FOOD]);
    const study = (await bget(`/studies/${launched.studyId}`).expect(200)).body as StudyDetail;
    expect(study.coverage.find((c) => c.slug === BP)!.verified).toBe(0); // nobody has contributed yet; held BP never counts under collect_all
  });
});
