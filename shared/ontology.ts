// Canonical concept tree ("personal health graph" ontology). Nine domains → groups → leaves.
// Weights are explicit decimals at every level (children of a node sum to 1; a leaf with weight 0 is a
// reference concept — e.g. a diagnosis used by the cohort builder — and does not count toward completeness
// nor appear in the signature list). The seed writes this tree into the `concept` table; services read the DB.
//
// Completeness: leaf score = 1 (verified) / 0.5 (partial) / 0 (missing); group % = Σ weight × score;
// domain % = Σ group weight × group %; overall = Σ domain weight × domain %.
import type { CampaignVariable } from './requirement';

export type DataType = 'structured' | 'time_series' | 'file' | 'dicom';
export type CollectionMethod = 'device' | 'protocol' | 'survey' | 'photo' | 'upload' | 'kit' | 'ehr' | 'lab' | 'self_report' | 'derived';

export type LeafDef = {
  slug: string;
  name: string;
  weight: number;
  unit?: string;
  dataType: DataType;
  /** Span required for "verified" (days). 0 = a single observation suffices. */
  minSpanDays: number;
  /** Max age of the latest observation for "verified"; null = never stale (files, genomics, demographics). */
  freshnessDays: number | null;
  method: CollectionMethod;
  /** The platform has a collection protocol for this leaf (B4 matrix only enumerates enrichable modalities). */
  enrichable: boolean;
  /** Default participant compensation (net cents) and device/test cost per collection, used by campaign defaults. */
  compCents: number;
  deviceCostCents: number;
  inList?: boolean;
  description?: string;
};
export type GroupDef = { slug: string; name: string; weight: number; leaves: LeafDef[] };
export type DomainDef = { slug: string; name: string; ringName: string; weight: number; groups: GroupDef[] };

const ts = (slug: string, name: string, weight: number, unit: string, extra: Partial<LeafDef> = {}): LeafDef => ({
  slug, name, weight, unit, dataType: 'time_series', minSpanDays: 90, freshnessDays: 14, method: 'device', enrichable: false,
  compCents: 0, deviceCostCents: 0, ...extra,
});
const st = (slug: string, name: string, weight: number, extra: Partial<LeafDef> = {}): LeafDef => ({
  slug, name, weight, dataType: 'structured', minSpanDays: 0, freshnessDays: null, method: 'ehr', enrichable: false,
  compCents: 0, deviceCostCents: 0, ...extra,
});
const file = (slug: string, name: string, weight: number, extra: Partial<LeafDef> = {}): LeafDef => ({
  slug, name, weight, dataType: 'file', minSpanDays: 0, freshnessDays: null, method: 'upload', enrichable: false,
  compCents: 0, deviceCostCents: 0, ...extra,
});
const lab = (slug: string, name: string, weight: number, unit: string, extra: Partial<LeafDef> = {}): LeafDef => ({
  slug, name, weight, unit, dataType: 'structured', minSpanDays: 0, freshnessDays: 180, method: 'lab', enrichable: false,
  compCents: 0, deviceCostCents: 0, ...extra,
});
const survey = (slug: string, name: string, weight: number, extra: Partial<LeafDef> = {}): LeafDef => ({
  slug, name, weight, dataType: 'structured', minSpanDays: 0, freshnessDays: 180, method: 'survey', enrichable: false,
  compCents: 4000, deviceCostCents: 0, ...extra,
});
const selfReport = (slug: string, name: string, weight: number, extra: Partial<LeafDef> = {}): LeafDef => ({
  slug, name, weight, dataType: 'structured', minSpanDays: 0, freshnessDays: 365, method: 'self_report', enrichable: false,
  compCents: 0, deviceCostCents: 0, ...extra,
});
/** Diagnosis reference concepts: weight 0, hidden from the list, used by the `condition` table and cohort criteria. */
const dx = (slug: string, name: string): LeafDef => st(slug, name, 0, { inList: false, method: 'ehr' });

