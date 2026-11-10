// Canonical concept tree ("personal health graph" ontology). Nine domains → groups → leaves.
// Weights are explicit decimals at every level (children of a node sum to 1; a leaf with weight 0 is a
// reference concept — e.g. a diagnosis used by the cohort builder — and does not count toward completeness
// nor appear in the signature list). The seed writes this tree into the `concept` table; services read the DB.
//
// Completeness: leaf score = 1 (verified) / 0.5 (partial) / 0 (missing); group % = Σ weight × score;
// domain % = Σ group weight × group %; overall = Σ domain weight × domain %.
import type { CampaignVariable } from './requirement';
import type { FollowUp, ValueKind } from './api-types';

export type { ValueKind, FollowUp };
/** A follow-up with the aliases the rule classifier uses to resolve an option from free text ("latte" → coffee). */
export type FollowUpDef = FollowUp & { aliases?: Record<string, string[]>; /** free-text values the rules recognise as (new) variant values when the user does not pick an option */ knownValues?: string[] };
export type ContextName = 'rest' | 'exercise' | 'sleep';
/** Continuous leaves that must be bucketed by context: keyword → context; `alsoFile` files a second observation on that leaf for the exercise context. */
export type ContextRule = { attribute: 'context'; rules: { context: ContextName; keywords: string[] }[]; default: ContextName; alsoFile?: { context: ContextName; slug: string } };

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
  /** License (reuse) fee in net cents when a campaign REUSES existing data for this leaf; defaults to ≈ 15 % of compCents, min 300¢. */
  reuseCompCents?: number;
  inList?: boolean;
  description?: string;
  /** How values behave (ingestion + rendering). Defaults from dataType/method via `inferValueKind`. */
  valueKind?: ValueKind;
  /** Keywords for the rule classifier (quick logs, check-ins, file names). Lower-case; multi-word phrases allowed. */
  synonyms?: string[];
  /** Categorical leaves: the attribute to ask for; answers outside the options create a variant sub-branch. */
  followUps?: FollowUpDef[];
  contextRule?: ContextRule;
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
/** Quick-log leaves added for the 2026-11-10 notes: weight 0 (completeness and the seeded population counts are unchanged), listed in the tree. */
const logged = (slug: string, name: string, valueKind: ValueKind, extra: Partial<LeafDef> = {}): LeafDef => ({
  slug, name, weight: 0, dataType: 'structured', minSpanDays: 0, freshnessDays: 30, method: 'self_report', enrichable: false,
  compCents: 0, deviceCostCents: 0, inList: true, valueKind, ...extra,
});

