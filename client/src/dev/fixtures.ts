// DEV-ONLY FIXTURES for /dev/gallery. These sample numbers exist solely so components can be rendered and screenshotted
// without the API. They are never imported by any production page; every real screen gets its numbers from the API.
import type {
  RingNode, TreeNode, NodeDetail, TimelineEvent, ParticipantTimeline, LineageStep, FunnelStage, CohortPreview, OpportunityDetail,
  LedgerRow, DemoState, Health, ActivityItem,
} from '@shared/api-types';
import { DEMO_TODAY, DEMO_NOW, addDays, addMonths, hoursAgo, relative } from '@shared/clock';
import { Rng } from '@shared/rng';

const leaf = (slug: string, name: string, state: TreeNode['state'], overlay: Partial<TreeNode['overlay']> = {}): TreeNode => ({
  slug, name, level: 'leaf', pct: state === 'verified' ? 100 : state === 'partial' ? 50 : 0, state,
  overlay: { opportunity: false, demand: false, ...overlay }, inRing: false, inList: true, children: [],
});
const group = (slug: string, name: string, pct: number, children: TreeNode[]): TreeNode => ({
  slug, name, level: 'group', pct, state: pct >= 80 ? 'verified' : pct > 0 ? 'partial' : 'missing',
  overlay: { opportunity: children.some((c) => c.overlay.opportunity), demand: false }, inRing: false, inList: true, children,
});
const domain = (slug: string, name: string, pct: number, children: TreeNode[] = []): TreeNode => ({
  slug, name, level: 'domain', pct, state: pct >= 80 ? 'verified' : pct > 0 ? 'partial' : 'missing',
  overlay: { opportunity: false, demand: false }, inRing: true, inList: true, children,
});

export const ring: RingNode[] = [
  { slug: 'biology', name: 'Genomics', pct: 78 },
  { slug: 'physiology', name: 'Physiology', pct: 82 },
  { slug: 'behavior', name: 'Behavior', pct: 58 },
  { slug: 'imaging', name: 'Imaging', pct: 71 },
  { slug: 'outcomes', name: 'Outcomes', pct: 88 },
  { slug: 'environment', name: 'Environment', pct: 31 },
  { slug: 'family', name: 'Family', pct: 61 },
  { slug: 'clinical', name: 'Clinical', pct: 94 },
];

export const domains: TreeNode[] = [
  domain('demographics', 'Demographics', 100),
  domain('biology', 'Biology (Genomics)', 78),
  domain('clinical', 'Clinical', 94),
  domain('physiology', 'Physiology', 82, [
    group('physiology.cardiovascular', 'Cardiovascular', 91, [
      leaf('physiology.cardiovascular.heart_rate', 'Heart Rate', 'verified'),
      leaf('physiology.cardiovascular.hrv', 'HRV', 'verified'),
      leaf('physiology.cardiovascular.blood_pressure', 'Blood Pressure', 'verified', { demand: true }),
      leaf('physiology.cardiovascular.ecg', 'ECG', 'missing'),
    ]),
    group('physiology.metabolic', 'Metabolic', 58, [
      leaf('physiology.metabolic.weight', 'Weight', 'verified'),
      leaf('physiology.metabolic.glucose', 'Glucose', 'verified'),
      leaf('physiology.metabolic.cgm', 'CGM', 'missing', { opportunity: true, opportunityId: 2 }),
      leaf('physiology.metabolic.body_composition', 'Body Composition', 'missing'),
    ]),
    group('physiology.sleep', 'Sleep', 96, [leaf('physiology.sleep.duration', 'Sleep duration', 'verified'), leaf('physiology.sleep.stages', 'Sleep stages', 'verified')]),
    group('physiology.strength', 'Strength', 12, [
      leaf('physiology.strength.grip_strength', 'Grip Strength', 'missing', { opportunity: true, opportunityId: 3 }),
      leaf('physiology.strength.strength_training', 'Strength training', 'partial'),
    ]),
    group('physiology.mobility', 'Mobility', 82, [leaf('physiology.mobility.steps', 'Steps', 'verified')]),
  ]),
  domain('behavior', 'Behavior', 58),
  domain('environment', 'Environment', 31),
  domain('family', 'Family History', 61),
  domain('outcomes', 'Outcomes', 88),
  domain('imaging', 'Imaging', 71),
];