export const ONTOLOGY: DomainDef[] = [
  {
    slug: 'demographics', name: 'Demographics', ringName: 'Demographics', weight: 0.04,
    groups: [
      { slug: 'demographics.basics', name: 'Basics', weight: 1, leaves: [
        st('demographics.basics.age', 'Age', 0.4, { unit: 'years' }),
        st('demographics.basics.sex', 'Sex', 0.3),
        st('demographics.basics.location', 'Location', 0.3),
      ] },
    ],
  },
  {
    slug: 'biology', name: 'Biology (Genomics)', ringName: 'Genomics', weight: 0.12,
    groups: [
      { slug: 'biology.genomics', name: 'Genomics', weight: 0.78, leaves: [
        file('biology.genomics.exome', 'Exome', 0.9, { method: 'kit', enrichable: true, compCents: 5000, deviceCostCents: 3600, description: 'Whole-exome sequencing (VCF)' }),
        st('biology.genomics.pharmacogenomics', 'Pharmacogenomics', 0.1, { method: 'derived' }),
      ] },
      { slug: 'biology.microbiome', name: 'Microbiome', weight: 0.22, leaves: [
        file('biology.microbiome.gut_microbiome', 'Gut microbiome', 1, { method: 'kit', enrichable: true, compCents: 9000, deviceCostCents: 6500, description: 'Stool kit → 16S/shotgun taxa' }),
      ] },
    ],
  },
  {
    slug: 'clinical', name: 'Clinical', ringName: 'Clinical', weight: 0.18,
    groups: [
      { slug: 'clinical.encounters', name: 'Encounters', weight: 0.25, leaves: [
        st('clinical.encounters.ehr_history', 'EHR history', 1, { minSpanDays: 365, freshnessDays: 365, description: 'Encounter history from connected medical records' }),
      ] },
      { slug: 'clinical.labs', name: 'Labs', weight: 0.3, leaves: [
        lab('clinical.labs.hba1c', 'HbA1c', 0.4, '%'),
        lab('clinical.labs.lipid_panel', 'Lipid panel', 0.3, 'mg/dL'),
        lab('clinical.labs.metabolic_panel', 'Metabolic panel', 0.2, 'mg/dL'),
        lab('clinical.labs.cbc', 'Complete blood count', 0.1, 'K/uL'),
      ] },
      { slug: 'clinical.diagnoses', name: 'Diagnoses', weight: 0.2, leaves: [
        st('clinical.diagnoses.problem_list', 'Problem list', 1),
        dx('clinical.diagnoses.type_2_diabetes', 'Type 2 diabetes'),
        dx('clinical.diagnoses.hypertension', 'Hypertension'),
        dx('clinical.diagnoses.hyperlipidemia', 'Hyperlipidemia'),
        dx('clinical.diagnoses.obesity', 'Obesity'),
        dx('clinical.diagnoses.asthma', 'Asthma'),
        dx('clinical.diagnoses.depression', 'Depression'),
        dx('clinical.diagnoses.ckd', 'Chronic kidney disease'),
        dx('clinical.diagnoses.coronary_artery_disease', 'Coronary artery disease'),
      ] },
      { slug: 'clinical.medications', name: 'Medications', weight: 0.15, leaves: [
        st('clinical.medications.medication_list', 'Medication list', 1),
        survey('clinical.medications.adherence', 'Medication adherence', 0, { inList: false, enrichable: true, compCents: 4000 }),
      ] },
      { slug: 'clinical.vitals', name: 'Vitals & preventive', weight: 0.1, leaves: [
        st('clinical.vitals.clinic_blood_pressure', 'Clinic blood pressure', 0.7, { unit: 'mmHg', freshnessDays: 365 }),
        st('clinical.vitals.immunizations', 'Immunizations', 0.3),
      ] },
    ],
  },
  {
    slug: 'physiology', name: 'Physiology', ringName: 'Physiology', weight: 0.2,
    groups: [
      { slug: 'physiology.cardiovascular', name: 'Cardiovascular', weight: 0.34, leaves: [
        ts('physiology.cardiovascular.heart_rate', 'Heart Rate', 0.27, 'bpm'),
        ts('physiology.cardiovascular.hrv', 'HRV', 0.27, 'ms'),
        ts('physiology.cardiovascular.blood_pressure', 'Blood Pressure', 0.37, 'mmHg', { enrichable: true, compCents: 11000, deviceCostCents: 2600, description: 'Home blood pressure (systolic/diastolic)' }),
        ts('physiology.cardiovascular.ecg', 'ECG', 0.09, 'mV'),
      ] },
      { slug: 'physiology.metabolic', name: 'Metabolic', weight: 0.15, leaves: [
        ts('physiology.metabolic.weight', 'Weight', 0.33, 'kg', { freshnessDays: 30 }),
        lab('physiology.metabolic.glucose', 'Glucose', 0.25, 'mg/dL', { freshnessDays: 365 }),
        ts('physiology.metabolic.cgm', 'CGM', 0.17, 'mg/dL', { minSpanDays: 14, enrichable: true, compCents: 30000, deviceCostCents: 9500, description: 'Continuous glucose monitor' }),
        st('physiology.metabolic.body_composition', 'Body Composition', 0.25, { unit: '%', freshnessDays: 365 }),
      ] },
      { slug: 'physiology.sleep', name: 'Sleep', weight: 0.26, leaves: [
        ts('physiology.sleep.sleep_duration', 'Sleep duration', 0.48, 'h'),
        ts('physiology.sleep.sleep_stages', 'Sleep stages', 0.48, 'min'),
        ts('physiology.sleep.spo2', 'Overnight SpO2', 0.04, '%'),
      ] },
      { slug: 'physiology.strength', name: 'Strength', weight: 0.05, leaves: [
        st('physiology.strength.grip_strength', 'Grip Strength', 0.76, { unit: 'kg', freshnessDays: 365, method: 'protocol', enrichable: true, compCents: 20000, deviceCostCents: 4500, description: 'Dynamometer, 3 trials × 2 hands' }),
        selfReport('physiology.strength.strength_training', 'Strength training', 0.24),
      ] },
      { slug: 'physiology.mobility', name: 'Mobility', weight: 0.2, leaves: [
        ts('physiology.mobility.steps', 'Steps', 0.5, 'steps'),
        ts('physiology.mobility.active_minutes', 'Active minutes', 0.32, 'min'),
        st('physiology.mobility.vo2max', 'VO2 max', 0.18, { unit: 'mL/kg/min', freshnessDays: 365 }),
      ] },
    ],
  },
  {
    slug: 'behavior', name: 'Behavior', ringName: 'Behavior', weight: 0.14,
    groups: [
      { slug: 'behavior.nutrition', name: 'Nutrition', weight: 0.35, leaves: [
        ts('behavior.nutrition.food_log', 'Food log', 0.7, 'kcal', { minSpanDays: 30, method: 'photo', enrichable: true, compCents: 5500, description: 'Meal photos → derived kcal / macros' }),
        selfReport('behavior.nutrition.dietary_pattern', 'Dietary pattern', 0.3),
      ] },
      { slug: 'behavior.physical_activity', name: 'Physical activity', weight: 0.3, leaves: [
        selfReport('behavior.physical_activity.exercise_log', 'Exercise log', 0.6),
        st('behavior.physical_activity.sedentary_time', 'Sedentary time', 0.4, { unit: 'h', method: 'device' }),
      ] },
      { slug: 'behavior.substance', name: 'Substance use', weight: 0.15, leaves: [
        st('behavior.substance.smoking_status', 'Smoking status', 0.4),
        selfReport('behavior.substance.alcohol_use', 'Alcohol use', 0.6),
      ] },
      { slug: 'behavior.stress', name: 'Stress & mood', weight: 0.2, leaves: [
        survey('behavior.stress.stress_survey', 'Stress survey', 0.45),
        st('behavior.stress.mood', 'Mood tracking', 0.55, { method: 'self_report' }),
      ] },
    ],
  },
  {
    slug: 'environment', name: 'Environment', ringName: 'Environment', weight: 0.1,
    groups: [
      { slug: 'environment.air_quality', name: 'Air quality', weight: 0.3, leaves: [
        ts('environment.air_quality.aqi_exposure', 'Air quality exposure', 1, 'AQI', { method: 'derived' }),
      ] },
      { slug: 'environment.residential', name: 'Residential', weight: 0.4, leaves: [
        selfReport('environment.residential.residential_history', 'Environmental history', 0.8, { enrichable: true, description: 'Residential and exposure history' }),
        st('environment.residential.noise_exposure', 'Noise exposure', 0.2, { unit: 'dB', method: 'derived' }),
      ] },
      { slug: 'environment.occupational', name: 'Occupational', weight: 0.3, leaves: [
        selfReport('environment.occupational.occupation', 'Occupation', 1),
      ] },
    ],
  },
  {
    slug: 'family', name: 'Family History', ringName: 'Family', weight: 0.08,
    groups: [
      { slug: 'family.history', name: 'Family history', weight: 0.65, leaves: [
        st('family.history.parental_conditions', 'Parental conditions', 0.6),
        selfReport('family.history.sibling_conditions', 'Sibling conditions', 0.4),
      ] },
      { slug: 'family.ancestry', name: 'Ancestry', weight: 0.35, leaves: [
        selfReport('family.ancestry.ancestry', 'Ancestry', 0.5),
        st('family.ancestry.longevity', 'Family longevity', 0.5, { method: 'self_report' }),
      ] },
    ],
  },
  {
    slug: 'outcomes', name: 'Outcomes', ringName: 'Outcomes', weight: 0.08,
    groups: [
      { slug: 'outcomes.patient_reported', name: 'Patient-reported', weight: 0.6, leaves: [
        survey('outcomes.patient_reported.quality_of_life', 'Quality of life', 0.5),
        survey('outcomes.patient_reported.symptom_survey', 'Symptom survey', 0.3),
        survey('outcomes.patient_reported.functional_status', 'Functional status', 0.2),
      ] },
      { slug: 'outcomes.clinical', name: 'Clinical outcomes', weight: 0.4, leaves: [
        st('outcomes.clinical.hospitalizations', 'Hospitalizations', 0.5),
        st('outcomes.clinical.complications', 'Complications review', 0.5, { freshnessDays: 365 }),
      ] },
    ],
  },
  {
    slug: 'imaging', name: 'Imaging', ringName: 'Imaging', weight: 0.06,
    groups: [
      { slug: 'imaging.mri', name: 'MRI', weight: 0.5, leaves: [
        file('imaging.mri.mri_musculoskeletal', 'MRI (musculoskeletal)', 0.6, { dataType: 'dicom' }),
        file('imaging.mri.mri_brain', 'MRI (brain)', 0.4, { dataType: 'dicom' }),
      ] },
      { slug: 'imaging.xray_ct', name: 'X-ray / CT', weight: 0.2, leaves: [
        file('imaging.xray_ct.chest_xray', 'Chest X-ray', 1, { dataType: 'dicom' }),
      ] },
      { slug: 'imaging.specialty', name: 'Specialty imaging', weight: 0.3, leaves: [
        file('imaging.specialty.retinal_scan', 'Retinal scan', 0.7, { dataType: 'file' }),
        file('imaging.specialty.dexa', 'DEXA scan', 0.3, { dataType: 'dicom' }),
      ] },
    ],
  },
];