export const ONTOLOGY: DomainDef[] = [
  {
    slug: 'demographics', name: 'Demographics', ringName: 'Demographics', weight: 0.04,
    groups: [
      { slug: 'demographics.basics', name: 'Basics', weight: 1, leaves: [
        st('demographics.basics.age', 'Age', 0.4, { unit: 'years', valueKind: 'one_time', synonyms: ['age', 'years old', 'birthday', 'born in'] }),
        st('demographics.basics.sex', 'Sex', 0.3, { valueKind: 'one_time', synonyms: ['sex', 'gender', 'male', 'female'] }),
        st('demographics.basics.location', 'Location', 0.3, { valueKind: 'one_time', synonyms: ['location', 'moved to', 'live in', 'zip code', 'city'] }),
      ] },
    ],
  },
  {
    slug: 'biology', name: 'Biology (Genomics)', ringName: 'Genomics', weight: 0.12,
    groups: [
      { slug: 'biology.genomics', name: 'Genomics', weight: 0.78, leaves: [
        file('biology.genomics.exome', 'Exome', 0.9, { method: 'kit', enrichable: true, compCents: 5000, deviceCostCents: 3600, reuseCompCents: 2000, description: 'Whole-exome sequencing (VCF)', valueKind: 'file', synonyms: ['exome', 'vcf', 'sequencing', 'wes', 'variants', 'dna test'] }),
        st('biology.genomics.pharmacogenomics', 'Pharmacogenomics', 0.1, { method: 'derived', valueKind: 'one_time', synonyms: ['pharmacogenomics', 'pgx', 'cyp2c9', 'cyp2d6', 'metabolizer'] }),
      ] },
      { slug: 'biology.microbiome', name: 'Microbiome', weight: 0.22, leaves: [
        file('biology.microbiome.gut_microbiome', 'Gut microbiome', 1, { method: 'kit', enrichable: true, compCents: 9000, deviceCostCents: 6500, description: 'Stool kit → 16S/shotgun taxa', valueKind: 'file', synonyms: ['microbiome', 'stool', 'gut', '16s', 'taxa'] }),
      ] },
    ],
  },
  {
    slug: 'clinical', name: 'Clinical', ringName: 'Clinical', weight: 0.18,
    groups: [
      { slug: 'clinical.encounters', name: 'Encounters', weight: 0.25, leaves: [
        st('clinical.encounters.ehr_history', 'EHR history', 1, { minSpanDays: 365, freshnessDays: 365, reuseCompCents: 1200, description: 'Encounter history from connected medical records', valueKind: 'text', synonyms: ['doctor visit', 'saw my doctor', 'appointment', 'clinic visit', 'telehealth', 'physical', 'encounter', 'er visit', 'urgent care'] }),
        file('clinical.encounters.document', 'Clinical document', 0, { inList: true, valueKind: 'file', freshnessDays: null, synonyms: ['document', 'letter', 'referral', 'discharge summary', 'clinical note', 'report'], description: 'Uploaded clinical documents that are not lab reports' }),
      ] },
      { slug: 'clinical.labs', name: 'Labs', weight: 0.3, leaves: [
        lab('clinical.labs.hba1c', 'HbA1c', 0.4, '%', { reuseCompCents: 500, valueKind: 'float', synonyms: ['hba1c', 'a1c', 'glycated hemoglobin', 'glycated haemoglobin'] }),
        lab('clinical.labs.lipid_panel', 'Lipid panel', 0.3, 'mg/dL', { reuseCompCents: 500, valueKind: 'float', synonyms: ['lipid panel', 'lipids', 'ldl', 'hdl', 'cholesterol', 'triglycerides'] }),
        lab('clinical.labs.metabolic_panel', 'Metabolic panel', 0.2, 'mg/dL', { valueKind: 'float', synonyms: ['metabolic panel', 'cmp', 'bmp', 'creatinine', 'potassium', 'sodium', 'egfr', 'kidney function', 'liver function'] }),
        lab('clinical.labs.cbc', 'Complete blood count', 0.1, 'K/uL', { valueKind: 'float', synonyms: ['cbc', 'blood count', 'hemoglobin', 'haemoglobin', 'white cells', 'platelets'] }),
      ] },
      { slug: 'clinical.diagnoses', name: 'Diagnoses', weight: 0.2, leaves: [
        st('clinical.diagnoses.problem_list', 'Problem list', 1, { valueKind: 'text', synonyms: ['diagnosed', 'diagnosis', 'problem list', 'condition'] }),
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
        st('clinical.medications.medication_list', 'Medication list', 1, { reuseCompCents: 400, valueKind: 'one_time', synonyms: ['medication list', 'prescribed', 'new prescription', 'started taking', 'stopped taking', 'dose changed', 'mg daily'] }),
        survey('clinical.medications.adherence', 'Medication adherence', 0, { inList: false, enrichable: true, compCents: 4000, valueKind: 'text', synonyms: ['adherence survey'] }),
        logged('clinical.medications.adherence_today', 'Medications taken today', 'boolean', { synonyms: ['took my meds', 'took my medication', 'took my pills', 'meds', 'medication', 'pills', 'metformin', 'lisinopril', 'atorvastatin', 'statin', 'dose'], description: 'Daily yes/no: did you take your medications?' }),
      ] },
      { slug: 'clinical.vitals', name: 'Vitals & preventive', weight: 0.1, leaves: [
        st('clinical.vitals.clinic_blood_pressure', 'Clinic blood pressure', 0.7, { unit: 'mmHg', freshnessDays: 365, valueKind: 'float', synonyms: ['clinic blood pressure', 'at the clinic', 'at the doctor', 'nurse took my blood pressure', 'office bp'] }),
        st('clinical.vitals.immunizations', 'Immunizations', 0.3, { valueKind: 'text', synonyms: ['vaccine', 'vaccination', 'immunization', 'flu shot', 'booster', 'jab'] }),
      ] },
    ],
  },
  {
    slug: 'physiology', name: 'Physiology', ringName: 'Physiology', weight: 0.2,
    groups: [
      { slug: 'physiology.cardiovascular', name: 'Cardiovascular', weight: 0.34, leaves: [
        ts('physiology.cardiovascular.heart_rate', 'Heart Rate', 0.27, 'bpm', {
          valueKind: 'continuous', synonyms: ['heart rate', 'hr', 'pulse', 'bpm', 'resting heart rate', 'resting hr'],
          contextRule: { attribute: 'context', default: 'rest', rules: [
            { context: 'exercise', keywords: ['run', 'ran', 'running', 'jog', 'workout', 'gym', 'exercise', 'training', 'cycling', 'bike', 'ride', 'swim', 'hiit', 'climb'] },
            { context: 'sleep', keywords: ['sleeping', 'asleep', 'overnight', 'while i slept', 'in bed', 'night'] },
          ], alsoFile: { context: 'exercise', slug: 'behavior.exercise.session' } },
        }),
        ts('physiology.cardiovascular.hrv', 'HRV', 0.27, 'ms', { valueKind: 'continuous', synonyms: ['hrv', 'heart rate variability', 'sdnn', 'rmssd'] }),
        ts('physiology.cardiovascular.blood_pressure', 'Blood Pressure', 0.37, 'mmHg', { enrichable: true, compCents: 11000, deviceCostCents: 2600, reuseCompCents: 1400, description: 'Home blood pressure (systolic/diastolic)', valueKind: 'continuous', synonyms: ['bp', 'blood pressure', 'systolic', 'diastolic', 'cuff', 'omron', 'mmhg'] }),
        ts('physiology.cardiovascular.ecg', 'ECG', 0.09, 'mV', { valueKind: 'continuous', synonyms: ['ecg', 'ekg', 'electrocardiogram', 'afib', 'arrhythmia'] }),
      ] },
      { slug: 'physiology.metabolic', name: 'Metabolic', weight: 0.15, leaves: [
        ts('physiology.metabolic.weight', 'Weight', 0.33, 'kg', { freshnessDays: 30, valueKind: 'continuous', synonyms: ['weight', 'weighed', 'weigh', 'scale', 'kg', 'lb', 'lbs', 'pounds', 'kilos'] }),
        lab('physiology.metabolic.glucose', 'Glucose', 0.25, 'mg/dL', { freshnessDays: 365, valueKind: 'continuous', synonyms: ['glucose', 'blood sugar', 'sugar', 'fasting glucose', 'mg/dl', 'mmol', 'finger prick', 'glucometer'] }),
        ts('physiology.metabolic.cgm', 'CGM', 0.17, 'mg/dL', { minSpanDays: 14, enrichable: true, compCents: 30000, deviceCostCents: 9500, description: 'Continuous glucose monitor', valueKind: 'continuous', synonyms: ['cgm', 'dexcom', 'libre', 'continuous glucose', 'sensor glucose'] }),
        st('physiology.metabolic.body_composition', 'Body Composition', 0.25, { unit: '%', freshnessDays: 365, valueKind: 'float', synonyms: ['body fat', 'body composition', 'lean mass', 'muscle mass', 'bmi', 'waist'] }),
      ] },
      { slug: 'physiology.sleep', name: 'Sleep', weight: 0.26, leaves: [
        ts('physiology.sleep.sleep_duration', 'Sleep duration', 0.48, 'h', { valueKind: 'continuous', synonyms: ['sleep', 'slept', 'hours of sleep', 'sleep duration', 'nap', 'napped', 'insomnia'] }),
        ts('physiology.sleep.sleep_stages', 'Sleep stages', 0.48, 'min', { valueKind: 'continuous', synonyms: ['sleep stages', 'deep sleep', 'rem', 'light sleep', 'rem sleep'] }),
        ts('physiology.sleep.spo2', 'Overnight SpO2', 0.04, '%', { valueKind: 'continuous', synonyms: ['spo2', 'oxygen saturation', 'blood oxygen', 'oxygen', 'pulse ox'] }),
      ] },
      { slug: 'physiology.strength', name: 'Strength', weight: 0.05, leaves: [
        st('physiology.strength.grip_strength', 'Grip Strength', 0.76, { unit: 'kg', freshnessDays: 365, method: 'protocol', enrichable: true, compCents: 20000, deviceCostCents: 4500, description: 'Dynamometer, 3 trials × 2 hands', valueKind: 'float', synonyms: ['grip strength', 'grip', 'dynamometer', 'handgrip'] }),
        selfReport('physiology.strength.strength_training', 'Strength training', 0.24, { valueKind: 'float', unit: 'sessions', synonyms: ['strength training', 'lifted', 'lifting', 'weights', 'resistance training', 'deadlift', 'squats', 'bench press'] }),
      ] },
      { slug: 'physiology.mobility', name: 'Mobility', weight: 0.2, leaves: [
        ts('physiology.mobility.steps', 'Steps', 0.5, 'steps', { valueKind: 'continuous', synonyms: ['steps', 'step count', 'walked', 'walk', 'pedometer'] }),
        ts('physiology.mobility.active_minutes', 'Active minutes', 0.32, 'min', { valueKind: 'continuous', synonyms: ['active minutes', 'activity minutes', 'move minutes', 'exercise minutes'] }),
        st('physiology.mobility.vo2max', 'VO2 max', 0.18, { unit: 'mL/kg/min', freshnessDays: 365, valueKind: 'float', synonyms: ['vo2 max', 'vo2max', 'cardio fitness', 'aerobic capacity'] }),
      ] },
    ],
  },
  {
    slug: 'behavior', name: 'Behavior', ringName: 'Behavior', weight: 0.14,
    groups: [
      { slug: 'behavior.nutrition', name: 'Nutrition', weight: 0.35, leaves: [
        ts('behavior.nutrition.food_log', 'Food log', 0.7, 'kcal', { minSpanDays: 30, method: 'photo', enrichable: true, compCents: 5500, description: 'Meal photos → derived kcal / macros', valueKind: 'photo', synonyms: ['ate', 'eating', 'meal', 'lunch', 'dinner', 'breakfast', 'snack', 'food', 'salad', 'sandwich', 'pizza', 'calories', 'kcal', 'dessert', 'bowl', 'soup'] }),
        selfReport('behavior.nutrition.dietary_pattern', 'Dietary pattern', 0.3, { valueKind: 'one_time', synonyms: ['diet', 'dietary pattern', 'vegetarian', 'vegan', 'keto', 'mediterranean', 'intermittent fasting', 'low carb'] }),
        logged('behavior.nutrition.caffeine', 'Caffeine', 'categorical', {
          unit: 'drinks', synonyms: ['caffeine', 'coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'cold brew', 'tea', 'matcha', 'chai', 'energy drink', 'red bull', 'monster', 'yerba mate', 'mate'],
          followUps: [{ attribute: 'drink', question: 'What did you drink?', options: ['coffee', 'tea', 'energy drink'], createsSubBranch: true,
            aliases: { coffee: ['coffee', 'latte', 'cappuccino', 'americano', 'flat white', 'cold brew', 'macchiato', 'mocha'], tea: ['tea', 'chai', 'green tea', 'black tea', 'earl grey'], 'energy drink': ['energy drink', 'red bull', 'monster', 'celsius'] },
            knownValues: ['espresso', 'matcha', 'yerba mate', 'decaf', 'kombucha'] }],
          description: 'Caffeinated drinks; the drink is a sub-branch (variant)',
        }),
      ] },
      { slug: 'behavior.physical_activity', name: 'Physical activity', weight: 0.3, leaves: [
        selfReport('behavior.physical_activity.exercise_log', 'Exercise log', 0.6, { valueKind: 'float', unit: 'sessions', synonyms: ['exercise log', 'sessions this week', 'weekly exercise', 'times this week'] }),
        st('behavior.physical_activity.sedentary_time', 'Sedentary time', 0.4, { unit: 'h', method: 'device', valueKind: 'continuous', synonyms: ['sedentary', 'sitting', 'sat all day', 'desk time', 'screen time'] }),
      ] },
      { slug: 'behavior.exercise', name: 'Exercise', weight: 0, leaves: [
        logged('behavior.exercise.session', 'Exercise session', 'categorical', {
          unit: 'min', synonyms: ['ran', 'run', 'running', 'jog', 'jogged', 'workout', 'worked out', 'gym', 'exercise', 'exercised', 'training', 'cycled', 'cycling', 'bike ride', 'biked', 'swim', 'swam', 'swimming', 'yoga', 'pilates', 'hike', 'hiked', 'hiit', 'spin class', 'tennis', 'climbing', '5k', '10k'],
          followUps: [{ attribute: 'activity', question: 'What kind of exercise?', options: ['run', 'walk', 'cycle', 'swim', 'gym', 'yoga'], createsSubBranch: true,
            aliases: { run: ['ran', 'run', 'running', 'jog', 'jogged', 'jogging', '5k', '10k', 'marathon'], walk: ['walk', 'walked', 'walking', 'hike', 'hiked', 'hiking'], cycle: ['cycle', 'cycled', 'cycling', 'bike', 'biked', 'bike ride', 'spin class', 'peloton'], swim: ['swim', 'swam', 'swimming', 'laps'], gym: ['gym', 'workout', 'worked out', 'weights', 'lifted', 'lifting', 'hiit', 'crossfit', 'training'], yoga: ['yoga', 'pilates', 'stretching'] },
            knownValues: ['tennis', 'climbing', 'rowing', 'football', 'soccer', 'basketball', 'dance'] }],
          description: 'One logged exercise session; the activity is a sub-branch (variant)',
        }),
      ] },
      { slug: 'behavior.substance', name: 'Substance use', weight: 0.15, leaves: [
        st('behavior.substance.smoking_status', 'Smoking status', 0.4, { valueKind: 'one_time', synonyms: ['smoking status', 'never smoker', 'former smoker', 'quit smoking', 'ex-smoker', 'current smoker'] }),
        selfReport('behavior.substance.alcohol_use', 'Alcohol use', 0.6, { valueKind: 'text', unit: 'drinks', synonyms: ['alcohol', 'drinks', 'drink', 'beer', 'beers', 'wine', 'glass of wine', 'cocktail', 'whisky', 'whiskey', 'vodka', 'drank', 'drinking'] }),
      ] },
      { slug: 'behavior.tobacco', name: 'Tobacco', weight: 0, leaves: [
        logged('behavior.tobacco.cigarettes', 'Cigarettes', 'categorical', {
          unit: 'cigarettes', synonyms: ['smoked', 'smoke', 'smoking', 'cigarette', 'cigarettes', 'cig', 'cigs', 'tobacco', 'vape', 'vaped', 'nicotine', 'pack'],
          followUps: [{ attribute: 'brand', question: 'What brand?', createsSubBranch: true,
            knownValues: ['marlboro', 'camel', 'lucky strike', 'newport', 'winston', 'pall mall', 'american spirit', 'parliament', 'dunhill', 'benson & hedges', 'rothmans', 'gauloises', 'juul', 'vuse'] }],
          description: 'Cigarettes smoked; the brand is a sub-branch (variant)',
        }),
      ] },
      { slug: 'behavior.stress', name: 'Stress & mood', weight: 0.2, leaves: [
        survey('behavior.stress.stress_survey', 'Stress survey', 0.45, { valueKind: 'text', synonyms: ['stress survey', 'pss', 'perceived stress'] }),
        st('behavior.stress.mood', 'Mood tracking', 0.55, { method: 'self_report', valueKind: 'text', synonyms: ['stressed', 'stress', 'anxious', 'anxiety', 'overwhelmed', 'calm', 'relaxed'] }),
      ] },
      { slug: 'behavior.mood', name: 'Mood', weight: 0, leaves: [
        logged('behavior.mood.daily_mood', 'Daily mood', 'categorical', {
          unit: '1-5', synonyms: ['mood', 'feeling', 'feel', 'felt', 'happy', 'sad', 'low', 'down', 'great', 'terrible', 'irritable', 'energetic'],
          followUps: [{ attribute: 'score', question: 'How would you rate your mood, 1 (worst) to 5 (best)?', options: ['1', '2', '3', '4', '5'], createsSubBranch: false,
            aliases: { '1': ['terrible', 'awful', 'worst'], '2': ['low', 'down', 'sad', 'bad', 'meh'], '3': ['ok', 'okay', 'fine', 'neutral', 'so-so'], '4': ['good', 'happy', 'pretty good', 'well'], '5': ['great', 'amazing', 'fantastic', 'excellent', 'best'] } }],
          description: 'Daily mood on a 1–5 scale',
        }),
      ] },
      { slug: 'behavior.sleep', name: 'Sleep habits', weight: 0, leaves: [
        logged('behavior.sleep.bedtime_log', 'Bedtime', 'continuous', { unit: 'h', freshnessDays: 14, synonyms: ['bedtime', 'went to bed', 'in bed by', 'bed at', 'lights out', 'fell asleep at'], description: 'Time of going to bed (hour of day, one row per night)' }),
      ] },
    ],
  },
  {
    slug: 'environment', name: 'Environment', ringName: 'Environment', weight: 0.1,
    groups: [
      { slug: 'environment.air_quality', name: 'Air quality', weight: 0.3, leaves: [
        ts('environment.air_quality.aqi_exposure', 'Air quality exposure', 1, 'AQI', { method: 'derived', valueKind: 'continuous', synonyms: ['air quality', 'aqi', 'smoke outside', 'wildfire smoke', 'pollution', 'pm2.5'] }),
      ] },
      { slug: 'environment.residential', name: 'Residential', weight: 0.4, leaves: [
        selfReport('environment.residential.residential_history', 'Environmental history', 0.8, { enrichable: true, description: 'Residential and exposure history', valueKind: 'one_time', synonyms: ['residential history', 'lived in', 'moved', 'home address', 'exposure history', 'mold', 'lead pipes'] }),
        st('environment.residential.noise_exposure', 'Noise exposure', 0.2, { unit: 'dB', method: 'derived', valueKind: 'continuous', synonyms: ['noise', 'loud', 'decibel', 'db'] }),
      ] },
      { slug: 'environment.occupational', name: 'Occupational', weight: 0.3, leaves: [
        selfReport('environment.occupational.occupation', 'Occupation', 1, { valueKind: 'one_time', synonyms: ['occupation', 'job', 'work as', 'new job', 'employer', 'shift work', 'night shift'] }),
      ] },
    ],
  },
  {
    slug: 'family', name: 'Family History', ringName: 'Family', weight: 0.08,
    groups: [
      { slug: 'family.history', name: 'Family history', weight: 0.65, leaves: [
        st('family.history.parental_conditions', 'Parental conditions', 0.6, { valueKind: 'one_time', synonyms: ['parental conditions', 'parents'] }),
        selfReport('family.history.sibling_conditions', 'Sibling conditions', 0.4, { valueKind: 'one_time', synonyms: ['sibling', 'sister', 'brother'] }),
        logged('family.history.conditions', 'Family conditions', 'one_time', { freshnessDays: null, synonyms: ['family history', 'my father', 'my mother', 'my dad', 'my mom', 'my mum', 'grandfather', 'grandmother', 'grandpa', 'grandma', 'uncle', 'aunt', 'runs in the family', 'heart attack at', 'had cancer', 'had diabetes'], description: 'Conditions reported for relatives (updatable fact: new rows append, old rows keep valid_to)' }),
      ] },
      { slug: 'family.ancestry', name: 'Ancestry', weight: 0.35, leaves: [
        selfReport('family.ancestry.ancestry', 'Ancestry', 0.5, { valueKind: 'one_time', synonyms: ['ancestry', 'ethnicity', 'heritage', 'descent'] }),
        st('family.ancestry.longevity', 'Family longevity', 0.5, { method: 'self_report', valueKind: 'one_time', synonyms: ['longevity', 'lived to', 'died at', 'passed away at'] }),
      ] },
    ],
  },
  {
    slug: 'outcomes', name: 'Outcomes', ringName: 'Outcomes', weight: 0.08,
    groups: [
      { slug: 'outcomes.patient_reported', name: 'Patient-reported', weight: 0.6, leaves: [
        survey('outcomes.patient_reported.quality_of_life', 'Quality of life', 0.5, { valueKind: 'text', synonyms: ['quality of life', 'qol', 'sf-36', 'eq-5d'] }),
        survey('outcomes.patient_reported.symptom_survey', 'Symptom survey', 0.3, { valueKind: 'text', synonyms: ['symptom', 'symptoms', 'headache', 'migraine', 'nausea', 'dizzy', 'dizziness', 'fatigue', 'tired', 'pain', 'sore throat', 'cough', 'fever'] }),
        survey('outcomes.patient_reported.functional_status', 'Functional status', 0.2, { valueKind: 'text', synonyms: ['functional status', 'daily activities', 'mobility limits', 'can\'t climb stairs'] }),
      ] },
      { slug: 'outcomes.clinical', name: 'Clinical outcomes', weight: 0.4, leaves: [
        st('outcomes.clinical.hospitalizations', 'Hospitalizations', 0.5, { valueKind: 'text', synonyms: ['hospital', 'hospitalized', 'hospitalised', 'admitted', 'emergency room', 'er', 'surgery', 'operation'] }),
        st('outcomes.clinical.complications', 'Complications review', 0.5, { freshnessDays: 365, valueKind: 'text', synonyms: ['complications', 'retinopathy', 'neuropathy', 'nephropathy', 'complications review'] }),
      ] },
    ],
  },
  {
    slug: 'imaging', name: 'Imaging', ringName: 'Imaging', weight: 0.06,
    groups: [
      { slug: 'imaging.mri', name: 'MRI', weight: 0.5, leaves: [
        file('imaging.mri.mri_musculoskeletal', 'MRI (musculoskeletal)', 0.6, { dataType: 'dicom', reuseCompCents: 800, valueKind: 'file', synonyms: ['mri', 'knee', 'shoulder', 'hip', 'spine', 'back', 'ankle', 'wrist', 'musculoskeletal', 'msk', 'meniscus', 'acl'] }),
        file('imaging.mri.mri_brain', 'MRI (brain)', 0.4, { dataType: 'dicom', valueKind: 'file', synonyms: ['mri', 'brain', 'head', 'neuro', 'cranial'] }),
      ] },
      { slug: 'imaging.xray_ct', name: 'X-ray / CT', weight: 0.2, leaves: [
        file('imaging.xray_ct.chest_xray', 'Chest X-ray', 1, { dataType: 'dicom', valueKind: 'file', synonyms: ['x-ray', 'xray', 'chest', 'ct', 'ct scan', 'radiograph', 'lung'] }),
      ] },
      { slug: 'imaging.specialty', name: 'Specialty imaging', weight: 0.3, leaves: [
        file('imaging.specialty.retinal_scan', 'Retinal scan', 0.7, { dataType: 'file', valueKind: 'file', synonyms: ['retinal', 'retina', 'eye exam', 'fundus', 'oct scan'] }),
        file('imaging.specialty.dexa', 'DEXA scan', 0.3, { dataType: 'dicom', valueKind: 'file', synonyms: ['dexa', 'dxa', 'bone density', 'bone scan'] }),
      ] },
    ],
  },
];

export type FlatConcept = {
  slug: string; parentSlug: string | null; name: string; level: 'domain' | 'group' | 'leaf'; weight: number;
  unit: string | null; dataType: DataType | null; minSpanDays: number; freshnessDays: number | null; method: CollectionMethod | null;
  enrichable: boolean; compCents: number; deviceCostCents: number; reuseCompCents: number; inRing: boolean; inList: boolean; sortOrder: number; description: string | null;
  valueKind: ValueKind | null; synonyms: string[]; followUps: FollowUpDef[] | null; contextRule: ContextRule | null;
};

/** Value kind of a leaf: explicit, else inferred from how it is collected. */
export function inferValueKind(l: Pick<LeafDef, 'valueKind' | 'dataType' | 'method' | 'unit'>): ValueKind {
  if (l.valueKind) return l.valueKind;
  if (l.dataType === 'time_series') return 'continuous';
  if (l.dataType === 'file' || l.dataType === 'dicom') return 'file';
  if (l.method === 'photo') return 'photo';
  if (l.method === 'lab') return 'float';
  if (l.method === 'survey') return 'text';
  return l.unit ? 'float' : 'text';
}
/** Slug of a variant (sub-branch) under a leaf: `<leaf>.<attribute>.<value-slug>`. */
export function variantSlug(leafSlug: string, attribute: string, value: string): string {
  return `${leafSlug}.${slugifyValue(attribute)}.${slugifyValue(value)}`;
}
export function slugifyValue(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'value';
}

/** Reuse (license) fee for a leaf: the explicit `reuseCompCents`, else ≈ 15 % of the collection comp with a 300¢ floor. */
export function reuseFeeFor(l: Pick<LeafDef, 'compCents' | 'reuseCompCents'>): number {
  if (typeof l.reuseCompCents === 'number' && Number.isFinite(l.reuseCompCents)) return Math.max(0, Math.round(l.reuseCompCents));
  return Math.max(300, Math.round(l.compCents * 0.15));
}
/** Domains drawn in the P1 ring: every domain except Demographics (it stays in the P2 list). */
export const RING_EXCLUDED_DOMAINS = new Set(['demographics']);

/** Pre-order flattening (parents before children) for seeding. */
export function flattenOntology(): FlatConcept[] {
  const out: FlatConcept[] = [];
  let order = 0;
  for (const d of ONTOLOGY) {
    out.push({ slug: d.slug, parentSlug: null, name: d.name, level: 'domain', weight: d.weight, unit: null, dataType: null, minSpanDays: 0, freshnessDays: null, method: null, enrichable: false, compCents: 0, deviceCostCents: 0, reuseCompCents: 0, inRing: !RING_EXCLUDED_DOMAINS.has(d.slug), inList: true, sortOrder: order++, description: null, valueKind: null, synonyms: [], followUps: null, contextRule: null });
    for (const g of d.groups) {
      out.push({ slug: g.slug, parentSlug: d.slug, name: g.name, level: 'group', weight: g.weight, unit: null, dataType: null, minSpanDays: 0, freshnessDays: null, method: null, enrichable: false, compCents: 0, deviceCostCents: 0, reuseCompCents: 0, inRing: false, inList: true, sortOrder: order++, description: null, valueKind: null, synonyms: [], followUps: null, contextRule: null });
      for (const l of g.leaves) {
        out.push({ slug: l.slug, parentSlug: g.slug, name: l.name, level: 'leaf', weight: l.weight, unit: l.unit ?? null, dataType: l.dataType, minSpanDays: l.minSpanDays, freshnessDays: l.freshnessDays, method: l.method, enrichable: l.enrichable, compCents: l.compCents, deviceCostCents: l.deviceCostCents, reuseCompCents: reuseFeeFor(l), inRing: false, inList: l.inList ?? l.weight > 0, sortOrder: order++, description: l.description ?? null,
          valueKind: inferValueKind(l), synonyms: l.synonyms ?? [], followUps: l.followUps ?? null, contextRule: l.contextRule ?? null });
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

/** Default B6 expansion campaign over the B2 cohort: reuse EHR (license fee = its reuse fee), collect exome / BP / nutrition where missing. */
export const DEFAULT_CAMPAIGN_VARIABLES: CampaignVariable[] = [
  { conceptSlug: 'clinical.encounters.ehr_history', mode: 'reuse', requirement: { historical: { minSpanDays: 365 * 3, minProvRank: 4 } }, compCents: reuseFeeFor(leafDef('clinical.encounters.ehr_history')!), deviceCostCents: 0 },
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
