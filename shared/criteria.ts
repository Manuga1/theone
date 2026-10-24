import { z } from 'zod';

export const LabCriterion = z.object({ slug: z.string(), op: z.enum(['>', '>=', '<', '<=']), value: z.number() });
export const ModalityCriterion = z.object({
  slug: z.string(),
  minSpanDays: z.number().int().nonnegative().default(0),
  minProvRank: z.number().int().min(1).max(4).default(2),
});
export const CohortCriteria = z.object({
  purpose: z.string().default('research'),
  demographics: z.object({
    ageMin: z.number().int().optional(),
    ageMax: z.number().int().optional(),
    sex: z.enum(['any', 'female', 'male']).default('any'),
    country: z.string().optional(),
  }).default({ sex: 'any' }),
  conditions: z.array(z.string()).default([]),
  labs: z.array(LabCriterion).default([]),
  modalities: z.array(ModalityCriterion).default([]),
  requireRecontact: z.boolean().default(false),
});
export type CohortCriteria = z.infer<typeof CohortCriteria>;
export type CohortCriteriaInput = z.input<typeof CohortCriteria>;

/** The B2 mockup cohort: age 40–65, US, T2D + hypertension, HbA1c > 7, exome, EHR >= 3y, BP >= 12mo, nutrition >= 30d. */
export const DEFAULT_CRITERIA: CohortCriteria = {
  purpose: 'Glucose response and cardiovascular risk in type 2 diabetes with hypertension',
  demographics: { ageMin: 40, ageMax: 65, sex: 'any', country: 'US' },
  conditions: ['clinical.diagnoses.type_2_diabetes', 'clinical.diagnoses.hypertension'],
  labs: [{ slug: 'clinical.labs.hba1c', op: '>', value: 7 }],
  modalities: [
    { slug: 'clinical.encounters.ehr_history', minSpanDays: 365 * 3, minProvRank: 4 },
    { slug: 'biology.genomics.exome', minSpanDays: 0, minProvRank: 3 },
    { slug: 'physiology.cardiovascular.blood_pressure', minSpanDays: 365, minProvRank: 3 },
    { slug: 'behavior.nutrition.food_log', minSpanDays: 30, minProvRank: 2 },
  ],
  requireRecontact: false,
};
