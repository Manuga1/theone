// Alex: the one fully detailed participant. Ten years of history as raw + derived observations with artifacts,
// 12 connected & verified sources, timeline events, and the marketplace state (see alex-marketplace.ts).
import { createHash } from 'node:crypto';
import { DEMO_TODAY, addDays, daysBetween, nowIso } from '@shared/clock';
import { PROHIBITED_USE_KEYS } from '@shared/ontology';
import { PROVENANCE_RANK, type ProvenanceClass } from '@shared/provenance';
import { insert } from '../db/migrate';
import { type SeedCtx, concept, pickExactly } from './context';
import { seedAlexMarketplace } from './alex-marketplace';

export const ALEX = {
  pseudonym: 'P-7f3a9c1e2b',
  legalName: 'Alex Morgan',
  firstName: 'Alex',
  email: 'alex.morgan@example.com',
  phone: '+1 (415) 555-0142',
  dob: '1978-06-14',
  birthYear: 1978,
  sex: 'male',
  country: 'US',
  region: 'CA',
  enrolledAt: '2023-03-05',
  address: { line1: '2140 Hayes St', city: 'San Francisco', state: 'CA', zip: '94117' },
  bpStart: '2025-08-24',
  bpExpectedRows: 1482,
};

type ObsIn = {
  slug: string; at: string; num?: number | null; text?: string | null; json?: unknown; unit?: string | null;
  from?: string | null; to?: string | null; source: number | null; method: string; prov: ProvenanceClass;
  verification?: string; confidence?: number | null; artifact?: number | null; derivedFrom?: number | null; derivation?: string | null; contribution?: number | null;
};

const OBS_SQL = 'INSERT INTO observation (participant_id, concept_id, value_num, value_text, value_json, unit, observed_at, valid_from, valid_to, source_id, method, provenance_class, provenance_rank, verification, confidence, artifact_id, derived_from_id, derivation, contribution_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
const ART_SQL = 'INSERT INTO artifact (participant_id, source_id, kind, uri, sha256, bytes, captured_at, created_at) VALUES (?,?,?,?,?,?,?,?)';

export class AlexWriter {
  constructor(private ctx: SeedCtx, public pid: number) {}
  private now = nowIso();
  obs(o: ObsIn): number {
    const rank = PROVENANCE_RANK[o.prov];
    return this.ctx.graph.run(OBS_SQL, this.pid, concept(this.ctx, o.slug), o.num ?? null, o.text ?? null, o.json === undefined ? null : JSON.stringify(o.json), o.unit ?? null,
      o.at, o.from ?? null, o.to ?? null, o.source, o.method, o.prov, rank, o.verification ?? (rank >= 2 ? 'verified' : 'self_reported'), o.confidence ?? null,
      o.artifact ?? null, o.derivedFrom ?? null, o.derivation ?? null, o.contribution ?? null, this.now).lastId;
  }
  artifact(sourceId: number | null, kind: string, uri: string, bytes: number, capturedAt: string): number {
    const sha = createHash('sha256').update(uri).digest('hex');
    return this.ctx.graph.run(ART_SQL, this.pid, sourceId, kind, uri, sha, bytes, capturedAt, this.now).lastId;
  }
  event(occurredAt: string, kind: string, category: string, title: string, detail?: string | null, slug?: string | null): number {
    return insert(this.ctx.graph, 'event', { participant_id: this.pid, occurred_at: occurredAt, kind, category, title, detail: detail ?? null, concept_id: slug ? concept(this.ctx, slug) : null, created_at: this.now });
  }
  activity(occurredAt: string, kind: string, text: string, amountCents: number | null = null): void {
    insert(this.ctx.graph, 'activity', { participant_id: this.pid, buyer_org_id: null, kind, text, amount_cents: amountCents, occurred_at: occurredAt, created_at: this.now });
  }
}

export type AlexSources = Record<'ehr' | 'quest' | 'watch' | 'genomics' | 'imaging' | 'meals' | 'omron' | 'surveys' | 'pharmacy' | 'labcorp' | 'kaiser' | 'scale' | 'manual' | 'dexcom' | 'dyno' | 'microbiome' | 'air', number>;