export type FlatConcept = {
  slug: string; parentSlug: string | null; name: string; level: 'domain' | 'group' | 'leaf'; weight: number;
  unit: string | null; dataType: DataType | null; minSpanDays: number; freshnessDays: number | null; method: CollectionMethod | null;
  enrichable: boolean; compCents: number; deviceCostCents: number; inRing: boolean; inList: boolean; sortOrder: number; description: string | null;
};

/** Pre-order flattening (parents before children) for seeding. */
export function flattenOntology(): FlatConcept[] {
  const out: FlatConcept[] = [];
  let order = 0;
  for (const d of ONTOLOGY) {
    out.push({ slug: d.slug, parentSlug: null, name: d.name, level: 'domain', weight: d.weight, unit: null, dataType: null, minSpanDays: 0, freshnessDays: null, method: null, enrichable: false, compCents: 0, deviceCostCents: 0, inRing: true, inList: true, sortOrder: order++, description: null });
    for (const g of d.groups) {
      out.push({ slug: g.slug, parentSlug: d.slug, name: g.name, level: 'group', weight: g.weight, unit: null, dataType: null, minSpanDays: 0, freshnessDays: null, method: null, enrichable: false, compCents: 0, deviceCostCents: 0, inRing: false, inList: true, sortOrder: order++, description: null });
      for (const l of g.leaves) {
        out.push({ slug: l.slug, parentSlug: g.slug, name: l.name, level: 'leaf', weight: l.weight, unit: l.unit ?? null, dataType: l.dataType, minSpanDays: l.minSpanDays, freshnessDays: l.freshnessDays, method: l.method, enrichable: l.enrichable, compCents: l.compCents, deviceCostCents: l.deviceCostCents, inRing: false, inList: l.inList ?? l.weight > 0, sortOrder: order++, description: l.description ?? null });
      }
    }
  }
  return out;
}

