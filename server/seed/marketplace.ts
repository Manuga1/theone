// Seeded marketplace: Example BioPharma's "Metabolic Monitoring Study" campaign mid-flight. Alex's own offered
// opportunity already exists (seeded by alex-marketplace.ts) and counts as one of the invitations.
//
//   Invited 4,850 (all recontactable T6 incl. Alex + all recontactable T4/T5, remainder T3), Accepted 3,011,
//   Started 2,841 (T4/T5/T6 only, so the B3 funnel stays 611 and exome/EHR reuse read 100 %), Completed 2,421,
//   Quality accepted 2,378, 122 need replacement (43 rejected + 12 withdrawn + 37 declined after view + 30 expired).
//   Per-variable verified over started: BP 96 % / Nutrition 91 % / Exome 100 % / EHR 100 %.
//   Every accepted member: consent grant + enrollment + reuse license (+ lines) + license_fee ledger row (via the
//   same enroll() the accept route uses); every verified contribution: contribution_payment ledger row + coverage
//   bump (protocol_days). Dataset v1 (superseded) and v2 (current) over the started members.
// Every count scales with ctx.scale (rounded), clamped to the available candidates.
import { addDays } from '@shared/clock';
import type { OpportunityStatus } from '@shared/api-types';
import { enroll, type OppJoined, type SeedVariable } from '../services/consent';
import { buildDataset, type DatasetVar } from '../services/dataset';
import { finalizeIfComplete, verifyBulkContribution } from '../services/simulate';
import { studyCounters } from '../services/campaign';
import { type SeedCtx, pickExactly } from './context';

/** Full-scale opportunity mix (Alex is the 4,850th: one more 'offered'). */
export const FULL_MIX: Record<string, number> = {
  paid: 2_378, rejected: 43, in_progress: 300, submitted: 120, accepted: 158, withdrawn: 12,
  declined_after_view: 37, expired: 30, declined: 1_172, offered: 399, viewed: 130, reviewed: 70,
};
/** Verified contributions among started-but-not-completed members (420 at full scale). */
const PARTIAL_VERIFIED = { bp: 306, nutrition: 207, survey: 150, of: 420 };
export const FULL_MARKETPLACE_TARGETS = { invited: 4_850, accepted: 3_011, started: 2_841, completed: 2_421, quality: 2_378, needReplacement: 122 };

export const METABOLIC_DATASET_VARS: DatasetVar[] = [
  { slug: 'demographics.basics.age', source: 'reuse' }, { slug: 'clinical.encounters.ehr_history', source: 'reuse' }, { slug: 'clinical.labs.lipid_panel', source: 'reuse' },
  { slug: 'biology.genomics.exome', source: 'reuse' }, { slug: 'physiology.cardiovascular.blood_pressure', source: 'protocol' }, { slug: 'behavior.nutrition.food_log', source: 'protocol' },
  { slug: 'clinical.medications.medication_list', source: 'reuse' }, { slug: 'imaging.mri.mri_musculoskeletal', source: 'reuse' }, { slug: 'outcomes.patient_reported.symptom_survey', source: 'protocol' },
];

const LAUNCH = '2026-02-10';
const T = (date: string, hh = '09') => `${date}T${hh}:00:00Z`;

