// Alex's marketplace state: buyer orgs, studies/campaigns, the four available opportunities, one in-progress and five
// past enrollments, seven licenses #1836–#1842 and five contribution payments (net total exactly $2,842.17).
// The bulk BioPharma campaign membership (4,850 invited …) is seeded by marketplace.ts (loop stage).
import { addMonths, nowIso } from '@shared/clock';
import { DEFAULT_CRITERIA, type CohortCriteria } from '@shared/criteria';
import type { CampaignVariable } from '@shared/requirement';
import { insert } from '../db/migrate';
import { fromNet, postLedger } from '../services/ledger';
import { criteriaHash } from '../services/cohort-hash';
import { type SeedCtx, concept } from './context';
import type { AlexWriter, AlexSources } from './alex';

export type SeedVariable = CampaignVariable & { label: string };

const v = (conceptSlug: string, mode: CampaignVariable['mode'], label: string, compCents: number, req: CampaignVariable['requirement'], deviceCostCents = 0): SeedVariable =>
  ({ conceptSlug, mode, label, compCents, deviceCostCents, requirement: req });
const hist = (minSpanDays: number, minProvRank: number) => ({ historical: { minSpanDays, minProvRank } });
const proto = (method: 'device' | 'protocol' | 'survey' | 'photo' | 'upload' | 'kit', durationDays: number, minProvRank: number, extra: { trials?: number; device?: string } = {}) =>
  ({ protocol: { method, durationDays, minProvRank, ...extra } });

export const ORGS = [
  { key: 'biopharma', name: 'Example BioPharma', type: 'pharma', uses: ['drug_development', 'clinical_research'] },
  { key: 'pharma', name: 'Example Pharma', type: 'pharma', uses: ['clinical_research', 'outcomes_research'] },
  { key: 'academic', name: 'Academic Research', type: 'academic', uses: ['academic_research'] },
  { key: 'adtarget', name: 'AdTarget Inc', type: 'advertising', uses: ['advertising', 'audience_targeting'] },
];

export const GLUCOSE_CRITERIA: CohortCriteria = {
  purpose: 'Glucose response to diet in type 2 diabetes',
  demographics: { ageMin: 35, ageMax: 70, sex: 'any', country: 'US' },
  conditions: ['clinical.diagnoses.type_2_diabetes'],
  labs: [],
  modalities: [{ slug: 'behavior.nutrition.food_log', minSpanDays: 14, minProvRank: 2 }],
  requireRecontact: true,
};
const CV_CRITERIA: CohortCriteria = {
  purpose: 'Cardiovascular ageing over 12 months',
  demographics: { ageMin: 40, ageMax: 75, sex: 'any', country: 'US' },
  conditions: ['clinical.diagnoses.hypertension'],
  labs: [],
  modalities: [{ slug: 'physiology.cardiovascular.heart_rate', minSpanDays: 90, minProvRank: 3 }],
  requireRecontact: true,
};
const ADHERENCE_CRITERIA: CohortCriteria = {
  purpose: 'Adherence patterns in antihypertensive therapy',
  demographics: { ageMin: 30, ageMax: 80, sex: 'any', country: 'US' },
  conditions: ['clinical.diagnoses.hypertension'],
  labs: [],
  modalities: [{ slug: 'clinical.medications.medication_list', minSpanDays: 0, minProvRank: 4 }],
  requireRecontact: true,
};

type StudySpec = {
  key: string; org: string; name: string; purpose: string; useTags: string[]; termMonths: number; targetN: number;
  criteria: CohortCriteria | null; cohortName?: string; studyStatus: string; campaignStatus: string; launchedAt: string | null; variables: SeedVariable[];
};

