// Synthetic population: participants, consent settings, conditions and materialized coverage rows generated
// directly from the exact tier quotas (no per-observation rows for the bulk population).
import { DEMO_TODAY, addDays, nowIso } from '@shared/clock';
import { ONTOLOGY, PROHIBITED_USE_KEYS } from '@shared/ontology';
import { type SeedCtx, concept, pickExactly, pickExactlyAmong } from './context';
import { scaledTiers, type TierQuota } from './tiers';

const DEMO_YEAR = Number(DEMO_TODAY.slice(0, 4));
const US_REGIONS = ['CA', 'TX', 'NY', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI', 'WA', 'AZ', 'MA', 'CO', 'MN'];
const OTHER_COUNTRIES = ['GB', 'CA', 'DE', 'AU', 'FR', 'NL', 'SE', 'ES', 'IT', 'IE', 'IN', 'BR', 'JP', 'SG'];
const DOMAINS = ONTOLOGY.map((d) => d.slug);

/** ISO date `n` days before DEMO_TODAY (memoized: the bulk seed calls this ~1M times). */
const AGO: string[] = [];
function ago(n: number): string {
  let v = AGO[n];
  if (v === undefined) { v = addDays(DEMO_TODAY, -n); AGO[n] = v; }
  return v;
}

type Member = {
  tier: number; sub: string;
  sex: string; birthYear: number; country: string; region: string | null; enrolledAt: string;
  recontact: boolean; excludedDomain: string | null;
  conditions: string[]; a1c: number | null;
  ehrSpan: number | null; exome: boolean;
  bp: 'ok' | 'short' | 'self' | 'none'; nutrition: 'ok' | 'short' | 'none';
  lipid: boolean; imaging: boolean; cgm: boolean; meds: boolean; quasi: boolean;
};

const S = {
  participant: 'INSERT INTO participant (pseudonym, sex, birth_year, country, region, enrolled_at, is_detailed, tier, created_at) VALUES (?,?,?,?,?,?,0,?,?)',
  consent: 'INSERT INTO consent_setting (participant_id, prohibited_uses_json, excluded_categories_json, recontact_opt_in, commercial_ok, preauthorize_reuse_only, willing_device, willing_protocol, willing_survey, willing_connect, updated_at, created_at) VALUES (?,?,?,?,1,?,?,?,?,?,?,?)',
  condition: 'INSERT INTO condition (participant_id, concept_id, onset_at, status, provenance_class, created_at) VALUES (?,?,?,?,?,?)',
  coverage: 'INSERT INTO participant_coverage (participant_id, concept_id, first_at, last_at, span_days, n_obs, best_prov_rank, verified_n, self_report_n, last_value_num, protocol_days) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
};

export function seedPopulation(ctx: SeedCtx): { tiers: TierQuota[]; generated: number } {
  const tiers = scaledTiers(ctx.scale);
  const db = ctx.graph;
  const now = nowIso();
  const prohibited = JSON.stringify(PROHIBITED_USE_KEYS);
  const C = {
    t2d: concept(ctx, 'clinical.diagnoses.type_2_diabetes'), htn: concept(ctx, 'clinical.diagnoses.hypertension'),
    hld: concept(ctx, 'clinical.diagnoses.hyperlipidemia'), obesity: concept(ctx, 'clinical.diagnoses.obesity'),
    asthma: concept(ctx, 'clinical.diagnoses.asthma'), depression: concept(ctx, 'clinical.diagnoses.depression'),
    ehr: concept(ctx, 'clinical.encounters.ehr_history'), exome: concept(ctx, 'biology.genomics.exome'),
    bp: concept(ctx, 'physiology.cardiovascular.blood_pressure'), food: concept(ctx, 'behavior.nutrition.food_log'),
    a1c: concept(ctx, 'clinical.labs.hba1c'), lipid: concept(ctx, 'clinical.labs.lipid_panel'),
    mri: concept(ctx, 'imaging.mri.mri_musculoskeletal'), cgm: concept(ctx, 'physiology.metabolic.cgm'),
    meds: concept(ctx, 'clinical.medications.medication_list'), problems: concept(ctx, 'clinical.diagnoses.problem_list'),
    hr: concept(ctx, 'physiology.cardiovascular.heart_rate'), hrv: concept(ctx, 'physiology.cardiovascular.hrv'),
    sleep: concept(ctx, 'physiology.sleep.sleep_duration'), steps: concept(ctx, 'physiology.mobility.steps'),
    weight: concept(ctx, 'physiology.metabolic.weight'), age: concept(ctx, 'demographics.basics.age'),
    sex: concept(ctx, 'demographics.basics.sex'), loc: concept(ctx, 'demographics.basics.location'),
  };
  const condSlug: Record<string, number> = { t2d: C.t2d, htn: C.htn, hld: C.hld, obesity: C.obesity, asthma: C.asthma, depression: C.depression };

  const used = new Set<string>();
  const pseudonym = (rng: typeof ctx.rng): string => {
    for (;;) {
      const p = 'P-' + (rng.int(0, 0xfffff).toString(16).padStart(5, '0') + rng.int(0, 0xfffff).toString(16).padStart(5, '0'));
      if (!used.has(p)) { used.add(p); return p; }
    }
  };

  let generated = 0;
  for (const t of tiers) {
    const rng = ctx.rng.fork(`tier${t.tier}`);
    const members = buildTier(t, rng);
    const n = members.length;
    db.tx(() => {
      for (let i = 0; i < n; i++) {
        const m = members[i];
        const pid = db.run(S.participant, pseudonym(rng), m.sex, m.birthYear, m.country, m.region, m.enrolledAt, m.tier, now).lastId;
        db.run(S.consent, pid, prohibited, m.excludedDomain ? JSON.stringify([m.excludedDomain]) : '[]', m.recontact ? 1 : 0,
          rng.bool(0.2) ? 1 : 0, rng.bool(0.85) ? 1 : 0, rng.bool(0.8) ? 1 : 0, rng.bool(0.9) ? 1 : 0, rng.bool(0.85) ? 1 : 0, now, now);
        for (const c of m.conditions) {
          db.run(S.condition, pid, condSlug[c], ago(rng.int(365, 365 * 12)), 'active', 'clinical_source', now);
        }
        // --- coverage rows ---
        if (m.ehrSpan !== null) {
          const lastN = rng.int(0, 60);
          cov(db, pid, C.ehr, ago(lastN + m.ehrSpan), ago(lastN), m.ehrSpan, Math.floor(m.ehrSpan / 90) + 1, 4, null);
        }
        if (m.exome) {
          const at = ago(rng.int(30, 365 * 5));
          cov(db, pid, C.exome, at, at, 0, 1, 4, null);
        }
        if (m.bp !== 'none') {
          const lastN = rng.int(0, m.bp === 'ok' ? 10 : 90);
          const span = m.bp === 'ok' ? rng.int(365, 900) : rng.int(14, 300);
          const rank = m.bp === 'self' ? 1 : 3;
          cov(db, pid, C.bp, ago(lastN + span), ago(lastN), span, rank === 1 ? rng.int(3, 20) : Math.round(span * 2.4), rank, rng.int(118, 146));
        }
        if (m.nutrition !== 'none') {
          const lastN = rng.int(0, m.nutrition === 'ok' ? 7 : 60);
          const span = m.nutrition === 'ok' ? rng.int(30, 420) : rng.int(2, 25);
          cov(db, pid, C.food, ago(lastN + span), ago(lastN), span, Math.round(span * 2.6), 2, null);
        }
        if (m.a1c !== null) {
          const lastN = rng.int(5, 200);
          const span = rng.int(0, 365 * 6);
          cov(db, pid, C.a1c, ago(lastN + span), ago(lastN), span, Math.floor(span / 180) + 1, 4, m.a1c);
        }
        if (m.lipid) {
          const lastN = rng.int(5, 400);
          const span = rng.int(0, 365 * 6);
          cov(db, pid, C.lipid, ago(lastN + span), ago(lastN), span, Math.floor(span / 365) + 1, 4, rng.int(150, 260));
        }
        if (m.imaging) {
          const at = ago(rng.int(30, 365 * 4));
          cov(db, pid, C.mri, at, at, 0, 1, 4, null);
        }
        if (m.cgm) {
          const lastN = rng.int(0, 120);
          const span = rng.int(14, 180);
          cov(db, pid, C.cgm, ago(lastN + span), ago(lastN), span, span * 96, 3, rng.int(120, 190));
        }
        if (m.meds) {
          const span = rng.int(180, 365 * 8);
          cov(db, pid, C.meds, ago(span), ago(rng.int(0, 30)), span, rng.int(1, 6), 4, null);
        }
        if (m.quasi) {
          // quasi-detailed summaries for the ready-now cohort and potential study completers
          const wearSpan = rng.int(200, 1200);
          const first = ago(wearSpan);
          const last = ago(rng.int(0, 2));
          cov(db, pid, C.hr, first, last, wearSpan, wearSpan, 3, rng.int(58, 78));
          cov(db, pid, C.hrv, first, last, wearSpan, wearSpan, 3, rng.int(22, 60));
          cov(db, pid, C.sleep, first, last, wearSpan, wearSpan, 3, Number(rng.float(5.8, 7.9).toFixed(1)));
          cov(db, pid, C.steps, first, last, wearSpan, wearSpan, 3, rng.int(3500, 11000));
          cov(db, pid, C.weight, first, last, wearSpan, Math.floor(wearSpan / 7), 3, Number(rng.float(62, 118).toFixed(1)));
          cov(db, pid, C.problems, ago(rng.int(365, 3650)), ago(rng.int(0, 365)), 0, m.conditions.length, 4, null);
          cov(db, pid, C.age, m.enrolledAt, m.enrolledAt, 0, 1, 4, DEMO_YEAR - m.birthYear);
          cov(db, pid, C.sex, m.enrolledAt, m.enrolledAt, 0, 1, 4, null);
          cov(db, pid, C.loc, m.enrolledAt, m.enrolledAt, 0, 1, 4, null);
        }
      }
    });
    generated += n;
    ctx.log(`  tier ${t.tier} (${t.label}): ${n.toLocaleString('en-US')} participants`);
  }
  return { tiers, generated };
}

function cov(db: SeedCtx['graph'], pid: number, cid: number, first: string, last: string, span: number, n: number, rank: number, lastValue: number | null): void {
  const verified = rank >= 2 ? n : 0;
  db.run(S.coverage, pid, cid, first, last, span, n, rank, verified, rank === 1 ? n : 0, lastValue);
}

function buildTier(t: TierQuota, rng: SeedCtx['rng']): Member[] {
  const members: Member[] = [];
  for (const g of t.subgroups) for (let i = 0; i < g.n; i++) members.push(baseMember(t, g.key, rng));
  const n = members.length;
  const idx = (pred: (m: Member) => boolean) => members.map((m, i) => (pred(m) ? i : -1)).filter((i) => i >= 0);
  const subOf = (key: string) => t.subgroups.find((g) => g.key === key)!;

  const recontact = pickExactly(rng.fork('recontact'), n, t.recontact);
  const excluded = pickExactly(rng.fork('excluded'), n, t.excluded);
  const lipid = pickExactly(rng.fork('lipid'), n, t.lipid);
  const imaging = pickExactly(rng.fork('imaging'), n, t.imaging);
  const cgm = pickExactly(rng.fork('cgm'), n, t.cgm);
  const meds = pickExactly(rng.fork('meds'), n, t.meds);
  const exome = t.tier >= 4 ? null : t.tier === 3 ? new Uint8Array(n) : pickExactly(rng.fork('exome'), n, t.exome);
  const ehr1y = t.tier >= 3 ? null : pickExactly(rng.fork('ehr1y'), n, t.ehr1y);
  const bpQuota = idx((m) => subOf(m.sub).bp === 'quota');
  const bpOk = pickExactlyAmong(rng.fork('bpok'), n, bpQuota, t.bpOkExtra);
  const bpShort = pickExactlyAmong(rng.fork('bpshort'), n, bpQuota.filter((i) => !bpOk[i]), t.bpShort);
  const nutQuota = idx((m) => subOf(m.sub).nutrition === 'quota');
  const nutShort = pickExactlyAmong(rng.fork('nutshort'), n, nutQuota, t.nutritionShort);

  for (let i = 0; i < n; i++) {
    const m = members[i];
    const g = subOf(m.sub);
    m.recontact = recontact[i] === 1;
    m.excludedDomain = excluded[i] ? rng.pick(DOMAINS) : null;
    m.lipid = lipid[i] === 1;
    m.imaging = imaging[i] === 1;
    m.cgm = cgm[i] === 1;
    m.meds = meds[i] === 1;
    m.exome = exome ? exome[i] === 1 : g.hasExome;
    // EHR span
    if (g.ehr === 'long') m.ehrSpan = rng.int(1095, 3650);
    else if (g.ehr === 'mid') m.ehrSpan = ehr1y![i] ? rng.int(365, 1094) : rng.int(30, 364);
    else m.ehrSpan = ehr1y![i] ? rng.int(365, 3650) : rng.bool(0.6) ? rng.int(10, 364) : null;
    // BP
    if (g.bp === 'ok') m.bp = 'ok';
    else if (bpOk[i]) m.bp = 'ok';
    else if (bpShort[i]) m.bp = rng.bool(0.3) ? 'self' : 'short';
    else m.bp = 'none';
    // nutrition
    if (g.nutrition === 'ok') m.nutrition = 'ok';
    else m.nutrition = nutShort[i] ? 'short' : 'none';
    m.quasi = t.tier >= 4;
  }
  return members;
}

function baseMember(t: TierQuota, sub: string, rng: SeedCtx['rng']): Member {
  const sex = rng.bool(0.52) ? 'female' : 'male';
  let country = 'US', region: string | null = rng.pick(US_REGIONS), birthYear: number;
  if (t.demographicMatch) birthYear = rng.int(DEMO_YEAR - 65, DEMO_YEAR - 40);
  else if (rng.bool(0.65)) { country = rng.pick(OTHER_COUNTRIES); region = null; birthYear = rng.int(DEMO_YEAR - 84, DEMO_YEAR - 18); }
  else birthYear = rng.bool(0.6) ? rng.int(DEMO_YEAR - 39, DEMO_YEAR - 18) : rng.int(DEMO_YEAR - 84, DEMO_YEAR - 66);

  const conditions: string[] = [];
  let a1c: number | null = null;
  if (t.conditionsMatch) {
    conditions.push('t2d', 'htn');
    if (rng.bool(0.45)) conditions.push('hld');
    if (rng.bool(0.3)) conditions.push('obesity');
    a1c = Number(rng.float(7.1, 9.8).toFixed(1));
  } else if (t.tier === 1) {
    const r = rng.next();
    if (r < 0.3) { conditions.push('t2d', 'htn'); a1c = Number(rng.float(5.9, 7.0).toFixed(1)); }
    else if (r < 0.55) { conditions.push('htn'); a1c = rng.bool(0.6) ? Number(rng.float(5.0, 6.4).toFixed(1)) : null; }
    else if (r < 0.65) { conditions.push('t2d'); a1c = Number(rng.float(6.5, 9.0).toFixed(1)); }
    else a1c = rng.bool(0.5) ? Number(rng.float(4.9, 6.2).toFixed(1)) : null;
    if (rng.bool(0.2)) conditions.push('hld');
  } else {
    if (rng.bool(0.22)) conditions.push('htn');
    if (rng.bool(0.09)) { conditions.push('t2d'); a1c = Number(rng.float(6.5, 9.5).toFixed(1)); }
    else if (rng.bool(0.5)) a1c = Number(rng.float(4.9, 6.3).toFixed(1));
    if (rng.bool(0.12)) conditions.push('hld');
    if (rng.bool(0.06)) conditions.push('asthma');
    if (rng.bool(0.05)) conditions.push('depression');
  }
  return {
    tier: t.tier, sub, sex, birthYear, country, region, enrolledAt: ago(rng.int(5, 1095)),
    recontact: true, excludedDomain: null, conditions, a1c, ehrSpan: null, exome: false, bp: 'none', nutrition: 'none',
    lipid: false, imaging: false, cgm: false, meds: false, quasi: false,
  };
}