export function seedMarketplace(ctx: SeedCtx): void {
  const db = ctx.graph;
  const rng = ctx.rng.fork('marketplace');
  const s = (v: number) => (ctx.scale >= 1 ? v : Math.round(v * ctx.scale));
  const campaignId = ctx.campaigns.metabolic;
  const studyId = ctx.studies.metabolic;
  const camp = db.get<{ variables_json: string; name: string }>('SELECT variables_json, name FROM campaign WHERE id = ?', campaignId)!;
  const study = db.get<{ name: string; purpose: string; license_term_months: number; buyer_org_id: number; org_name: string }>('SELECT s.name, s.purpose, s.license_term_months, s.buyer_org_id, o.name AS org_name FROM study s JOIN buyer_org o ON o.id = s.buyer_org_id WHERE s.id = ?', studyId)!;
  const variables = JSON.parse(camp.variables_json) as SeedVariable[];
  const collect = variables.filter((v) => v.mode !== 'reuse').map((v) => v.conceptSlug);
  const comp = variables.reduce((a, v) => a + v.compCents, 0);
  const cid = (slug: string) => ctx.concepts.get(slug)!;
  const BP = cid('physiology.cardiovascular.blood_pressure'), FOOD = cid('behavior.nutrition.food_log'), SURVEY = cid('outcomes.patient_reported.symptom_survey');

  // candidates: recruitable (recontact, no exclusion touching the campaign's domains), never the detailed participant
  const recruitable = `cs.recontact_opt_in = 1 AND cs.commercial_ok = 1 AND instr(cs.excluded_categories_json, '"clinical"') = 0 AND instr(cs.excluded_categories_json, '"biology"') = 0
    AND instr(cs.excluded_categories_json, '"physiology"') = 0 AND instr(cs.excluded_categories_json, '"behavior"') = 0 AND instr(cs.excluded_categories_json, '"outcomes"') = 0`;
  const upper = db.all<{ id: number }>(`SELECT p.id FROM participant p JOIN consent_setting cs ON cs.participant_id = p.id WHERE p.is_detailed = 0 AND p.tier >= 4 AND ${recruitable} ORDER BY p.id`).map((r) => r.id);
  const t3 = db.all<{ id: number }>(`SELECT p.id FROM participant p JOIN consent_setting cs ON cs.participant_id = p.id WHERE p.is_detailed = 0 AND p.tier = 3 AND ${recruitable} ORDER BY p.id`).map((r) => r.id);
  rng.fork('upper').shuffle(upper);
  rng.fork('t3').shuffle(t3);

  const mix: Record<string, number> = {};
  for (const k of Object.keys(FULL_MIX)) mix[k] = s(FULL_MIX[k]);
  const startedKeys = ['paid', 'rejected', 'in_progress', 'submitted'];
  let started = startedKeys.reduce((a, k) => a + mix[k], 0);
  if (started > upper.length) { // tiny scales: shrink the started mix proportionally
    const f = upper.length / started;
    for (const k of startedKeys) mix[k] = Math.floor(mix[k] * f);
    started = startedKeys.reduce((a, k) => a + mix[k], 0);
  }
  const rest = [...upper.slice(started), ...t3];
  const otherKeys = Object.keys(FULL_MIX).filter((k) => !startedKeys.includes(k));
  let others = otherKeys.reduce((a, k) => a + mix[k], 0);
  if (others > rest.length) { mix.declined = Math.max(0, mix.declined - (others - rest.length)); others = otherKeys.reduce((a, k) => a + mix[k], 0); }
  if (others > rest.length) throw new Error(`[seed] marketplace: not enough candidates (${rest.length}) for ${others} non-started invitations`);

  // expanded status lists, shuffled so tiers mix inside each status
  const startedList: string[] = [];
  for (const k of startedKeys) for (let i = 0; i < mix[k]; i++) startedList.push(k);
  rng.fork('started').shuffle(startedList);
  const otherList: string[] = [];
  for (const k of otherKeys) for (let i = 0; i < mix[k]; i++) otherList.push(k);
  rng.fork('others').shuffle(otherList);

  // verified-contribution quotas inside the started-not-completed set
  const partialN = mix.in_progress + mix.submitted;
  const q = (v: number) => Math.min(partialN, Math.round((v / PARTIAL_VERIFIED.of) * partialN));
  const partialIdx: number[] = [];
  startedList.forEach((k, i) => { if (k === 'in_progress' || k === 'submitted') partialIdx.push(i); });
  const bpV = pickExactly(rng.fork('bpv'), partialIdx.length, q(PARTIAL_VERIFIED.bp));
  const nutV = pickExactly(rng.fork('nutv'), partialIdx.length, q(PARTIAL_VERIFIED.nutrition));
  const surV = pickExactly(rng.fork('surv'), partialIdx.length, q(PARTIAL_VERIFIED.survey));
  const partialPos = new Map(partialIdx.map((i, j) => [i, j]));

  let licenseNo = 2000;
  let n = 0;
  const base = (pid: number, status: OpportunityStatus, offeredAt: string): OppJoined => ({
    id: 0, participant_id: pid, status, missing_concepts_json: JSON.stringify(collect), comp_max_cents: comp, viewed_at: null, reviewed_at: null,
    campaign_id: campaignId, campaign_name: camp.name, campaign_status: 'active', variables_json: camp.variables_json, study_id: studyId, study_name: study.name, purpose: study.purpose,
    license_term_months: study.license_term_months, buyer_org_id: study.buyer_org_id, org_name: study.org_name, is_detailed: 0,
  });
  const offer = (pid: number, status: OpportunityStatus, d: { offered: string; viewed?: string; reviewed?: string; responded?: string; completed?: string }): OppJoined => {
    const o = base(pid, status, d.offered);
    o.id = db.run('INSERT INTO opportunity (campaign_id, participant_id, status, missing_concepts_json, comp_max_cents, offered_at, viewed_at, reviewed_at, responded_at, completed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      campaignId, pid, status, o.missing_concepts_json, comp, T(d.offered), d.viewed ? T(d.viewed, '19') : null, d.reviewed ? T(d.reviewed, '08') : null, d.responded ? T(d.responded, '08') : null, d.completed ? T(d.completed, '12') : null, T(d.offered)).lastId;
    n++;
    return o;
  };
  const dates = (r: typeof rng) => {
    const offered = addDays(LAUNCH, r.int(0, 35));
    const viewed = addDays(offered, r.int(0, 3));
    const reviewed = addDays(viewed, r.int(0, 5));
    const accepted = addDays(reviewed, r.int(0, 2));
    const startedAt = addDays(accepted, r.int(1, 7));
    const submitted = addDays(startedAt, 14 + r.int(0, 10));
    const completed = addDays(submitted, r.int(1, 5));
    return { offered, viewed, reviewed, accepted, startedAt, submitted, completed };
  };

  db.tx(() => {
    // ---- started members (T4/T5/T6) ----
    startedList.forEach((status, i) => {
      const pid = upper[i];
      const r = rng.fork(`m:${pid}`);
      const d = dates(r);
      const o = offer(pid, 'accepted', { offered: d.offered, viewed: d.viewed, reviewed: d.reviewed, responded: d.accepted });
      enroll(db, o, { at: T(d.accepted, '08'), termStart: d.accepted, licenseNumber: licenseNo++ });
      const contribs = db.all<{ id: number; opportunity_id: number; participant_id: number; concept_id: number; status: 'pending' | 'submitted' | 'verified' | 'rejected'; method: string; duration_days: number; comp_cents: number }>(
        'SELECT id, opportunity_id, participant_id, concept_id, status, method, duration_days, comp_cents FROM contribution WHERE opportunity_id = ? ORDER BY id', o.id);
      const byConcept = new Map(contribs.map((c) => [c.concept_id, c]));
      const verify = (conceptId: number, at: string, reject = false) => verifyBulkContribution(db, byConcept.get(conceptId)!, studyId, at, reject);
      if (status === 'paid' || status === 'rejected') {
        db.run("UPDATE opportunity SET status = 'in_progress' WHERE id = ?", o.id);
        o.status = 'in_progress';
        verify(BP, T(d.completed, '12'));
        verify(FOOD, T(d.completed, '12'), status === 'rejected');
        verify(SURVEY, T(d.completed, '12'));
        finalizeIfComplete(db, o, T(d.completed, '12'));
      } else {
        const j = partialPos.get(i)!;
        db.run('UPDATE opportunity SET status = ? WHERE id = ?', status, o.id);
        const submittedAt = T(status === 'submitted' ? d.submitted : addDays(d.startedAt, 10), '18');
        if (bpV[j]) verify(BP, submittedAt);
        if (nutV[j]) verify(FOOD, submittedAt);
        if (surV[j]) verify(SURVEY, submittedAt);
        const restStatus = status === 'submitted' ? 'submitted' : r.bool(0.3) ? 'submitted' : 'pending';
        db.run("UPDATE contribution SET status = ?, submitted_at = CASE WHEN ? = 'submitted' THEN ? ELSE NULL END WHERE opportunity_id = ? AND status = 'pending'", restStatus, restStatus, submittedAt, o.id);
      }
    });
    // ---- the rest: accepted-not-started, withdrawn, declined / expired / still open ----
    otherList.forEach((status, i) => {
      const pid = rest[i];
      const r = rng.fork(`m:${pid}`);
      const d = dates(r);
      switch (status) {
        case 'accepted': {
          const o = offer(pid, 'accepted', { offered: d.offered, viewed: d.viewed, reviewed: d.reviewed, responded: d.accepted });
          enroll(db, o, { at: T(d.accepted, '08'), termStart: d.accepted, licenseNumber: licenseNo++ });
          break;
        }
        case 'withdrawn': {
          const o = offer(pid, 'accepted', { offered: d.offered, viewed: d.viewed, reviewed: d.reviewed, responded: d.accepted });
          const e = enroll(db, o, { at: T(d.accepted, '08'), termStart: d.accepted, licenseNumber: licenseNo++ });
          const at = T(d.startedAt, '10');
          db.run("UPDATE opportunity SET status = 'withdrawn' WHERE id = ?", o.id);
          db.run("UPDATE enrollment SET status = 'withdrawn', withdrawn_at = ? WHERE id = ?", at, e.enrollmentId);
          db.run('UPDATE consent_grant SET revoked_at = ? WHERE id = ?', at, e.grantId);
          db.run('UPDATE license SET revoked_at = ? WHERE id = ?', at, e.licenseId);
          break;
        }
        case 'declined_after_view': offer(pid, 'declined', { offered: d.offered, viewed: d.viewed, reviewed: d.reviewed, responded: d.accepted }); break;
        case 'declined': offer(pid, 'declined', { offered: d.offered, responded: d.viewed }); break;
        case 'expired': offer(pid, 'expired', { offered: addDays(LAUNCH, r.int(0, 10)) }); break;
        case 'offered': offer(pid, 'offered', { offered: d.offered }); break;
        case 'viewed': offer(pid, 'viewed', { offered: d.offered, viewed: d.viewed }); break;
        case 'reviewed': offer(pid, 'reviewed', { offered: d.offered, viewed: d.viewed, reviewed: d.reviewed }); break;
        default: throw new Error(`unknown status ${status}`);
      }
    });
    db.run("UPDATE study SET updated_at = ? WHERE id = ?", T('2026-10-23', '08'), studyId);
    // ---- datasets: v1 (superseded) and the current v2 ----
    buildDataset(db, studyId, { now: T('2026-06-30'), variables: METABOLIC_DATASET_VARS, log: false, reason: 'initial build' });
    const v2 = buildDataset(db, studyId, { now: T('2026-10-22'), variables: METABOLIC_DATASET_VARS, log: false, reason: 'completions' });
    const counters = studyCounters(studyId, db, false);
    db.run('INSERT INTO activity (participant_id, buyer_org_id, kind, text, amount_cents, occurred_at, created_at) VALUES (NULL,?,?,?,NULL,?,?)',
      study.buyer_org_id, 'study', `${study.name}: ${counters.qualityAccepted.toLocaleString('en-US')} quality-accepted completions of ${counters.started.toLocaleString('en-US')} started`, T('2026-10-23', '09'), T('2026-10-23', '09'));
    ctx.log(`  marketplace: ${n.toLocaleString('en-US')} opportunities (+ Alex) · accepted ${counters.accepted.toLocaleString('en-US')} · started ${counters.started.toLocaleString('en-US')} · completed ${counters.completed.toLocaleString('en-US')} · quality ${counters.qualityAccepted.toLocaleString('en-US')} · need replacement ${counters.needReplacement} · dataset v${v2.version} (${v2.memberCount.toLocaleString('en-US')} members)`);
    if (ctx.scale >= 1) {
      const want = FULL_MARKETPLACE_TARGETS;
      const got = { invited: counters.invited, accepted: counters.accepted, started: counters.started, completed: counters.completed, quality: counters.qualityAccepted, needReplacement: counters.needReplacement };
      for (const k of Object.keys(want) as (keyof typeof want)[]) if (got[k] !== want[k]) throw new Error(`[seed] marketplace ${k}: got ${got[k]}, expected ${want[k]}`);
    }
  });
}