const STUDIES: StudySpec[] = [
  {
    key: 'metabolic', org: 'biopharma', name: 'Metabolic Monitoring Study', purpose: 'Study metabolic treatment response', useTags: ['drug_development', 'clinical_research'],
    termMonths: 12, targetN: 2500, criteria: DEFAULT_CRITERIA, cohortName: 'Type 2 diabetes + hypertension', studyStatus: 'active', campaignStatus: 'active', launchedAt: '2026-02-10',
    variables: [
      v('clinical.encounters.ehr_history', 'reuse', 'EHR history', 0, hist(365 * 3, 4)),
      // exome / medications are reused when present (no historical requirement → not a recruitment pre-filter)
      v('biology.genomics.exome', 'reuse', 'Exome', 0, {}),
      v('clinical.medications.medication_list', 'reuse', 'Medications', 0, {}),
      v('physiology.cardiovascular.blood_pressure', 'collect_all', '14 days continuous BP', 12000, { ...hist(365, 3), ...proto('device', 14, 3, { device: 'Omron BP7450' }) }, 2600),
      v('behavior.nutrition.food_log', 'collect_all', '7-day food diary', 8000, { ...hist(30, 2), ...proto('photo', 7, 2) }),
      v('outcomes.patient_reported.symptom_survey', 'collect_all', 'Short weekly survey', 4000, proto('survey', 7, 3)),
    ],
  },
  {
    key: 'glucose', org: 'pharma', name: 'Glucose Response Cohort', purpose: 'Understand glucose response to diet', useTags: ['clinical_research'],
    termMonths: 12, targetN: 1200, criteria: GLUCOSE_CRITERIA, cohortName: 'Type 2 diabetes, US 35–70', studyStatus: 'active', campaignStatus: 'active', launchedAt: '2026-03-02',
    variables: [
      v('physiology.metabolic.cgm', 'collect_all', 'CGM for 14 days', 30000, proto('device', 14, 3, { device: 'Dexcom G7' }), 9500),
      v('behavior.nutrition.food_log', 'collect_all', 'Meal photographs', 10000, { ...hist(14, 2), ...proto('photo', 14, 2) }),
      v('physiology.mobility.steps', 'reuse', 'Activity tracking', 7500, hist(30, 3)),
    ],
  },
  {
    key: 'cardio', org: 'academic', name: 'Longitudinal Cardiovascular Study', purpose: 'Cardiovascular ageing over 12 months', useTags: ['academic_research'],
    termMonths: 24, targetN: 800, criteria: CV_CRITERIA, cohortName: 'Hypertension, US 40–75', studyStatus: 'active', campaignStatus: 'active', launchedAt: '2026-06-01',
    variables: [
      v('physiology.cardiovascular.blood_pressure', 'collect_all', 'Monthly BP (12 months)', 30000, { ...hist(365, 3), ...proto('device', 12, 3) }),
      v('physiology.cardiovascular.heart_rate', 'reuse', 'Wearable data', 15000, hist(90, 3)),
      v('outcomes.patient_reported.symptom_survey', 'collect_all', 'Quarterly survey', 15000, proto('survey', 4, 3)),
      v('clinical.labs.lipid_panel', 'collect_all', 'Two blood draws', 20000, proto('kit', 2, 4)),
      v('physiology.strength.grip_strength', 'collect_all', 'Grip strength (dynamometer)', 30000, proto('protocol', 1, 3, { trials: 3, device: 'dynamometer' }), 4500),
    ],
  },
  {
    key: 'adherence', org: 'pharma', name: 'Medication Adherence Survey', purpose: 'Adherence patterns in antihypertensive therapy', useTags: ['outcomes_research'],
    termMonths: 6, targetN: 5000, criteria: ADHERENCE_CRITERIA, cohortName: 'Hypertension, US adults', studyStatus: 'active', campaignStatus: 'active', launchedAt: '2026-09-20',
    variables: [
      v('clinical.medications.adherence', 'collect_all', 'Health questionnaire', 4000, proto('survey', 1, 3)),
      v('clinical.medications.medication_list', 'reuse', 'Medication list', 0, hist(0, 4)),
    ],
  },
  // ---- past (completed) studies ----
  { key: 'registry', org: 'pharma', name: 'Cardiometabolic Registry', purpose: 'Real-world cardiometabolic registry', useTags: ['outcomes_research'], termMonths: 12, targetN: 3000, criteria: null, studyStatus: 'completed', campaignStatus: 'closed', launchedAt: '2024-10-20',
    variables: [v('clinical.encounters.ehr_history', 'reuse', 'EHR history', 0, hist(365, 4)), v('clinical.labs.hba1c', 'reuse', 'Labs', 0, hist(0, 4)), v('clinical.medications.medication_list', 'reuse', 'Medications', 0, hist(0, 4)), v('outcomes.patient_reported.symptom_survey', 'collect_all', 'Registry survey', 4000, proto('survey', 1, 3))] },
  { key: 'sleepmeta', org: 'academic', name: 'Sleep & Metabolic Health', purpose: 'Sleep architecture and metabolic markers', useTags: ['academic_research'], termMonths: 24, targetN: 600, criteria: null, studyStatus: 'completed', campaignStatus: 'closed', launchedAt: '2025-02-01',
    variables: [v('physiology.sleep.sleep_duration', 'reuse', 'Sleep data', 0, hist(90, 3)), v('physiology.cardiovascular.heart_rate', 'reuse', 'Heart rate', 0, hist(90, 3)), v('physiology.metabolic.weight', 'reuse', 'Weight', 0, hist(90, 3)), v('physiology.sleep.sleep_duration', 'collect_all', '14-night sleep diary', 25000, proto('protocol', 14, 3))] },
  { key: 'htnout', org: 'biopharma', name: 'Hypertension Outcomes', purpose: 'Blood-pressure control and outcomes', useTags: ['clinical_research'], termMonths: 6, targetN: 2000, criteria: null, studyStatus: 'completed', campaignStatus: 'closed', launchedAt: '2025-05-20',
    variables: [v('clinical.encounters.ehr_history', 'reuse', 'EHR history', 0, hist(365, 4)), v('clinical.medications.medication_list', 'reuse', 'Medications', 0, hist(0, 4)), v('clinical.vitals.clinic_blood_pressure', 'reuse', 'Clinic BP', 0, hist(0, 4)), v('outcomes.patient_reported.symptom_survey', 'collect_all', 'Symptom survey', 8500, proto('survey', 1, 3))] },
  { key: 'bpvar', org: 'pharma', name: 'Blood Pressure Variability', purpose: 'Home BP variability in treated hypertension', useTags: ['clinical_research'], termMonths: 12, targetN: 900, criteria: null, studyStatus: 'completed', campaignStatus: 'closed', launchedAt: '2025-10-01',
    variables: [v('physiology.cardiovascular.blood_pressure', 'reuse', 'Home BP', 0, hist(30, 3)), v('physiology.cardiovascular.heart_rate', 'reuse', 'Heart rate', 0, hist(90, 3)), v('physiology.cardiovascular.hrv', 'reuse', 'HRV', 0, hist(90, 3)), v('physiology.metabolic.weight', 'reuse', 'Weight', 0, hist(90, 3)), v('physiology.cardiovascular.blood_pressure', 'collect_all', '14-day BP protocol (4 readings/day)', 32000, proto('device', 14, 3, { device: 'Omron BP7450' }))] },
  { key: 'aging', org: 'academic', name: 'Digital Biomarkers of Aging', purpose: 'Wearable-derived biomarkers of ageing', useTags: ['academic_research'], termMonths: 18, targetN: 1500, criteria: null, studyStatus: 'completed', campaignStatus: 'closed', launchedAt: '2026-01-05',
    variables: [v('physiology.cardiovascular.blood_pressure', 'reuse', 'Home BP', 0, hist(90, 3)), v('physiology.cardiovascular.hrv', 'reuse', 'HRV', 0, hist(90, 3)), v('physiology.sleep.sleep_duration', 'reuse', 'Sleep', 0, hist(90, 3)), v('physiology.mobility.steps', 'reuse', 'Steps', 0, hist(90, 3)), v('physiology.cardiovascular.heart_rate', 'reuse', 'Heart rate', 0, hist(90, 3)), v('outcomes.patient_reported.quality_of_life', 'collect_all', 'Quality-of-life questionnaire', 24367, proto('survey', 1, 3))] },
  // ---- in progress ----
  { key: 'wearsleep', org: 'academic', name: 'Wearable Sleep Study', purpose: 'Sleep, stress and blood pressure in midlife', useTags: ['academic_research'], termMonths: 12, targetN: 400, criteria: null, studyStatus: 'active', campaignStatus: 'active', launchedAt: '2026-06-25',
    variables: [v('physiology.sleep.sleep_duration', 'reuse', 'Sleep data', 0, hist(90, 3)), v('physiology.sleep.sleep_stages', 'reuse', 'Sleep stages', 0, hist(90, 3)), v('physiology.cardiovascular.blood_pressure', 'reuse', 'Home BP', 0, hist(90, 3)), v('physiology.sleep.sleep_duration', 'collect_all', '14-night sleep diary', 6000, proto('protocol', 14, 3)), v('behavior.stress.stress_survey', 'collect_all', 'Quarterly stress & quality-of-life questionnaires', 3000, proto('survey', 1, 3))] },
  // ---- reuse-only license (no opportunity; pre-authorised reuse) ----
  { key: 'lipid', org: 'pharma', name: 'Longitudinal Lipid Study', purpose: 'Lipid trajectories in treated dyslipidaemia', useTags: ['outcomes_research'], termMonths: 12, targetN: 2500, criteria: null, studyStatus: 'active', campaignStatus: 'closed', launchedAt: '2026-10-15',
    variables: [v('clinical.labs.lipid_panel', 'reuse', 'Lipid panel', 2500, hist(365, 4)), v('clinical.labs.hba1c', 'reuse', 'HbA1c', 1700, hist(365, 4))] },
];

