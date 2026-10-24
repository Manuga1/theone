// Exact population quotas. The B3 funnel, the B1 headline tiles, the B4 matrix groups and the B5 bars are all
// real queries over the generated rows; these quotas are what make those queries land on the deck's numbers.
//
//   funnel 128,420 → 18,422 → 8,912 → 6,820 → 3,408 → 2,140 → 611 (incl. Alex)
//   tiles  128,420 total / 112,810 EHR ≥ 1 y / 48,921 exome / 121,304 recontactable (8,422 inside T2–T6)
//
// Tier definitions (all US, age 40–65 from T1 up):
//   T0 not (age 40–65 ∧ US)                       T4 + exome, BP < 12 mo  (BP-only 697; BP+nutrition 571)
//   T1 demographic match, not (T2D ∧ HTN ∧ A1c>7) T5 + BP ≥ 12 mo, nutrition < 30 d (nutrition-only)
//   T2 + conditions, EHR < 3 y (not enrichable)    T6 complete (610 generated + Alex)
//   T3 + EHR ≥ 3 y, no exome (exome-only 622; exome+nutrition 1,100; exome+BP+nutrition 1,690)

export type SubGroup = {
  key: string;
  /** Generated participants (Alex is added on top of T6 'complete'). */
  n: number;
  hasExome: boolean;
  /** 'long' ≥ 3 y, 'mid' 1–3 y, 'short' < 1 y, 'mixed' = per-quota split (T0/T1) */
  ehr: 'long' | 'mid' | 'short' | 'mixed';
  /** blood-pressure history: ok (≥ 12 mo, device), 'quota' = per-tier split between short/none */
  bp: 'ok' | 'quota';
  nutrition: 'ok' | 'quota';
};

export type TierQuota = {
  tier: number;
  label: string;
  demographicMatch: boolean;
  conditionsMatch: boolean;
  subgroups: SubGroup[];
  /** Exact counts inside the tier (sum of subgroups = n). */
  n: number;
  recontact: number;
  exome: number; // only used for T0/T1/T2 (mixed exome); T3 = 0; T4+ = all
  ehr1y: number; // EHR ≥ 365 d (T0/T1: among mixed; T2: 1–3 y)
  bpShort: number; // partial BP (< 12 mo) among members whose bp is 'quota'
  bpOkExtra: number; // members with ≥ 12 mo BP although the tier does not require it (T2 only)
  nutritionShort: number; // partial nutrition among 'quota' members
  lipid: number;
  imaging: number;
  cgm: number;
  meds: number;
  excluded: number; // category opt-outs (p ≈ 0.03)
};

export const FULL_TIERS: TierQuota[] = [
  {
    tier: 0, label: 'not (age 40–65 ∧ US)', demographicMatch: false, conditionsMatch: false,
    subgroups: [{ key: 't0', n: 109_998, hasExome: false, ehr: 'mixed', bp: 'quota', nutrition: 'quota' }],
    n: 109_998, recontact: 103_897, exome: 41_500, ehr1y: 95_690, bpShort: 33_000, bpOkExtra: 0, nutritionShort: 9_000,
    lipid: 60_000, imaging: 30_000, cgm: 9_000, meds: 70_000, excluded: 3_300,
  },
  {
    tier: 1, label: 'demographic match, not (T2D ∧ HTN ∧ HbA1c > 7)', demographicMatch: true, conditionsMatch: false,
    subgroups: [{ key: 't1', n: 9_510, hasExome: false, ehr: 'mixed', bp: 'quota', nutrition: 'quota' }],
    n: 9_510, recontact: 8_985, exome: 2_963, ehr1y: 8_800, bpShort: 2_900, bpOkExtra: 0, nutritionShort: 800,
    lipid: 6_500, imaging: 3_000, cgm: 900, meds: 7_000, excluded: 285,
  },
  {
    tier: 2, label: '+ conditions, EHR < 3 y', demographicMatch: true, conditionsMatch: true,
    subgroups: [{ key: 't2', n: 2_092, hasExome: false, ehr: 'mid', bp: 'quota', nutrition: 'quota' }],
    n: 2_092, recontact: 1_977, exome: 1_050, ehr1y: 1_500, bpShort: 266, bpOkExtra: 300, nutritionShort: 0,
    lipid: 1_925, imaging: 80, cgm: 335, meds: 1_880, excluded: 63,
  },
  {
    tier: 3, label: '+ EHR ≥ 3 y, no exome', demographicMatch: true, conditionsMatch: true,
    subgroups: [
      { key: 'exome_only', n: 622, hasExome: false, ehr: 'long', bp: 'ok', nutrition: 'ok' },
      { key: 'exome_nutrition', n: 1_100, hasExome: false, ehr: 'long', bp: 'ok', nutrition: 'quota' },
      { key: 'exome_bp_nutrition', n: 1_690, hasExome: false, ehr: 'long', bp: 'quota', nutrition: 'quota' },
    ],
    n: 3_412, recontact: 3_224, exome: 0, ehr1y: 3_412, bpShort: 1_000, bpOkExtra: 0, nutritionShort: 0,
    lipid: 3_139, imaging: 129, cgm: 546, meds: 3_070, excluded: 102,
  },
  {
    tier: 4, label: '+ exome, BP < 12 mo', demographicMatch: true, conditionsMatch: true,
    subgroups: [
      { key: 'bp_only', n: 697, hasExome: true, ehr: 'long', bp: 'quota', nutrition: 'ok' },
      { key: 'bp_nutrition', n: 571, hasExome: true, ehr: 'long', bp: 'quota', nutrition: 'quota' },
    ],
    n: 1_268, recontact: 1_198, exome: 1_268, ehr1y: 1_268, bpShort: 900, bpOkExtra: 0, nutritionShort: 0,
    lipid: 1_167, imaging: 1_116, cgm: 203, meds: 1_243, excluded: 38,
  },
  {
    tier: 5, label: '+ BP ≥ 12 mo, nutrition < 30 d', demographicMatch: true, conditionsMatch: true,
    subgroups: [{ key: 'nutrition_only', n: 1_529, hasExome: true, ehr: 'long', bp: 'ok', nutrition: 'quota' }],
    n: 1_529, recontact: 1_445, exome: 1_529, ehr1y: 1_529, bpShort: 0, bpOkExtra: 0, nutritionShort: 30,
    lipid: 1_407, imaging: 1_345, cgm: 245, meds: 1_498, excluded: 46,
  },
  {
    // Alex is the 611th member: he contributes recontact / lipid / imaging / meds himself (not CGM).
    tier: 6, label: 'complete', demographicMatch: true, conditionsMatch: true,
    subgroups: [{ key: 'complete', n: 610, hasExome: true, ehr: 'long', bp: 'ok', nutrition: 'ok' }],
    n: 610, recontact: 577, exome: 610, ehr1y: 610, bpShort: 0, bpOkExtra: 0, nutritionShort: 0,
    lipid: 560, imaging: 537, cgm: 97, meds: 598, excluded: 18,
  },
];