const rng = new Rng('gallery-fixtures');
const bpRng = rng.fork('bp');
const points: NodeDetail['series']['points'] = [];
let sys = 138;
let dia = 88;
for (let i = 420; i >= 0; i -= 3) {
  sys = 128 + (sys - 128) * 0.93 + bpRng.normal(0, 2.2);
  dia = 82 + (dia - 82) * 0.93 + bpRng.normal(0, 1.6);
  points.push({ t: addDays(DEMO_TODAY, -i), values: { systolic: Math.round(sys), diastolic: Math.round(dia) } });
}
export const bpSeries: NodeDetail['series'] = {
  keys: [{ key: 'systolic', label: 'Systolic' }, { key: 'diastolic', label: 'Diastolic' }],
  points,
  window: { from: addDays(DEMO_TODAY, -427), to: DEMO_TODAY },
};

export const lineage: LineageStep[] = [
  { key: 'device', label: 'Omron device', detail: 'BP7450' },
  { key: 'raw', label: 'Raw measurement', detail: 'device_raw artifact' },
  { key: 'verified', label: 'Verified import', detail: 'connected_device' },
  { key: 'standardized', label: 'Standardized observation', detail: 'mmHg, LOINC' },
  { key: 'trajectory', label: 'Longitudinal trajectory', detail: 'monthly derived' },
];

export const events: TimelineEvent[] = [
  { id: 1, date: '2016-02-10', kind: 'diagnosis', category: 'clinical', title: 'Hypertension first documented', detail: 'Primary care visit' },
  { id: 2, date: '2018-03-04', kind: 'medication', category: 'medications', title: 'Lisinopril started', detail: '10 mg daily' },
  { id: 3, date: '2019-06-01', kind: 'lifestyle', category: 'lifestyle', title: 'Weight +14 lb', detail: 'Exercise decreased' },
  { id: 4, date: '2021-01-12', kind: 'diagnosis', category: 'clinical', title: 'COVID infection' },
  { id: 5, date: '2022-05-20', kind: 'medication', category: 'medications', title: 'BP increased', detail: 'Dose adjusted to 20 mg' },
  { id: 6, date: '2023-03-15', kind: 'device', category: 'devices', title: 'Apple Watch connected', detail: 'Sleep tracking begins' },
  { id: 7, date: '2024-02-02', kind: 'genomics', category: 'genomics', title: 'Exome sequencing', detail: 'VCF uploaded' },
  { id: 8, date: '2024-09-09', kind: 'imaging', category: 'imaging', title: 'MRI knee', detail: 'DICOM imported' },
  { id: 9, date: '2025-04-01', kind: 'lifestyle', category: 'lifestyle', title: 'Food tracking begins' },
  { id: 10, date: '2025-08-24', kind: 'device', category: 'devices', title: 'Connected BP cuff', detail: 'Omron BP7450' },
  { id: 11, date: '2026-02-14', kind: 'research', category: 'research', title: 'Metabolic research cohort', detail: 'CGM opportunity available' },
];