export function seedAlexMarketplace(ctx: SeedCtx, w: AlexWriter, S: AlexSources): void {
  const db = ctx.graph;
  const now = nowIso();
  const pid = w.pid;

  db.tx(() => {
    for (const o of ORGS) ctx.orgs[o.key] = insert(db, 'buyer_org', { name: o.name, type: o.type, declared_uses_json: JSON.stringify(o.uses), created_at: now });

    for (const s of STUDIES) {
      let cohortId: number | null = null;
      if (s.criteria) {
        cohortId = insert(db, 'cohort_definition', { buyer_org_id: ctx.orgs[s.org], name: s.cohortName ?? s.name, criteria_json: JSON.stringify(s.criteria), criteria_hash: criteriaHash(s.criteria), created_at: s.launchedAt ? `${s.launchedAt}T09:00:00Z` : now });
      }
      const studyId = insert(db, 'study', {
        buyer_org_id: ctx.orgs[s.org], cohort_definition_id: cohortId, name: s.name, purpose: s.purpose, use_tags_json: JSON.stringify(s.useTags),
        license_term_months: s.termMonths, target_n: s.targetN, salt: `salt-${s.key}-${ctx.rng.fork(`salt:${s.key}`).int(1e6, 9e6)}`, status: s.studyStatus,
        updated_at: now, created_at: s.launchedAt ? `${s.launchedAt}T09:00:00Z` : now,
      });
      ctx.studies[s.key] = studyId;
      ctx.campaigns[s.key] = insert(db, 'campaign', {
        study_id: studyId, parent_campaign_id: null, name: s.name, status: s.campaignStatus, target_complete_n: s.targetN, eligible_n: 0,
        variables_json: JSON.stringify(s.variables), estimate_json: null, launched_at: s.launchedAt, closed_at: s.campaignStatus === 'closed' ? addMonths(s.launchedAt!, 3) : null,
        created_at: s.launchedAt ? `${s.launchedAt}T09:00:00Z` : now,
      });
    }
  });

  const spec = (key: string) => STUDIES.find((s) => s.key === key)!;
  const collectSlugs = (s: StudySpec) => s.variables.filter((x) => x.mode !== 'reuse').map((x) => x.conceptSlug);
  const scopeSlugs = (s: StudySpec) => Array.from(new Set(s.variables.map((x) => x.conceptSlug)));
  const totalComp = (s: StudySpec) => s.variables.reduce((a, x) => a + x.compCents, 0);

  // ---- four available opportunities (offered, untouched) ----
  db.tx(() => {
    const offer = (key: string, offeredAt: string) => insert(db, 'opportunity', {
      campaign_id: ctx.campaigns[key], participant_id: pid, status: 'offered', missing_concepts_json: JSON.stringify(collectSlugs(spec(key))),
      comp_max_cents: totalComp(spec(key)), offered_at: offeredAt, created_at: offeredAt,
    });
    offer('metabolic', '2026-02-12T09:00:00Z');
    offer('glucose', '2026-03-04T09:00:00Z');
    offer('cardio', '2026-06-03T09:00:00Z');
    offer('adherence', '2026-09-22T09:00:00Z');
  });

  // ---- past enrollments: opportunity → consent → enrollment → license (+ lines, ledger) → contribution (+ ledger) ----
  type Past = { key: string; offered: string; accepted: string; completed: string; licenseNo: number; licenseNet: number; lines: [string, number][]; contribution: { slug: string; method: string; days: number; net: number } };
  const past: Past[] = [
    { key: 'registry', offered: '2024-10-28', accepted: '2024-11-12', completed: '2024-12-02', licenseNo: 1836, licenseNet: 38500,
      lines: [['clinical.encounters.ehr_history', 18000], ['clinical.labs.hba1c', 10000], ['clinical.labs.lipid_panel', 6000], ['clinical.medications.medication_list', 4500]],
      contribution: { slug: 'outcomes.patient_reported.symptom_survey', method: 'survey', days: 1, net: 4000 } },
    { key: 'sleepmeta', offered: '2025-02-06', accepted: '2025-02-20', completed: '2025-03-18', licenseNo: 1837, licenseNet: 41000,
      lines: [['physiology.sleep.sleep_duration', 18000], ['physiology.sleep.sleep_stages', 10000], ['physiology.cardiovascular.heart_rate', 8000], ['physiology.metabolic.weight', 5000]],
      contribution: { slug: 'physiology.sleep.sleep_duration', method: 'protocol', days: 14, net: 25000 } },
    { key: 'htnout', offered: '2025-05-22', accepted: '2025-06-05', completed: '2025-07-22', licenseNo: 1838, licenseNet: 19600,
      lines: [['clinical.encounters.ehr_history', 9600], ['clinical.medications.medication_list', 6000], ['clinical.vitals.clinic_blood_pressure', 4000]],
      contribution: { slug: 'outcomes.patient_reported.symptom_survey', method: 'survey', days: 1, net: 8500 } },
    { key: 'bpvar', offered: '2025-10-02', accepted: '2025-10-15', completed: '2025-12-09', licenseNo: 1839, licenseNet: 28850,
      lines: [['physiology.cardiovascular.blood_pressure', 1400], ['physiology.cardiovascular.heart_rate', 10450], ['physiology.metabolic.weight', 4000], ['physiology.cardiovascular.hrv', 13000]],
      contribution: { slug: 'physiology.cardiovascular.blood_pressure', method: 'device', days: 14, net: 32000 } },
    { key: 'aging', offered: '2026-01-08', accepted: '2026-01-20', completed: '2026-03-30', licenseNo: 1840, licenseNet: 46400,
      lines: [['physiology.cardiovascular.blood_pressure', 6400], ['physiology.cardiovascular.hrv', 12000], ['physiology.sleep.sleep_duration', 10000], ['physiology.mobility.steps', 8000], ['physiology.cardiovascular.heart_rate', 10000]],
      contribution: { slug: 'outcomes.patient_reported.quality_of_life', method: 'survey', days: 1, net: 24367 } },
  ];

  const mintLicense = (key: string, no: number, net: number, termStart: string, lines: [string, number][], grantId: number | null, enrollmentId: number | null, purpose: string) => {
    const s = spec(key);
    const lineSum = lines.reduce((a, [, c]) => a + c, 0);
    if (lineSum !== net) throw new Error(`license ${no}: lines ${lineSum} != net ${net}`);
    const termEnd = addMonths(termStart, s.termMonths);
    const { gross, participant, platform } = fromNet(net);
    const licenseId = insert(db, 'license', {
      number: no, study_id: ctx.studies[key], buyer_org_id: ctx.orgs[s.org], participant_id: pid, consent_grant_id: grantId, enrollment_id: enrollmentId,
      scope_concepts_json: JSON.stringify(lines.map(([slug]) => slug)), purpose, term_start: termStart, term_end: termEnd,
      gross_cents: gross, participant_cents: participant, platform_cents: platform, revoked_at: null, created_at: `${termStart}T10:00:00Z`,
    });
    for (const [slug, cents] of lines) insert(db, 'license_line', { license_id: licenseId, concept_id: concept(ctx, slug), cents, created_at: `${termStart}T10:00:00Z` });
    postLedger(db, { participantId: pid, kind: 'license_fee', netCents: net, occurredAt: `${termStart}T10:00:00Z`, studyId: ctx.studies[key], licenseId, memo: `Research License #${no} — ${s.name}` });
    w.event(termStart, 'license', 'research', `Research License #${no}`, `${s.name} (${ORGS.find((o) => o.key === s.org)!.name})`, null);
    return licenseId;
  };

  db.tx(() => {
    for (const p of past) {
      const s = spec(p.key);
      const oppId = insert(db, 'opportunity', {
        campaign_id: ctx.campaigns[p.key], participant_id: pid, status: 'paid', missing_concepts_json: JSON.stringify(collectSlugs(s)), comp_max_cents: p.licenseNet + p.contribution.net,
        offered_at: `${p.offered}T09:00:00Z`, viewed_at: `${p.offered}T18:00:00Z`, reviewed_at: `${p.accepted}T09:30:00Z`, responded_at: `${p.accepted}T09:45:00Z`, completed_at: `${p.completed}T12:00:00Z`, created_at: `${p.offered}T09:00:00Z`,
      });
      const grantId = insert(db, 'consent_grant', {
        participant_id: pid, study_id: ctx.studies[p.key], opportunity_id: oppId, scope_concepts_json: JSON.stringify(scopeSlugs(s)), withheld_json: '["identity"]', purpose: s.purpose,
        term_months: s.termMonths, reuse_allowed: 0, recontact_via_platform: 1, granted_at: `${p.accepted}T09:45:00Z`, revoked_at: null, created_at: `${p.accepted}T09:45:00Z`,
      });
      const enrollmentId = insert(db, 'enrollment', {
        participant_id: pid, study_id: ctx.studies[p.key], campaign_id: ctx.campaigns[p.key], opportunity_id: oppId, consent_grant_id: grantId, status: 'completed',
        enrolled_at: `${p.accepted}T09:45:00Z`, completed_at: `${p.completed}T12:00:00Z`, withdrawn_at: null, created_at: `${p.accepted}T09:45:00Z`,
      });
      mintLicense(p.key, p.licenseNo, p.licenseNet, p.accepted, p.lines, grantId, enrollmentId, s.purpose);
      const contributionId = insert(db, 'contribution', {
        opportunity_id: oppId, participant_id: pid, concept_id: concept(ctx, p.contribution.slug), status: 'verified', method: p.contribution.method, duration_days: p.contribution.days,
        comp_cents: p.contribution.net, artifact_id: null, observation_count: p.contribution.method === 'survey' ? 1 : p.contribution.days * (p.contribution.method === 'device' ? 4 : 1),
        submitted_at: `${p.completed}T11:00:00Z`, verified_at: `${p.completed}T12:00:00Z`, created_at: `${p.accepted}T09:45:00Z`,
      });
      postLedger(db, { participantId: pid, kind: 'contribution_payment', netCents: p.contribution.net, occurredAt: `${p.completed}T12:00:00Z`, studyId: ctx.studies[p.key], contributionId, memo: `${s.name} — ${s.variables.find((x) => x.conceptSlug === p.contribution.slug && x.mode !== 'reuse')?.label ?? 'contribution'}` });
      w.event(p.completed, 'contribution', 'research', `Completed: ${s.name}`, `Verified contribution paid`, p.contribution.slug);
      // protocol-grade observations produced by past contributions
      if (p.key === 'bpvar') db.run('UPDATE observation SET contribution_id = ? WHERE participant_id = ? AND contribution_id = -1', contributionId, pid);
      if (p.key === 'sleepmeta') db.run("UPDATE observation SET contribution_id = ?, provenance_class = 'protocol_measurement', method = 'protocol' WHERE participant_id = ? AND concept_id = ? AND observed_at >= '2025-03-01' AND observed_at < '2025-03-15'", contributionId, pid, concept(ctx, 'physiology.sleep.sleep_duration'));
      if (p.key === 'aging') w.obs({ slug: 'outcomes.patient_reported.quality_of_life', at: '2026-02-15', num: 72, json: { instrument: 'SF-12', physical: 48, mental: 51 }, source: S.surveys, method: 'survey', prov: 'protocol_measurement', contribution: contributionId });
      if (p.key === 'registry') w.obs({ slug: 'outcomes.patient_reported.symptom_survey', at: '2024-12-02', num: 2, json: { instrument: 'registry', score: 2 }, source: S.surveys, method: 'survey', prov: 'protocol_measurement', contribution: contributionId });
      if (p.key === 'htnout') w.obs({ slug: 'outcomes.patient_reported.symptom_survey', at: '2025-07-22', num: 3, json: { instrument: 'symptoms', score: 3 }, source: S.surveys, method: 'survey', prov: 'protocol_measurement', contribution: contributionId });
    }
  });

  // ---- in-progress: Wearable Sleep Study (license #1841 minted at accept; diary pending, questionnaires submitted) ----
  db.tx(() => {
    const s = spec('wearsleep');
    const oppId = insert(db, 'opportunity', {
      campaign_id: ctx.campaigns.wearsleep, participant_id: pid, status: 'in_progress', missing_concepts_json: JSON.stringify(collectSlugs(s)), comp_max_cents: 11800 + 9000,
      offered_at: '2026-07-01T09:00:00Z', viewed_at: '2026-07-01T19:00:00Z', reviewed_at: '2026-07-08T08:30:00Z', responded_at: '2026-07-08T08:40:00Z', completed_at: null, created_at: '2026-07-01T09:00:00Z',
    });
    const grantId = insert(db, 'consent_grant', {
      participant_id: pid, study_id: ctx.studies.wearsleep, opportunity_id: oppId, scope_concepts_json: JSON.stringify(scopeSlugs(s)), withheld_json: '["identity"]', purpose: s.purpose,
      term_months: s.termMonths, reuse_allowed: 0, recontact_via_platform: 1, granted_at: '2026-07-08T08:40:00Z', revoked_at: null, created_at: '2026-07-08T08:40:00Z',
    });
    const enrollmentId = insert(db, 'enrollment', {
      participant_id: pid, study_id: ctx.studies.wearsleep, campaign_id: ctx.campaigns.wearsleep, opportunity_id: oppId, consent_grant_id: grantId, status: 'active',
      enrolled_at: '2026-07-08T08:40:00Z', completed_at: null, withdrawn_at: null, created_at: '2026-07-08T08:40:00Z',
    });
    mintLicense('wearsleep', 1841, 11800, '2026-07-08', [['physiology.sleep.sleep_duration', 5000], ['physiology.sleep.sleep_stages', 2800], ['physiology.cardiovascular.blood_pressure', 4000]], grantId, enrollmentId, s.purpose);
    insert(db, 'contribution', { opportunity_id: oppId, participant_id: pid, concept_id: concept(ctx, 'physiology.sleep.sleep_duration'), status: 'pending', method: 'protocol', duration_days: 14, comp_cents: 6000, artifact_id: null, observation_count: 0, submitted_at: null, verified_at: null, created_at: '2026-07-08T08:40:00Z' });
    const q = insert(db, 'contribution', { opportunity_id: oppId, participant_id: pid, concept_id: concept(ctx, 'behavior.stress.stress_survey'), status: 'submitted', method: 'survey', duration_days: 1, comp_cents: 3000, artifact_id: null, observation_count: 6, submitted_at: '2026-10-10T18:00:00Z', verified_at: null, created_at: '2026-07-08T08:40:00Z' });
    // questionnaires completed under the study protocol (rank 3)
    w.obs({ slug: 'behavior.stress.stress_survey', at: '2026-10-10', num: 14, json: { instrument: 'PSS-10', score: 14 }, source: S.surveys, method: 'survey', prov: 'protocol_measurement', contribution: q });
    w.obs({ slug: 'outcomes.patient_reported.quality_of_life', at: '2026-10-10', num: 76, json: { instrument: 'SF-12', physical: 50, mental: 53 }, source: S.surveys, method: 'survey', prov: 'protocol_measurement', contribution: q });
    for (const d of ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-10']) {
      w.obs({ slug: 'outcomes.patient_reported.symptom_survey', at: d, num: d === '2026-10-10' ? 1 : 2, json: { instrument: 'symptoms', score: d === '2026-10-10' ? 1 : 2 }, source: S.surveys, method: 'survey', prov: 'protocol_measurement', contribution: d === '2026-10-10' ? q : null });
    }
    w.event('2026-07-08', 'enrollment', 'research', 'Enrolled: Wearable Sleep Study', 'Academic Research · 12-month license · sleep diary pending', 'physiology.sleep.sleep_duration');
  });

  // ---- reuse-only license #1842 (pre-authorised reuse; no opportunity) ----
  db.tx(() => {
    const s = spec('lipid');
    const grantId = insert(db, 'consent_grant', {
      participant_id: pid, study_id: ctx.studies.lipid, opportunity_id: null, scope_concepts_json: JSON.stringify(scopeSlugs(s)), withheld_json: '["identity"]', purpose: s.purpose,
      term_months: s.termMonths, reuse_allowed: 0, recontact_via_platform: 1, granted_at: '2026-10-21T10:00:00Z', revoked_at: null, created_at: '2026-10-21T10:00:00Z',
    });
    mintLicense('lipid', 1842, 4200, '2026-10-21', [['clinical.labs.lipid_panel', 2500], ['clinical.labs.hba1c', 1700]], grantId, null, s.purpose);
  });

  // ---- buyer-side activity ----
  db.tx(() => {
    const act = (org: string, at: string, kind: string, text: string) => insert(db, 'activity', { participant_id: null, buyer_org_id: ctx.orgs[org], kind, text, amount_cents: null, occurred_at: at, created_at: now });
    act('biopharma', '2026-10-24T07:00:00Z', 'cohort_updated', 'Type 2 diabetes cohort updated');
    act('biopharma', '2026-10-23T08:00:00Z', 'campaign', 'Nutrition collection campaign — 7 new completions');
    act('biopharma', '2026-10-22T09:00:00Z', 'dataset', 'New dataset version available');
    act('pharma', '2026-10-21T10:00:00Z', 'license', 'Longitudinal Lipid Study: 1 new reuse license');
    act('pharma', '2026-10-19T10:00:00Z', 'campaign', 'Glucose Response Cohort recruiting');
    act('academic', '2026-10-10T18:00:00Z', 'campaign', 'Wearable Sleep Study: quarterly questionnaires received');
    act('adtarget', '2026-10-20T10:00:00Z', 'blocked', 'Cohort request blocked by participant red-lines');
  });
}