export function leafDef(slug: string): LeafDef | undefined {
  for (const d of ONTOLOGY) for (const g of d.groups) for (const l of g.leaves) if (l.slug === slug) return l;
  return undefined;
}
export function domainOf(slug: string): string {
  return slug.split('.')[0];
}

/** Short display names used by the funnel / heatmap / matrix. */
export const SHORT_NAMES: Record<string, string> = {
  'clinical.encounters.ehr_history': 'EHR',
  'clinical.labs.hba1c': 'HbA1c',
  'clinical.labs.lipid_panel': 'Labs',
  'biology.genomics.exome': 'Exome',
  'physiology.cardiovascular.blood_pressure': 'BP',
  'behavior.nutrition.food_log': 'Nutrition',
  'physiology.metabolic.cgm': 'CGM',
  'imaging.mri.mri_musculoskeletal': 'Imaging',
  'biology.microbiome.gut_microbiome': 'Microbiome',
  'physiology.strength.grip_strength': 'Grip strength',
  'clinical.diagnoses.type_2_diabetes': 'Diabetes',
  'clinical.diagnoses.hypertension': 'Hypertension',
};
export function shortName(slug: string): string {
  return SHORT_NAMES[slug] ?? leafDef(slug)?.name ?? slug.split('.').pop() ?? slug;
}