const swimFrom = addMonths(DEMO_TODAY, -6);
const laneRng = rng.fork('swim');
const dots = (n: number) => Array.from({ length: n }, (_, i) => ({ date: addDays(swimFrom, Math.round((i + 0.5) * (182 / n)) + laneRng.int(-3, 3)), kind: 'dot' as const }));
export const swimlane: ParticipantTimeline['swimlane'] = {
  window: { from: swimFrom, to: DEMO_TODAY },
  months: Array.from({ length: 6 }, (_, i) => addMonths(swimFrom, i)).map((d) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.slice(5, 7)) - 1]),
  lanes: [
    { key: 'bp', label: 'BP', color: '#1d6ef5', points: dots(24) },
    { key: 'weight', label: 'Weight', color: '#1a9e5c', points: dots(12) },
    { key: 'sleep', label: 'Sleep', color: '#7b55d6', points: dots(26) },
    { key: 'exercise', label: 'Exercise', color: '#e09a1e', points: dots(9) },
    { key: 'lisinopril', label: 'Lisinopril', color: '#d64545', points: [{ date: swimFrom, kind: 'bar', barUntil: DEMO_TODAY }] },
    { key: 'labs', label: 'Labs', color: '#1397a8', points: dots(2) },
    { key: 'meals', label: 'Meals', color: '#3a9c5d', points: dots(20) },
  ],
};

export const funnel: FunnelStage[] = [
  { key: 'total', label: 'total participants', n: 128420 },
  { key: 'demographic', label: 'demographic match', n: 18422 },
  { key: 'conditions', label: 'diabetes + hypertension', n: 8912 },
  { key: 'ehr', label: 'sufficient EHR', n: 6820 },
  { key: 'exome', label: 'exome', n: 3408 },
  { key: 'bp', label: 'longitudinal BP', n: 2140 },
  { key: 'nutrition', label: 'nutrition history', n: 611 },
];

export const preview: CohortPreview = {
  total: 128420,
  funnel,
  readyNow: 611,
  matrix: {
    groups: [
      { key: 'nutrition', label: 'Nutrition only', conceptSlugs: ['behavior.nutrition.food_log'], eligible: 1529, recruitable: 980 },
      { key: 'bp', label: 'BP only', conceptSlugs: ['physiology.cardiovascular.blood_pressure'], eligible: 697, recruitable: 440 },
      { key: 'bp_nutrition', label: 'BP + nutrition', conceptSlugs: ['physiology.cardiovascular.blood_pressure', 'behavior.nutrition.food_log'], eligible: 571, recruitable: 300 },
      { key: 'exome', label: 'Exome only', conceptSlugs: ['biology.genomics.exome'], eligible: 622, recruitable: 310 },
    ],
    notRecruitable: [{ label: 'requires EHR history', n: 2092 }],
    estimatedAfter: { low: 2330, high: 2630, point: 2481 },
  },
  heatmap: {
    columns: [{ slug: 'ehr', label: 'EHR' }, { slug: 'labs', label: 'LABS' }, { slug: 'exome', label: 'EXOME' }, { slug: 'bp', label: 'BP' }, { slug: 'diet', label: 'DIET' }, { slug: 'cgm', label: 'CGM' }, { slug: 'imaging', label: 'MRI' }],
    rows: [
      { label: 'Complete cohort', n: 611, cells: ['complete', 'complete', 'complete', 'complete', 'complete', 'partial', 'missing'] },
      { label: 'Group A', n: 1529, cells: ['complete', 'complete', 'complete', 'complete', 'missing', 'missing', 'partial'] },
      { label: 'Group B', n: 697, cells: ['complete', 'complete', 'complete', 'missing', 'complete', 'partial', 'missing'] },
      { label: 'Group C', n: 571, cells: ['complete', 'partial', 'complete', 'missing', 'missing', 'missing', 'missing'] },
    ],
  },
  bars: [
    { slug: 'ehr', label: 'EHR', pct: 100 }, { slug: 'labs', label: 'Labs', pct: 92 }, { slug: 'exome', label: 'Exome', pct: 50 },
    { slug: 'bp', label: 'BP', pct: 71 }, { slug: 'nutrition', label: 'Nutrition', pct: 22 }, { slug: 'cgm', label: 'CGM', pct: 16 }, { slug: 'imaging', label: 'Imaging', pct: 36 },
  ],
  consent: { blocked: false, reason: null },
  timingMs: 42,
};