export function seedAlex(ctx: SeedCtx): number {
  const db = ctx.graph;
  const now = nowIso();
  const rng = ctx.rng.fork('alex');

  const pid = db.tx(() => insert(db, 'participant', {
    pseudonym: ALEX.pseudonym, sex: ALEX.sex, birth_year: ALEX.birthYear, country: ALEX.country, region: ALEX.region,
    enrolled_at: ALEX.enrolledAt, is_detailed: 1, tier: 6, created_at: now,
  }));
  ctx.alexId = pid;
  ctx.vault.tx(() => insert(ctx.vault, 'identity', {
    participant_id: pid, legal_name: ALEX.legalName, email: ALEX.email, phone: ALEX.phone, dob: ALEX.dob,
    address_json: JSON.stringify(ALEX.address), verification_status: 'verified', created_at: now,
  }));
  const w = new AlexWriter(ctx, pid);

  // ---------------- sources (12 connected + verified; manual self-report; 4 available) ----------------
  const S = {} as AlexSources;
  db.tx(() => {
    const src = (key: keyof AlexSources, kind: string, vendor: string, label: string, actionLabel: string, status: string, connectedAt: string | null, lastSync: string | null, verified: boolean, order: number) => {
      S[key] = insert(db, 'source', { participant_id: pid, kind, vendor, label, action_label: actionLabel, status, connected_at: connectedAt, last_sync_at: lastSync, verified: verified ? 1 : 0, sort_order: order, created_at: now });
    };
    src('ehr', 'ehr', 'MyChart (Sutter Health)', 'Medical Records', 'Connect MyChart', 'connected', '2023-04-02', '2026-10-23T14:00:00Z', true, 1);
    src('quest', 'lab', 'Quest Diagnostics', 'Labs', 'Connect Lab', 'connected', '2023-04-02', '2026-10-23T07:30:00Z', true, 2);
    src('watch', 'wearable', 'Apple Watch', 'Wearables', 'Connect Garmin / Apple Watch', 'connected', '2023-03-05', '2026-10-24T07:00:00Z', true, 3);
    src('genomics', 'genomics', 'Color Genomics', 'Genomics', 'Upload or connect', 'connected', '2024-02-18', '2024-02-18T12:00:00Z', true, 4);
    src('imaging', 'imaging', 'DICOM import', 'Imaging', 'Import MRI / CT', 'connected', '2024-09-15', '2026-10-05T16:00:00Z', true, 5);
    src('meals', 'nutrition', 'MealSnap', 'Nutrition', 'Photograph meals', 'connected', '2025-04-01', '2026-10-23T20:10:00Z', true, 6);
    src('omron', 'bp_device', 'Omron BP7450', 'Blood Pressure', 'Connect device', 'connected', '2025-08-24', '2026-10-24T07:05:00Z', true, 7);
    src('surveys', 'survey', 'Health questionnaires', 'Surveys', 'Answer questionnaires', 'connected', '2023-04-10', '2026-10-10T18:00:00Z', true, 8);
    src('pharmacy', 'pharmacy', 'CVS Pharmacy', 'Pharmacy', 'Connect pharmacy', 'connected', '2023-05-02', '2026-10-01T09:00:00Z', true, 9);
    src('labcorp', 'lab', 'LabCorp', 'Labs (LabCorp)', 'Connect Lab', 'connected', '2024-10-20', '2024-10-20T15:00:00Z', true, 10);
    src('kaiser', 'ehr', 'Kaiser Permanente (prior records)', 'Prior medical records', 'Import records', 'connected', '2023-06-12', '2023-06-12T10:00:00Z', true, 11);
    src('scale', 'scale', 'Withings Body+', 'Smart scale', 'Connect scale', 'connected', '2019-06-01', '2026-10-19T07:20:00Z', true, 12);
    src('manual', 'self_report', 'Manual entry', 'Self-reported', 'Add data', 'connected', '2023-04-10', '2026-09-30T08:00:00Z', false, 13);
    src('dexcom', 'cgm', 'Dexcom G7', 'Continuous glucose monitor', 'Connect CGM', 'available', null, null, false, 14);
    src('dyno', 'dynamometer', 'Camry dynamometer kit', 'Grip strength', 'Request kit', 'available', null, null, false, 15);
    src('microbiome', 'microbiome', 'Stool sequencing kit', 'Microbiome', 'Request kit', 'available', null, null, false, 16);
    src('air', 'environment', 'PurpleAir', 'Air quality sensor', 'Connect sensor', 'available', null, null, false, 17);
  });

  // ---------------- conditions + problem list ----------------
  db.tx(() => {
    const cond = (slug: string, onset: string, label: string, source: number) => {
      insert(db, 'condition', { participant_id: pid, concept_id: concept(ctx, slug), onset_at: onset, status: 'active', provenance_class: 'clinical_source', created_at: now });
      w.obs({ slug: 'clinical.diagnoses.problem_list', at: onset, text: label, from: onset, source, method: 'ehr', prov: 'clinical_source' });
    };
    cond('clinical.diagnoses.hypertension', '2016-02-15', 'Essential hypertension (I10)', S.kaiser);
    cond('clinical.diagnoses.hyperlipidemia', '2019-07-01', 'Hyperlipidemia (E78.5)', S.ehr);
    cond('clinical.diagnoses.type_2_diabetes', '2024-10-20', 'Type 2 diabetes mellitus (E11.9)', S.ehr);

    // demographics (from EHR registration)
    w.obs({ slug: 'demographics.basics.age', at: ALEX.enrolledAt, num: Number(DEMO_TODAY.slice(0, 4)) - ALEX.birthYear, unit: 'years', source: S.ehr, method: 'ehr', prov: 'clinical_source' });
    w.obs({ slug: 'demographics.basics.sex', at: ALEX.enrolledAt, text: 'male', source: S.ehr, method: 'ehr', prov: 'clinical_source' });
    w.obs({ slug: 'demographics.basics.location', at: ALEX.enrolledAt, text: 'US-CA', source: S.ehr, method: 'ehr', prov: 'clinical_source' });

    // medications as intervals
    const med = (text: string, from: string, to: string | null, source: number) =>
      w.obs({ slug: 'clinical.medications.medication_list', at: from, text, from, to, source, method: 'ehr', prov: 'clinical_source' });
    med('Lisinopril 10 mg daily', '2018-03-10', '2022-05-20', S.kaiser);
    med('Atorvastatin 20 mg daily', '2019-07-01', null, S.pharmacy);
    med('Lisinopril 20 mg daily', '2022-05-20', null, S.pharmacy);
    med('Metformin 500 mg twice daily', '2024-11-05', null, S.pharmacy);

    // family history, smoking, outcomes, imaging, self-reports
    w.obs({ slug: 'family.history.parental_conditions', at: '2016-02-15', text: 'Father: hypertension, MI at 68. Mother: type 2 diabetes.', source: S.kaiser, method: 'ehr', prov: 'clinical_source' });
    w.obs({ slug: 'family.history.sibling_conditions', at: '2023-04-10', text: 'Sister: none reported', source: S.manual, method: 'self_report', prov: 'self_report' });
    w.obs({ slug: 'family.ancestry.ancestry', at: '2023-04-10', text: 'Northern European / Irish', source: S.manual, method: 'self_report', prov: 'self_report' });
    w.obs({ slug: 'behavior.substance.smoking_status', at: '2016-02-15', text: 'Never smoker', source: S.kaiser, method: 'ehr', prov: 'clinical_source' });
    w.obs({ slug: 'behavior.substance.alcohol_use', at: '2025-04-05', text: '3–4 drinks per week', source: S.manual, method: 'self_report', prov: 'self_report' });
    w.obs({ slug: 'behavior.nutrition.dietary_pattern', at: '2025-04-05', text: 'Mediterranean-leaning, low added sugar since 2025', source: S.manual, method: 'self_report', prov: 'self_report' });
    w.obs({ slug: 'environment.residential.residential_history', at: '2023-04-10', text: 'San Francisco, CA since 2009; Chicago, IL 2001–2009', source: S.manual, method: 'self_report', prov: 'self_report' });
    w.obs({ slug: 'environment.occupational.occupation', at: '2023-04-10', text: 'Software product manager (office / remote)', source: S.manual, method: 'self_report', prov: 'self_report' });
    w.obs({ slug: 'outcomes.clinical.hospitalizations', at: '2021-01-14', text: 'COVID-19: emergency visit, discharged same day', source: S.kaiser, method: 'ehr', prov: 'clinical_source' });
    w.obs({ slug: 'outcomes.clinical.complications', at: '2026-03-10', text: 'Annual diabetes complications review: no retinopathy, nephropathy or neuropathy', source: S.ehr, method: 'ehr', prov: 'clinical_source' });

    const mri = w.artifact(S.imaging, 'dicom', 'dicom://alex/2024-09-12/knee-mri.zip', 412_000_000, '2024-09-12');
    w.obs({ slug: 'imaging.mri.mri_musculoskeletal', at: '2024-09-12', text: 'MRI right knee: medial meniscus degeneration, no tear', source: S.imaging, method: 'upload', prov: 'clinical_source', artifact: mri });
    const cxr = w.artifact(S.imaging, 'dicom', 'dicom://alex/2021-01-14/chest-xray.zip', 18_000_000, '2021-01-14');
    w.obs({ slug: 'imaging.xray_ct.chest_xray', at: '2021-01-14', text: 'Chest X-ray: no consolidation', source: S.imaging, method: 'upload', prov: 'clinical_source', artifact: cxr });
    const ret = w.artifact(S.imaging, 'photo', 'file://alex/2026-10-05/retinal-scan.png', 6_400_000, '2026-10-05');
    w.obs({ slug: 'imaging.specialty.retinal_scan', at: '2026-10-05', text: 'Diabetic eye exam: no retinopathy', source: S.imaging, method: 'upload', prov: 'clinical_source', artifact: ret });

    // genomics: VCF artifact + variants + derived pharmacogenomics
    const vcf = w.artifact(S.genomics, 'vcf', 'file://alex/2024-02-18/exome.vcf.gz', 96_000_000, '2024-02-18');
    const exome = w.obs({ slug: 'biology.genomics.exome', at: '2024-02-18', text: 'Whole-exome sequencing (GRCh38), 48,112 variants', source: S.genomics, method: 'upload', prov: 'clinical_source', artifact: vcf });
    const variants = ['rs1801133 MTHFR C677T het', 'rs7903146 TCF7L2 T het', 'rs429358 APOE e3/e3', 'rs4994 ADRB3 het', 'rs1799983 NOS3 het', 'rs5186 AGTR1 het', 'rs699 AGT hom', 'rs1042713 ADRB2 het', 'rs10830963 MTNR1B het', 'rs13266634 SLC30A8 het', 'rs1801282 PPARG hom', 'rs5219 KCNJ11 het'];
    for (const v of variants) w.obs({ slug: 'biology.genomics.exome', at: '2024-02-18', text: v, source: S.genomics, method: 'upload', prov: 'clinical_source', artifact: vcf, derivedFrom: exome });
    w.obs({ slug: 'biology.genomics.pharmacogenomics', at: '2024-02-20', json: { CYP2C9: '*1/*2', SLCO1B1: 'decreased function', CYP2D6: 'normal metabolizer' }, source: S.genomics, method: 'derived', prov: 'clinical_source', derivedFrom: exome });
  });

  // ---------------- encounters + clinic BP + labs ----------------
  db.tx(() => {
    const visitTypes = ['Primary care visit', 'Hypertension follow-up', 'Annual physical', 'Telehealth check-in', 'Diabetes care visit'];
    const visitDates: string[] = [];
    for (let d = '2016-02-15'; d < '2026-08-01'; d = addDays(d, 88 + rng.int(0, 8))) visitDates.push(d);
    visitDates.push('2024-10-20', '2026-09-18');
    visitDates.sort();
    let k = 0;
    for (const d of visitDates) {
      const src = d < '2023-01-01' ? S.kaiser : S.ehr;
      const label = d === '2016-02-15' ? 'New patient visit — hypertension documented' : d === '2024-10-20' ? 'Diabetes diagnosis visit' : visitTypes[k % visitTypes.length];
      w.obs({ slug: 'clinical.encounters.ehr_history', at: d, text: label, source: src, method: 'ehr', prov: 'clinical_source' });
      // clinic BP trends: 142 (2016) → 150 (2022-05) → 132 (2026)
      const yr = Number(d.slice(0, 4)) + Number(d.slice(5, 7)) / 12;
      const sys = yr < 2022.4 ? 142 + (yr - 2016) * 1.3 : 150 - (yr - 2022.4) * 4.2;
      const s = Math.round(sys + rng.normal(0, 4));
      w.obs({ slug: 'clinical.vitals.clinic_blood_pressure', at: d, num: s, json: { systolic: s, diastolic: Math.round(s * 0.62 + rng.normal(0, 3)) }, unit: 'mmHg', source: src, method: 'ehr', prov: 'clinical_source' });
      k++;
    }
    // labs 2/yr 2017 → 2026 (HbA1c 5.6 → 7.4), last import 2026-10-23
    const a1c = [5.6, 5.7, 5.7, 5.8, 5.9, 6.0, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 7.0, 7.2, 7.3, 7.5, 7.2, 7.4];
    let i = 0;
    for (let y = 2017; y <= 2026; y++) {
      for (const md of ['03-10', '10-20']) {
        const date = y === 2026 && md === '10-20' ? '2026-10-23' : `${y}-${md}`;
        const src = date === '2024-10-20' ? S.labcorp : S.quest;
        const v = a1c[i++];
        const report = w.artifact(src, 'ehr_doc', `lab://${date}/panel.pdf`, 140_000, date);
        w.event(date, 'lab', 'labs', `Lab panel: HbA1c ${v.toFixed(1)}%`, date === '2024-10-20' ? 'HbA1c 7.2% — type 2 diabetes diagnosed' : null, 'clinical.labs.hba1c');
        w.obs({ slug: 'clinical.labs.hba1c', at: date, num: v, unit: '%', source: src, method: 'lab', prov: 'clinical_source', artifact: report });
        w.obs({ slug: 'clinical.labs.lipid_panel', at: date, num: Math.round(212 - (y - 2017) * 2 + rng.normal(0, 8)), json: { ldl: Math.round(130 - (y - 2017) * 3 + rng.normal(0, 6)), hdl: Math.round(44 + rng.normal(0, 3)) }, unit: 'mg/dL', source: src, method: 'lab', prov: 'clinical_source', artifact: report });
        w.obs({ slug: 'clinical.labs.metabolic_panel', at: date, num: Number((0.9 + rng.normal(0, 0.06)).toFixed(2)), json: { creatinine: 0.9, potassium: 4.1, sodium: 139 }, unit: 'mg/dL', source: src, method: 'lab', prov: 'clinical_source', artifact: report });
        w.obs({ slug: 'physiology.metabolic.glucose', at: date, num: Math.round(96 + (v - 5.6) * 20 + rng.normal(0, 5)), unit: 'mg/dL', source: src, method: 'lab', prov: 'clinical_source', artifact: report });
      }
    }
  });

  // ---------------- wearables: daily HR / HRV / sleep / steps / active minutes since 2023-03-05 ----------------
  db.tx(() => {
    const start = '2023-03-05';
    const n = daysBetween(start, DEMO_TODAY) + 1;
    let hr = 64, hrv = 36, sleep = 6.8;
    for (let d = 0; d < n; d++) {
      const date = addDays(start, d);
      hr = Math.max(52, Math.min(78, hr + rng.normal(0, 1.2) + (62 - hr) * 0.08));
      hrv = Math.max(18, Math.min(70, hrv + rng.normal(0, 2.5) + (40 - hrv) * 0.08));
      sleep = Math.max(4.5, Math.min(9, sleep + rng.normal(0, 0.5) + (6.9 - sleep) * 0.3));
      const steps = Math.max(1200, Math.round(7600 + rng.normal(0, 2400) + (date >= '2025-04-01' ? 900 : 0)));
      const active = Math.max(0, Math.round(steps / 260 + rng.normal(0, 6)));
      w.obs({ slug: 'physiology.cardiovascular.heart_rate', at: `${date}T06:00:00Z`, num: Math.round(hr), unit: 'bpm', source: S.watch, method: 'device', prov: 'connected_device' });
      w.obs({ slug: 'physiology.cardiovascular.hrv', at: `${date}T06:00:00Z`, num: Math.round(hrv), unit: 'ms', source: S.watch, method: 'device', prov: 'connected_device' });
      w.obs({ slug: 'physiology.sleep.sleep_duration', at: `${date}T07:00:00Z`, num: Number(sleep.toFixed(1)), unit: 'h', source: S.watch, method: 'device', prov: 'connected_device' });
      w.obs({ slug: 'physiology.sleep.sleep_stages', at: `${date}T07:00:00Z`, num: Math.round(sleep * 60 * 0.18), json: { deep: Math.round(sleep * 60 * 0.18), rem: Math.round(sleep * 60 * 0.22), light: Math.round(sleep * 60 * 0.6) }, unit: 'min', source: S.watch, method: 'device', prov: 'connected_device' });
      w.obs({ slug: 'physiology.mobility.steps', at: `${date}T23:00:00Z`, num: steps, unit: 'steps', source: S.watch, method: 'device', prov: 'connected_device' });
      w.obs({ slug: 'physiology.mobility.active_minutes', at: `${date}T23:00:00Z`, num: active, unit: 'min', source: S.watch, method: 'device', prov: 'connected_device' });
    }
  });

  // ---------------- weight weekly since 2019-06-01 (Withings): +14 lb in 2019, slow decline after food tracking ----------------
  db.tx(() => {
    let d = '2019-06-01';
    let wkg = 86.5;
    while (d <= '2026-10-19') {
      const yr = Number(d.slice(0, 4)) + Number(d.slice(5, 7)) / 12;
      const target = yr < 2020.3 ? 86.5 + (yr - 2019.4) * 7.1 : yr < 2025.3 ? 92.9 + (yr - 2020.3) * 0.15 : 93.6 - (yr - 2025.3) * 2.4;
      wkg = wkg + (target - wkg) * 0.5 + rng.normal(0, 0.35);
      w.obs({ slug: 'physiology.metabolic.weight', at: `${d}T07:20:00Z`, num: Number(wkg.toFixed(1)), unit: 'kg', source: S.scale, method: 'device', prov: 'connected_device' });
      d = addDays(d, 7);
    }
  });

  // ---------------- blood pressure: exactly 1,482 readings (427 days × 3 + a 4th on 201 days) ----------------
  db.tx(() => {
    const days = daysBetween(ALEX.bpStart, DEMO_TODAY) + 1; // 427
    const fourth = pickExactly(rng.fork('bp4'), days, 201);
    let level = 138;
    const monthFirst = new Map<string, { id: number; sys: number[]; dia: number[] }>();
    for (let d = 0; d < days; d++) {
      const date = addDays(ALEX.bpStart, d);
      const target = 138 - 10 * (d / (days - 1));
      level = 0.82 * level + 0.18 * target + rng.normal(0, 1.6);
      const art = w.artifact(S.omron, 'device_raw', `omron://bp7450/${date}.json`, 1_800 + rng.int(0, 400), date);
      const times = fourth[d] ? ['07:05', '13:10', '17:30', '21:00'] : ['07:05', '13:10', '21:00'];
      // the 14-day BP-variability protocol (Blood Pressure Variability study) ran 2025-11-25 → 2025-12-08
      const protocol = date >= '2025-11-25' && date <= '2025-12-08';
      for (const t of times) {
        const sys = Math.round(level + rng.normal(0, 4.5) + (t === '07:05' ? 2 : t === '21:00' ? -2 : 0));
        const dia = Math.round(sys * 0.62 + rng.normal(0, 3));
        const pulse = Math.round(66 + rng.normal(0, 4));
        const id = w.obs({ slug: 'physiology.cardiovascular.blood_pressure', at: `${date}T${t}:00Z`, num: sys, json: { systolic: sys, diastolic: dia, pulse }, unit: 'mmHg', source: S.omron,
          method: protocol ? 'protocol' : 'device', prov: protocol ? 'protocol_measurement' : 'connected_device', artifact: art, contribution: protocol ? -1 : null, confidence: 0.98 });
        const m = date.slice(0, 7);
        const slot = monthFirst.get(m) ?? { id, sys: [], dia: [] };
        slot.sys.push(sys); slot.dia.push(dia);
        monthFirst.set(m, slot);
      }
    }
    // derived monthly trajectory rows (summaries; not counted as measurements)
    for (const [m, slot] of monthFirst) {
      const mean = (a: number[]) => Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10;
      const last = m === DEMO_TODAY.slice(0, 7) ? DEMO_TODAY : addDays(`${m}-01`, 31).slice(0, 7) === m ? `${m}-31` : addDays(addDays(`${m}-01`, 31).slice(0, 7) + '-01', -1);
      w.obs({ slug: 'physiology.cardiovascular.blood_pressure', at: `${last}T23:59:00Z`, num: mean(slot.sys), json: { systolic: mean(slot.sys), diastolic: mean(slot.dia), n: slot.sys.length }, unit: 'mmHg', source: S.omron, method: 'derived', prov: 'connected_device', derivedFrom: slot.id, derivation: 'monthly_trajectory' });
    }
  });

  // ---------------- food log: ~1,150 meal photos (raw) + derived kcal/macros since 2025-04-01 ----------------
  db.tx(() => {
    const start = '2025-04-01';
    const end = '2026-10-23';
    const days = daysBetween(start, end) + 1;
    const slots = pickExactly(rng.fork('meals'), days * 3, 1150);
    const times = ['08:05', '12:40', '19:15'];
    const names = ['Oatmeal with berries', 'Greek salad with chicken', 'Salmon, quinoa and greens', 'Veggie omelette', 'Lentil soup', 'Turkey sandwich', 'Stir-fry with tofu', 'Yogurt and nuts', 'Grilled chicken bowl', 'Pasta primavera'];
    for (let d = 0; d < days; d++) {
      const date = addDays(start, d);
      for (let s = 0; s < 3; s++) {
        if (!slots[d * 3 + s]) continue;
        const at = `${date}T${times[s]}:00Z`;
        const art = w.artifact(S.meals, 'photo', `photo://meals/${date}-${s}.jpg`, 1_900_000 + rng.int(0, 900_000), at);
        const kcal = Math.round((s === 0 ? 420 : s === 1 ? 610 : 720) + rng.normal(0, 90));
        const raw = w.obs({ slug: 'behavior.nutrition.food_log', at, text: rng.pick(names), source: S.meals, method: 'photo', prov: 'photo_derived', artifact: art, confidence: 0.86 });
        w.obs({ slug: 'behavior.nutrition.food_log', at, num: kcal, json: { kcal, carbs_g: Math.round(kcal * 0.45 / 4), protein_g: Math.round(kcal * 0.25 / 4), fat_g: Math.round(kcal * 0.3 / 9) }, unit: 'kcal', source: S.meals, method: 'derived', prov: 'photo_derived', derivedFrom: raw, derivation: 'photo_nutrition_estimate', confidence: 0.74 });
      }
    }
  });

  // ---------------- self-reported logs and surveys ----------------
  db.tx(() => {
    for (let d = '2024-01-07'; d <= '2026-10-19'; d = addDays(d, 7)) {
      w.obs({ slug: 'behavior.physical_activity.exercise_log', at: d, num: rng.int(0, 4), text: 'sessions this week', unit: 'sessions', source: S.manual, method: 'self_report', prov: 'self_report' });
    }
    for (let d = '2025-01-05'; d <= '2026-10-19'; d = addDays(d, 7)) {
      w.obs({ slug: 'physiology.strength.strength_training', at: d, num: rng.int(0, 2), text: 'resistance sessions this week', unit: 'sessions', source: S.manual, method: 'self_report', prov: 'self_report' });
    }
  });

  // ---------------- timeline events (deck verbatim) ----------------
  db.tx(() => {
    w.event('2016-02-15', 'diagnosis', 'clinical', 'Hypertension first documented', 'Essential hypertension; lifestyle counselling', 'clinical.diagnoses.hypertension');
    w.event('2018-03-10', 'medication', 'medications', 'Lisinopril started', '10 mg daily', 'clinical.medications.medication_list');
    w.event('2019-06-01', 'lifestyle', 'lifestyle', 'Weight +14 lb', 'Exercise decreased', 'physiology.metabolic.weight');
    w.event('2019-07-01', 'medication', 'medications', 'Atorvastatin started', 'Hyperlipidemia documented', 'clinical.medications.medication_list');
    w.event('2021-01-14', 'infection', 'clinical', 'COVID infection', 'Emergency visit, discharged same day; chest X-ray clear', 'outcomes.clinical.hospitalizations');
    w.event('2022-05-20', 'medication', 'medications', 'BP increased; dose adjusted', 'Lisinopril 10 → 20 mg', 'physiology.cardiovascular.blood_pressure');
    w.event('2023-03-05', 'device', 'devices', 'Apple Watch connected', 'Sleep tracking begins', 'physiology.sleep.sleep_duration');
    w.event('2024-02-18', 'genomics', 'genomics', 'Exome sequencing', 'VCF uploaded; 48,112 variants', 'biology.genomics.exome');
    w.event('2024-09-12', 'imaging', 'imaging', 'MRI knee', 'Medial meniscus degeneration, no tear', 'imaging.mri.mri_musculoskeletal');
    w.event('2024-10-20', 'diagnosis', 'clinical', 'Type 2 diabetes diagnosed', 'HbA1c 7.2% (Quest/LabCorp)', 'clinical.diagnoses.type_2_diabetes');
    w.event('2024-11-05', 'medication', 'medications', 'Metformin started', '500 mg twice daily', 'clinical.medications.medication_list');
    w.event('2025-04-01', 'lifestyle', 'lifestyle', 'Food tracking begins', 'Meal photos via MealSnap', 'behavior.nutrition.food_log');
    w.event('2025-08-24', 'device', 'devices', 'Connected BP cuff', 'Omron BP7450, 3–4 readings per day', 'physiology.cardiovascular.blood_pressure');
    w.event('2026-02-12', 'research', 'research', 'Metabolic research cohort invitation', 'CGM opportunity available', 'physiology.metabolic.cgm');
    w.event('2026-10-05', 'imaging', 'imaging', 'Diabetic eye exam', 'Retinal scan: no retinopathy', 'imaging.specialty.retinal_scan');
    w.event('2026-10-23', 'lab', 'labs', 'New Quest labs imported', 'HbA1c 7.4%, lipid panel, metabolic panel', 'clinical.labs.hba1c');
  });

  // ---------------- consent settings + demand watch ----------------
  db.tx(() => {
    insert(db, 'consent_setting', {
      participant_id: pid, prohibited_uses_json: JSON.stringify(PROHIBITED_USE_KEYS), excluded_categories_json: '[]', recontact_opt_in: 1, commercial_ok: 1,
      preauthorize_reuse_only: 1, willing_device: 1, willing_protocol: 1, willing_survey: 1, willing_connect: 1, updated_at: now, created_at: now,
    });
    insert(db, 'demand_watch', { participant_id: pid, concept_id: concept(ctx, 'biology.microbiome.gut_microbiome'), created_at: '2026-04-02T10:00:00Z' });
  });

  // ---------------- marketplace: orgs, studies, opportunities, enrollments, licenses, ledger ----------------
  seedAlexMarketplace(ctx, w, S);

  // ---------------- activity ("What changed this week") ----------------
  db.tx(() => {
    w.activity('2026-10-24T07:05:00Z', 'bp_sync', '7 days of BP measurements added');
    w.activity('2026-10-23T07:30:00Z', 'labs_import', 'New Quest labs imported');
    w.activity('2026-10-22T06:00:00Z', 'sleep_sync', 'Sleep data automatically updated');
    w.activity('2026-10-21T10:00:00Z', 'license_fee', '$42 earned from Research License #1842', 4200);
    w.activity('2026-10-10T18:00:00Z', 'survey', 'Quarterly questionnaires submitted (Wearable Sleep Study)');
    w.activity('2026-10-05T16:00:00Z', 'imaging_import', 'Retinal scan imported');
  });

  return pid;
}