/** Headline numbers the full-scale seed must reproduce (used by the CLI assertion and tests/funnel-full.test.ts). */
export const FULL_TARGETS = {
  total: 128_420,
  funnel: [128_420, 18_422, 8_912, 6_820, 3_408, 2_140, 611],
  ehr1y: 112_810,
  exome: 48_921,
  recontact: 121_304,
  recontactBase: 8_422,
  matrix: { nutrition_only: 1_529, bp_only: 697, bp_nutrition: 571, exome_only: 622, exome_nutrition: 1_100, exome_bp_nutrition: 1_690 },
};

const s = (v: number, f: number) => (f >= 1 ? v : Math.round(v * f));

/** Scale every quota by `f` (monotone rounding keeps sub-quotas ≤ n). Alex is never scaled. */
export function scaledTiers(f: number): TierQuota[] {
  return FULL_TIERS.map((t) => {
    const subgroups = t.subgroups.map((g) => ({ ...g, n: Math.max(g.key === 'complete' ? 1 : 0, s(g.n, f)) }));
    const n = subgroups.reduce((a, g) => a + g.n, 0);
    const clamp = (v: number) => Math.min(n, s(v, f));
    return {
      ...t, subgroups, n,
      recontact: clamp(t.recontact), exome: t.tier >= 4 ? n : clamp(t.exome), ehr1y: t.tier >= 3 ? n : clamp(t.ehr1y),
      bpShort: clamp(t.bpShort), bpOkExtra: clamp(t.bpOkExtra), nutritionShort: clamp(t.nutritionShort),
      lipid: clamp(t.lipid), imaging: clamp(t.imaging), cgm: clamp(t.cgm), meds: clamp(t.meds), excluded: clamp(t.excluded),
    };
  });
}

/** Expected funnel for a given scale, derived from the tier table (Alex included in the last stage). */
export function expectedFunnel(tiers: TierQuota[]): number[] {
  const n = (i: number) => tiers[i].n;
  const total = tiers.reduce((a, t) => a + t.n, 0) + 1;
  const demo = total - n(0);
  const cond = demo - n(1);
  const ehr = cond - n(2);
  const exome = ehr - n(3);
  const bp = exome - n(4);
  const ready = bp - n(5);
  return [total, demo, cond, ehr, exome, bp, ready];
}
export function expectedTiles(tiers: TierQuota[]): { ehr1y: number; exome: number; recontact: number; recontactBase: number } {
  return {
    ehr1y: tiers.reduce((a, t) => a + t.ehr1y, 0) + 1,
    exome: tiers.reduce((a, t) => a + t.exome, 0) + 1,
    recontact: tiers.reduce((a, t) => a + t.recontact, 0) + 1,
    recontactBase: tiers.filter((t) => t.tier >= 2).reduce((a, t) => a + t.recontact, 0) + 1,
  };
}