export const consent: OpportunityDetail['consent'] = {
  organization: 'Example BioPharma',
  purpose: 'Metabolic treatment response',
  receive: ['14 days of blood pressure readings (cuff)', '7-day food diary (photo-derived)', 'Weekly survey responses', 'EHR summary, exome variants, medication list (reused)'],
  doNotReceive: ['Your name, email, phone, date of birth', 'Raw DICOM or raw photos', 'Any data outside the listed scope', 'Permission to re-contact you directly'],
  licenseTermMonths: 24,
  futureReuse: false,
  recontact: 'platform_only',
  compCents: 24000,
  perTask: [
    { conceptSlug: 'physiology.cardiovascular.blood_pressure', name: '14 days continuous BP', compCents: 12000, method: 'device', durationDays: 14 },
    { conceptSlug: 'behavior.nutrition.food_log', name: '7-day food diary', compCents: 8000, method: 'photo', durationDays: 7 },
    { conceptSlug: 'behavior.surveys.weekly', name: 'Short weekly survey', compCents: 4000, method: 'survey', durationDays: 0 },
  ],
  reusedCompCents: 0,
};

export const ledger: LedgerRow[] = [
  { id: 1, date: addDays(DEMO_TODAY, -3), kind: 'license_fee', title: 'Research License', dataIncluded: ['BP', 'Sleep', 'Labs'], studyName: 'Wearable sleep study', orgName: 'Academic Research', purpose: 'Sleep and cardiovascular risk', licenseId: 7, licenseNumber: '1842', termStart: addDays(DEMO_TODAY, -3), termEnd: addMonths(DEMO_TODAY, 21), licenseStatus: 'active', grossCents: 4667, participantCents: 4200, platformCents: 467, canRevoke: true },
  { id: 2, date: addDays(DEMO_TODAY, -108), kind: 'contribution_payment', title: 'Protocol contribution', dataIncluded: ['Sleep 14 d'], studyName: 'Wearable sleep study', orgName: 'Academic Research', purpose: 'Sleep and cardiovascular risk', licenseId: null, licenseNumber: null, termStart: null, termEnd: null, licenseStatus: null, grossCents: 13111, participantCents: 11800, platformCents: 1311, canRevoke: false },
  { id: 3, date: addMonths(DEMO_TODAY, -14), kind: 'license_fee', title: 'Research License', dataIncluded: ['EHR', 'Meds', 'BP'], studyName: 'Hypertension outcomes', orgName: 'Example Pharma', purpose: 'Treatment response', licenseId: 3, licenseNumber: '1838', termStart: addMonths(DEMO_TODAY, -14), termEnd: addMonths(DEMO_TODAY, -2), licenseStatus: 'expired', grossCents: 7111, participantCents: 6400, platformCents: 711, canRevoke: false },
];

export const activity: ActivityItem[] = [
  { id: 1, kind: 'bp_sync', text: '7 days of BP measurements added', occurredAt: hoursAgo(2), relative: relative(hoursAgo(2)) },
  { id: 2, kind: 'labs', text: 'New Quest labs imported', occurredAt: hoursAgo(26), relative: relative(hoursAgo(26)) },
  { id: 3, kind: 'sleep', text: 'Sleep data automatically updated', occurredAt: hoursAgo(50), relative: relative(hoursAgo(50)) },
  { id: 4, kind: 'payment', text: '$42 earned from Research License #1842', occurredAt: hoursAgo(74), relative: relative(hoursAgo(74)), amountCents: 4200 },
];

export const demoState: DemoState = {
  ready: true, seeded: true, persona: 'participant',
  orgs: [{ id: 1, name: 'Example BioPharma', type: 'pharma', declaredUses: ['research'] }, { id: 4, name: 'AdTarget Inc', type: 'advertising', declaredUses: ['advertising'] }],
  writeVersion: 1, today: DEMO_TODAY, now: DEMO_NOW, participantPseudonym: 'P-0a1b2c3d4e',
};
export const health: Health = { ok: true, ready: true, seeded: true };
