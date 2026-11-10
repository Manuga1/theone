// Alex's ingestion history (2026-11-10 notes): four queue items (three auto-filed, one waiting for review that proposes a
// new sub-branch), the caffeine › drink › espresso and exercise › activity › run variants with observations, and a few
// quick-log observations on the new weight-0 leaves (medications taken, daily mood, bedtime, family conditions).
// Everything lands on weight-0 leaves or already-verified leaves, so completeness, the ring and every seeded count stay exact.
import { createHash } from 'node:crypto';
import { DEMO_TODAY, addDays } from '@shared/clock';
import { PROVENANCE_RANK, type ProvenanceClass } from '@shared/provenance';
import type { Proposal } from '@shared/api-types';
import { insert } from '../db/migrate';
import { auditBranch, ensureVariant } from '../services/ingest';
import { conceptBySlug, conceptPath } from '../services/ontology';
import { type SeedCtx, concept } from './context';
import type { AlexSources, AlexWriter } from './alex';

type Obs = { slug: string; at: string; num?: number | null; text?: string | null; json?: unknown; unit?: string | null; from?: string | null; to?: string | null; source: number; prov: ProvenanceClass; method: string; confidence: number; classifier?: 'rules' | 'claude'; item?: number | null; artifact?: number | null };

export async function seedAlexIngest(ctx: SeedCtx, w: AlexWriter, S: AlexSources): Promise<void> {
  const db = ctx.graph;
  const pid = w.pid;
  const created = '2026-10-24T08:12:00Z';
  const obs = async (o: Obs): Promise<number> => {
    const c = await conceptBySlug(o.slug, db);
    if (!c) throw new Error(`unknown concept ${o.slug}`);
    const rank = PROVENANCE_RANK[o.prov];
    return (await db.run(
          'INSERT INTO observation (participant_id, concept_id, value_num, value_text, value_json, unit, observed_at, valid_from, valid_to, source_id, method, provenance_class, provenance_rank, verification, confidence, artifact_id, classification_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          pid, c.id, o.num ?? null, o.text ?? null, o.json === undefined ? null : JSON.stringify(o.json), o.unit ?? c.unit, o.at, o.from ?? null, o.to ?? null, o.source, o.method, o.prov, rank, rank >= 2 ? 'verified' : 'self_reported',
          o.confidence, o.artifact ?? null, JSON.stringify({ classifier: o.classifier ?? 'rules', confidence: o.confidence, ingestItemId: o.item ?? null }), created)).lastId;
  };
  const proposal = async (slug: string, confidence: number, rationale: string, extracted: Proposal['extracted'], extra: Partial<Proposal> = {}): Promise<Proposal> => {
    const c = (await conceptBySlug(slug, db))!;
    return { conceptSlug: slug, conceptName: c.name, path: await conceptPath(slug, db), newConcept: null, confidence, rationale, extracted, followUp: null, classifier: 'rules', alternatives: [], ...extra };
  };
  const item = async (row: Record<string, unknown>): Promise<number> => await insert(db, 'ingest_item', { participant_id: pid, reward_cents: 0, ...row });

  await db.tx(async () => {
        await db.run('UPDATE participant SET onboarded_at = ? WHERE id = ?', '2023-03-05T10:20:00Z', pid);

        // ---- variants: caffeine › drink › espresso (2026-10-14) and exercise › activity › run (2026-10-20)
        const caffeine = (await conceptBySlug('behavior.nutrition.caffeine', db))!;
        const espresso = (await ensureVariant(db, caffeine, 'drink', 'espresso', '2026-10-14T07:30:00Z')).concept;
        await auditBranch(db, pid, espresso, 'quick log: “espresso before work”', '2026-10-14T07:30:00Z');
        const session = (await conceptBySlug('behavior.exercise.session', db))!;
        const run = (await ensureVariant(db, session, 'activity', 'run', '2026-10-20T07:05:00Z')).concept;
        await auditBranch(db, pid, run, 'quick log: “ran 5k before work”', '2026-10-20T07:05:00Z');
        const esp = [['2026-10-14T07:30:00Z', 1, 'espresso before work'], ['2026-10-15T08:05:00Z', 2, 'two espressos this morning'], ['2026-10-17T07:40:00Z', 1, 'had an espresso'], ['2026-10-19T09:10:00Z', 1, 'espresso after breakfast'], ['2026-10-21T08:00:00Z', 2, 'double espresso'], ['2026-10-22T07:50:00Z', 1, 'espresso']] as const;
        for (const [at, n, text] of esp) await obs({ slug: espresso.slug, at, num: n, text, json: { attributes: { drink: 'espresso' } }, unit: 'drinks', source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.86 });
        await obs({ slug: run.slug, at: '2026-10-20T07:05:00Z', text: 'ran 5k before work', json: { attributes: { activity: 'run', distance_km: '5' } }, unit: 'min', source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.8 });
        await obs({ slug: run.slug, at: '2026-10-23T07:10:00Z', num: 32, text: 'easy run, 32 min', json: { attributes: { activity: 'run', minutes: '32' } }, unit: 'min', source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.82 });

        // ---- quick-log observations on the new leaves
        for (let i = 6; i >= 0; i--) {
          const d = addDays(DEMO_TODAY, -i);
          const taken = d !== '2026-10-21';
          await obs({ slug: 'clinical.medications.adherence_today', at: `${d}T08:30:00Z`, num: taken ? 1 : 0, text: taken ? 'took my meds' : 'forgot my meds this morning', source: S.manual, prov: 'self_report', method: 'self_report', confidence: taken ? 0.75 : 0.7 });
        }
        const moods = [['2026-10-20', 3, 'feeling ok'], ['2026-10-21', 4, 'good day'], ['2026-10-22', 2, 'feeling pretty low today, mood 2'], ['2026-10-23', 4, 'mood 4/5'], ['2026-10-24', 4, 'feeling good this morning']] as const;
        for (const [d, score, text] of moods) await obs({ slug: 'behavior.mood.daily_mood', at: `${d}T09:00:00Z`, num: score, text, json: { attributes: { score: String(score) } }, unit: '1-5', source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.8 });
        const bed = [['2026-10-19T23:15:00Z', 23.25], ['2026-10-20T23:40:00Z', 23.67], ['2026-10-21T22:55:00Z', 22.92], ['2026-10-22T23:30:00Z', 23.5], ['2026-10-23T23:05:00Z', 23.08]] as const;
        for (const [at, h] of bed) await obs({ slug: 'behavior.sleep.bedtime_log', at, num: h, text: `went to bed at ${at.slice(11, 16)}`, unit: 'h', source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.78 });
        // one_time fact with two versions: the first row's valid_to closes when the update appends
        await obs({ slug: 'family.history.conditions', at: '2024-03-02T10:00:00Z', text: 'Father: hypertension, heart attack at 68', from: '2024-03-02', to: '2026-09-14', source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.84 });
        await obs({ slug: 'family.history.conditions', at: '2026-09-14T18:30:00Z', text: 'Father: hypertension, heart attack at 68. Mother: type 2 diabetes diagnosed at 61', from: '2026-09-14', to: null, source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.84 });

        // ---- the four queue items
        // 1. upload: knee MRI follow-up (auto-filed, imaging source, dicom artifact)
        const mriName = 'knee-mri-followup-2026-10-18.zip';
        const mriSha = createHash('sha256').update(mriName).digest('hex');
        const mriItem = await item({ kind: 'upload', status: 'auto_filed', filename: mriName, bytes: 388_000_000, mime: 'application/zip', text: null, sha256: mriSha, proposal_json: null, review_reason: null, concept_id: concept(ctx, 'imaging.mri.mri_musculoskeletal'), observation_id: null, observation_count: 1, created_at: '2026-10-18T16:10:00Z', resolved_at: '2026-10-18T16:10:00Z' });
        const mriArt = (await db.run('INSERT INTO artifact (participant_id, source_id, kind, uri, sha256, bytes, captured_at, created_at) VALUES (?,?,?,?,?,?,?,?)', pid, S.imaging, 'dicom', `upload://${mriItem}/${mriName}`, mriSha, 388_000_000, '2026-10-18T16:10:00Z', created)).lastId;
        const mriObs = await obs({ slug: 'imaging.mri.mri_musculoskeletal', at: '2026-10-18T16:10:00Z', text: 'MRI right knee follow-up: stable medial meniscus degeneration', source: S.imaging, prov: 'clinical_source', method: 'upload', confidence: 0.9, item: mriItem, artifact: mriArt });
        await db.run('UPDATE ingest_item SET observation_id = ?, proposal_json = ? WHERE id = ?', mriObs, JSON.stringify((await proposal('imaging.mri.mri_musculoskeletal', 0.9, 'imaging file (.zip); “knee”, “mri” in the name selects MRI (musculoskeletal)', { valueText: mriName, observedAt: '2026-10-18T16:10:00Z', attributes: { filename: mriName, mime: 'application/zip', bytes: '388000000', modality: 'MRI (musculoskeletal)' } }, { alternatives: [{ conceptSlug: 'imaging.mri.mri_brain', conceptName: 'MRI (brain)', confidence: 0.2 }] }))), mriItem);

        // 2. photo: lunch (auto-filed, MealSnap source, photo artifact)
        const photoName = 'lunch-2026-10-23.jpg';
        const photoSha = createHash('sha256').update(photoName).digest('hex');
        const photoItem = await item({ kind: 'photo', status: 'auto_filed', filename: photoName, bytes: 2_310_000, mime: 'image/jpeg', text: null, sha256: photoSha, proposal_json: null, review_reason: null, concept_id: concept(ctx, 'behavior.nutrition.food_log'), observation_id: null, observation_count: 1, created_at: '2026-10-23T12:42:00Z', resolved_at: '2026-10-23T12:42:00Z' });
        const photoArt = (await db.run('INSERT INTO artifact (participant_id, source_id, kind, uri, sha256, bytes, captured_at, created_at) VALUES (?,?,?,?,?,?,?,?)', pid, S.meals, 'photo', `upload://${photoItem}/${photoName}`, photoSha, 2_310_000, '2026-10-23T12:42:00Z', created)).lastId;
        const photoObs = await obs({ slug: 'behavior.nutrition.food_log', at: '2026-10-23T12:42:00Z', text: 'Lunch photo: grain bowl with salmon', source: S.meals, prov: 'photo_derived', method: 'photo', confidence: 0.85, item: photoItem, artifact: photoArt });
        await db.run('UPDATE ingest_item SET observation_id = ?, proposal_json = ? WHERE id = ?', photoObs, JSON.stringify((await proposal('behavior.nutrition.food_log', 0.85, 'photo; “lunch” suggests a meal → Food log (photo-derived)', { valueText: photoName, observedAt: '2026-10-23T12:42:00Z', attributes: { filename: photoName, mime: 'image/jpeg', bytes: '2310000', meal: 'lunch' } }))), photoItem);

        // 3. quick log: two espressos this morning (auto-filed on the espresso sub-branch)
        const espText = 'two espressos this morning';
        const espItem = await item({ kind: 'quicklog', status: 'auto_filed', filename: null, bytes: null, mime: null, text: espText, sha256: null, proposal_json: null, review_reason: null, concept_id: caffeine.id, observation_id: null, observation_count: 1, created_at: created, resolved_at: created });
        const espObs = await obs({ slug: espresso.slug, at: '2026-10-24T08:00:00Z', num: 2, text: espText, json: { attributes: { drink: 'espresso' } }, unit: 'drinks', source: S.manual, prov: 'self_report', method: 'self_report', confidence: 0.88, item: espItem });
        await db.run('UPDATE ingest_item SET observation_id = ?, proposal_json = ? WHERE id = ?', espObs, JSON.stringify((await proposal('behavior.nutrition.caffeine', 0.88, 'matched “espresso”; known sub-branch “espresso”; unit drinks fits Caffeine; time “this morning”; drink = “espresso” (existing sub-branch)', { valueNum: 2, valueText: espText, unit: 'drinks', observedAt: '2026-10-24T08:00:00Z', attributes: { drink: 'espresso' }, context: null }))), espItem);

        // 4. quick log waiting for review: a drink the tree does not know yet → proposes caffeine › drink › yerba mate
        const mateText = 'had a yerba mate after lunch';
        await item({ kind: 'quicklog', status: 'needs_review', filename: null, bytes: null, mime: null, text: mateText, sha256: null,
                proposal_json: JSON.stringify((await proposal('behavior.nutrition.caffeine', 0.83, 'matched “yerba mate”; time “after lunch”; drink = “yerba mate” (new sub-branch)', { valueNum: 1, valueText: mateText, unit: 'drinks', observedAt: '2026-10-23T13:30:00Z', attributes: { drink: 'yerba mate' }, context: null },
                                      { newConcept: { name: 'Yerba Mate', parentSlug: 'behavior.nutrition.caffeine', valueKind: 'categorical', unit: 'drinks', isVariantOf: 'behavior.nutrition.caffeine' }, alternatives: [{ conceptSlug: 'behavior.nutrition.food_log', conceptName: 'Food log', confidence: 0.29 }] }))),
                review_reason: 'Proposes a new sub-branch “Yerba Mate” under Caffeine', concept_id: null, observation_id: null, observation_count: 0, created_at: '2026-10-23T13:40:00Z', resolved_at: null });

        await db.run('UPDATE source SET last_sync_at = ? WHERE id = ?', created, S.manual);

        // ---- logging rewards (notes: "the incentive must exceed the activation energy — e.g. earn $1 per food photo")
        const rule = async (slug: string, cents: number, perUnit: string, cap: number | null, funded: 'campaign' | 'platform', study: string | null) =>
          await insert(db, 'reward_rule', { participant_id: pid, concept_id: concept(ctx, slug), cents, per_unit_label: perUnit, daily_cap_cents: cap, funded_kind: funded, study_id: study ? ctx.studies[study] : null, active: 1, created_at: '2026-10-01T09:00:00Z' });
        await rule('behavior.nutrition.food_log', 100, 'per food photo', null, 'campaign', 'metabolic');                 // $1 per food photo — Metabolic Monitoring Study
        await rule('physiology.cardiovascular.blood_pressure', 25, 'per BP reading', 100, 'platform', null);         // $0.25 per reading, capped at $1 / day — platform
        await rule('outcomes.patient_reported.symptom_survey', 500, 'per weekly survey', null, 'campaign', 'wearsleep'); // $5 per weekly survey — Wearable Sleep Study (academic)

        // ---- daily check-ins: four completed days before today → with today's filed quick log the streak reads 5; today's check-in is open
        for (const d of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) {
          await insert(db, 'checkin_day', { participant_id: pid, date: d, done: 1, reward_cents: 0, answers_json: JSON.stringify({ 'clinical.medications.adherence_today': d !== '2026-10-21', 'behavior.mood.daily_mood': d === '2026-10-22' ? 2 : 4 }), created_at: `${d}T09:00:00Z` });
        }
        await insert(db, 'checkin_day', { participant_id: pid, date: DEMO_TODAY, done: 0, reward_cents: 0, answers_json: null, created_at: `${DEMO_TODAY}T00:00:00Z` });
      });
}