/** B5 heatmap columns (any-data bars use the same list). */
export const HEATMAP_COLUMNS: { slug: string; label: string }[] = [
  { slug: 'clinical.encounters.ehr_history', label: 'EHR' },
  { slug: 'clinical.labs.lipid_panel', label: 'Labs' },
  { slug: 'biology.genomics.exome', label: 'Exome' },
  { slug: 'physiology.cardiovascular.blood_pressure', label: 'BP' },
  { slug: 'behavior.nutrition.food_log', label: 'Diet' },
  { slug: 'physiology.metabolic.cgm', label: 'CGM' },
  { slug: 'imaging.mri.mri_musculoskeletal', label: 'Imaging' },
];

/** Default B6 expansion campaign over the B2 cohort: reuse EHR, collect exome / BP / nutrition where missing. */
export const DEFAULT_CAMPAIGN_VARIABLES: CampaignVariable[] = [
  { conceptSlug: 'clinical.encounters.ehr_history', mode: 'reuse', requirement: { historical: { minSpanDays: 365 * 3, minProvRank: 4 } }, compCents: 0, deviceCostCents: 0 },
  { conceptSlug: 'biology.genomics.exome', mode: 'collect_if_missing', requirement: { historical: { minSpanDays: 0, minProvRank: 3 }, protocol: { method: 'kit', durationDays: 1, minProvRank: 3 } }, compCents: 5000, deviceCostCents: 3600 },
  { conceptSlug: 'physiology.cardiovascular.blood_pressure', mode: 'collect_if_missing', requirement: { historical: { minSpanDays: 365, minProvRank: 3 }, protocol: { method: 'device', durationDays: 14, device: 'Omron BP7450', minProvRank: 3 } }, compCents: 11000, deviceCostCents: 2600 },
  { conceptSlug: 'behavior.nutrition.food_log', mode: 'collect_if_missing', requirement: { historical: { minSpanDays: 30, minProvRank: 2 }, protocol: { method: 'photo', durationDays: 7, minProvRank: 2 } }, compCents: 5500, deviceCostCents: 0 },
];

/** Fixed participant red-lines (not editable in the model; see README). */
export const PROHIBITED_USES: { key: string; label: string }[] = [
  { key: 'advertising', label: 'Advertising or marketing targeting' },
  { key: 'insurance_underwriting', label: 'Insurance underwriting or pricing' },
  { key: 'employment_screening', label: 'Employment decisions or screening' },
  { key: 'law_enforcement', label: 'Law-enforcement or immigration use' },
  { key: 're_identification', label: 'Re-identification attempts' },
  { key: 'data_brokerage', label: 'Resale to data brokers' },
  { key: 'credit_scoring', label: 'Credit or lending decisions' },
];
export const PROHIBITED_USE_KEYS = PROHIBITED_USES.map((p) => p.key);
