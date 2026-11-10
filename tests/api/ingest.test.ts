// Ingestion (2026-11-10 notes): queue, uploads (metadata only), review actions, quick-log round trip, Apple Health import,
// typed node views and tree extras. CLASSIFIER=rules: the Anthropic API is never called from tests.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index';
import type { AppleHealthImportResult, DemoState, IngestQueue, NodeDetail, ParticipantHome, ParticipantSignature, QuickLogResult, ReviewResult, UploadResult } from '../../shared/api-types';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

process.env.CLASSIFIER = 'rules';

describe('ingestion API', () => {
  let t: TestDbs;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => { t = seededDbs(); app = createApp(); });
  const get = (url: string) => request(app).get(`/api/participant${url}`);
  const post = (url: string, body: unknown = {}) => request(app).post(`/api/participant${url}`).send(body as object);
  const leaves = (s: ParticipantSignature) => s.domains.flatMap((d) => d.children.flatMap((g) => g.children));

  it('demo state names the classifier (rules under tests)', async () => {
    expect(((await request(app).get('/api/demo/state')).body as DemoState).classifier).toBe('rules');
  });
  it('GET /ingest → the seeded queue: 3 auto-filed, 1 needs review (new sub-branch proposal)', async () => {
    const q = (await get('/ingest').expect(200)).body as IngestQueue;
    expect(q.counts).toMatchObject({ auto_filed: 3, needs_review: 1, queued: 0, discarded: 0, accepted: 0 });
    expect(q.classifier).toBe('rules');
    expect(q.maxFileBytes).toBe(2 * 1024 ** 3);
    expect(q.reviewThreshold).toBe(0.6);
    const review = q.items.find((i) => i.status === 'needs_review')!;
    expect(review.proposal?.newConcept).toMatchObject({ name: 'Yerba Mate', isVariantOf: 'behavior.nutrition.caffeine' });
    expect(review.reviewReason).toMatch(/sub-branch/);
    const mri = q.items.find((i) => i.filename?.includes('mri'))!;
    expect(mri).toMatchObject({ kind: 'upload', status: 'auto_filed', conceptSlug: 'imaging.mri.mri_musculoskeletal', observationCount: 1 });
    expect(mri.observationId).toBeTypeOf('number');
    const only = (await get('/ingest?status=needs_review')).body as IngestQueue;
    expect(only.items.map((i) => i.status)).toEqual(['needs_review']);
    // home carries the inbox counts
    const home = (await get('/home')).body as ParticipantHome;
    expect(home.inbox).toEqual({ needsReview: 1, autoFiledToday: 1 });
  });
  it('the seeded sub-branch: caffeine shows an espresso variant, filed observations roll up into the leaf', async () => {
    const n = (await get('/nodes/behavior.nutrition.caffeine').expect(200)).body as NodeDetail;
    expect(n.valueKind).toBe('categorical');
    expect(n.variants?.map((v) => [v.slug, v.nObs, v.isNew])).toEqual([['behavior.nutrition.caffeine.drink.espresso', 7, true]]);
    expect(n.summary.nObs).toBe(7);
    expect(n.classified).toMatchObject({ n: 7, classifier: 'rules' });
    expect(n.classified!.meanConfidence).toBeGreaterThan(0.8);
    expect(n.textLog?.[0]).toMatchObject({ text: 'two espressos this morning', attributes: { drink: 'espresso', variant: 'espresso' } });
    expect(n.lastLoggedAt).toBe('2026-10-24T08:00:00Z');
    expect(n.state).toBe('partial'); // self-reported only
    const sig = (await get('/signature')).body as ParticipantSignature;
    const caffeine = leaves(sig).find((l) => l.slug === 'behavior.nutrition.caffeine')!;
    expect(caffeine).toMatchObject({ valueKind: 'categorical', variantCount: 1, isNew: false, lastLoggedAt: '2026-10-24T08:00:00Z' });
    expect(caffeine.lastLoggedRelative).toBe('6 hours ago');
    expect(leaves(sig).find((l) => l.slug === 'physiology.cardiovascular.blood_pressure')).toMatchObject({ valueKind: 'continuous', variantCount: 0 });
  });
  it('typed views: one_time history with versions, boolean strip, text log', async () => {
    const fam = (await get('/nodes/family.history.conditions').expect(200)).body as NodeDetail;
    expect(fam.valueKind).toBe('one_time');
    expect(fam.history?.map((h) => [h.validFrom, h.validTo, h.current])).toEqual([['2026-09-14', null, true], ['2024-03-02', '2026-09-14', false]]);
    const meds = (await get('/nodes/clinical.medications.adherence_today').expect(200)).body as NodeDetail;
    expect(meds.valueKind).toBe('boolean');
    expect(meds.booleanStrip).toHaveLength(14);
    expect(meds.booleanStrip!.slice(-7).map((d) => d.value)).toEqual([true, true, true, false, true, true, true]);
    expect(meds.booleanStrip![0].value).toBeNull();
    const mood = (await get('/nodes/behavior.mood.daily_mood').expect(200)).body as NodeDetail;
    expect(mood.textLog?.length).toBe(5);
    expect(mood.textLog?.[0].attributes.score).toBe('4');
  });
  it('POST /log: files a BP reading, asks a follow-up for a cigarette and creates the brand sub-branch from the answer', async () => {
    const bp = (await post('/log', { text: 'bp 126/81 this morning' }).expect(200)).body as QuickLogResult;
    expect(bp.status).toBe('filed');
    expect(bp.filedAs).toMatchObject({ conceptSlug: 'physiology.cardiovascular.blood_pressure', valueLabel: '126/81 mmHg', newBranch: false, observedAt: '2026-10-24T08:00:00Z' });
    expect(bp.item.proposal?.classifier).toBe('rules');
    expect(bp.message).toMatch(/Filed under Physiology › Cardiovascular › Blood Pressure/);
    const row = t.graph.get<{ value_json: string; classification_json: string }>('SELECT value_json, classification_json FROM observation WHERE id = ?', bp.item.observationId)!;
    expect(JSON.parse(row.value_json)).toMatchObject({ systolic: 126, diastolic: 81 });
    expect(JSON.parse(row.classification_json)).toEqual({ classifier: 'rules', confidence: bp.item.proposal!.confidence, ingestItemId: bp.item.id });

    const cig = (await post('/log', { text: 'I smoked a cigarette', via: 'voice' }).expect(200)).body as QuickLogResult;
    expect(cig.status).toBe('follow_up');
    expect(cig.followUp).toMatchObject({ attribute: 'brand', question: 'What brand?' });
    expect(cig.item).toMatchObject({ kind: 'voice', status: 'queued' });
    const done = (await post('/log', { text: '', pendingId: cig.item.id, answer: 'Marlboro' }).expect(200)).body as QuickLogResult;
    expect(done.status).toBe('filed');
    expect(done.filedAs).toMatchObject({ conceptSlug: 'behavior.tobacco.cigarettes.brand.marlboro', newBranch: true, path: ['Behavior', 'Tobacco', 'Cigarettes', 'marlboro'] });
    expect(done.message).toMatch(/new sub-branch/);
    const node = (await get('/nodes/behavior.tobacco.cigarettes')).body as NodeDetail;
    expect(node.variants?.[0]).toMatchObject({ slug: 'behavior.tobacco.cigarettes.brand.marlboro', nObs: 1, isNew: true });
    // the second cigarette of that brand files on the existing sub-branch without asking
    const again = (await post('/log', { text: 'another marlboro after dinner' }).expect(200)).body as QuickLogResult;
    expect(again.status).toBe('filed');
    expect(again.filedAs?.conceptSlug).toBe('behavior.tobacco.cigarettes.brand.marlboro');
    expect(again.filedAs?.newBranch).toBe(false);
    // heart rate during exercise also files an exercise session
    const hr = (await post('/log', { text: 'heart rate hit 162 during my run' }).expect(200)).body as QuickLogResult;
    expect(hr.filedAs?.conceptSlug).toBe('physiology.cardiovascular.heart_rate');
    expect(hr.item.observationCount).toBe(2);
    expect(hr.message).toMatch(/\+1 related/);
    const session = (await get('/nodes/behavior.exercise.session')).body as NodeDetail;
    expect(session.variants?.find((v) => v.name === 'run')?.nObs).toBe(3);
    // a weak match waits for review; an empty log is rejected; a stale pendingId is 404
    const weak = (await post('/log', { text: 'temperature 38.5 C' }).expect(200)).body as QuickLogResult;
    expect(weak.status).toBe('needs_review');
    await post('/log', { text: '' }).expect(400);
    await post('/log', { text: 'x', pendingId: 99999, answer: 'y' }).expect(404);
    await post('/log', { text: 'x', pendingId: bp.item.id, answer: 'y' }).expect(409);
  });
  it('POST /ingest/files: metadata only — auto-files a knee MRI and a lunch photo, queues an unnamed photo, rejects an .exe and an oversized file', async () => {
    const r = (await post('/ingest/files', { files: [
      { name: 'knee-mri-2026-10-22.zip', bytes: 410_000_000, mime: 'application/zip' },
      { name: 'dinner.jpg', bytes: 1_900_000, mime: 'image/jpeg' },
      { name: 'IMG_0042.jpg', bytes: 2_000_000, mime: 'image/jpeg' },
      { name: 'setup.exe', bytes: 10, mime: 'application/octet-stream' },
      { name: 'huge-ct.zip', bytes: 3 * 1024 ** 3, mime: 'application/zip' },
    ] }).expect(200)).body as UploadResult;
    expect(r).toMatchObject({ autoFiled: 2, needsReview: 1 });
    expect(r.rejected.map((x) => x.name)).toEqual(['setup.exe', 'huge-ct.zip']);
    expect(r.rejected[1].reason).toMatch(/GiB/);
    const mri = r.items.find((i) => i.filename === 'knee-mri-2026-10-22.zip')!;
    expect(mri).toMatchObject({ status: 'auto_filed', conceptSlug: 'imaging.mri.mri_musculoskeletal', bytes: 410_000_000 });
    const art = t.graph.get<{ kind: string; uri: string; bytes: number }>('SELECT a.kind, a.uri, a.bytes FROM observation o JOIN artifact a ON a.id = o.artifact_id WHERE o.id = ?', mri.observationId)!;
    expect(art).toMatchObject({ kind: 'dicom', bytes: 410_000_000 });
    expect(art.uri).toContain('knee-mri-2026-10-22.zip');
    expect(r.items.find((i) => i.filename === 'dinner.jpg')).toMatchObject({ kind: 'photo', status: 'auto_filed', conceptSlug: 'behavior.nutrition.food_log' });
    expect(r.items.find((i) => i.filename === 'IMG_0042.jpg')).toMatchObject({ status: 'needs_review', conceptSlug: null });
    await post('/ingest/files', { files: [] }).expect(400);
    const ah = (await post('/ingest/files', { files: [{ name: 'export.xml', bytes: 1000, mime: 'text/xml' }] })).body as UploadResult;
    expect(ah.rejected[0].reason).toMatch(/apple-health/);
  });
  it('POST /ingest/:id/review: move, discard, create_branch (variant and new leaf), accept of a new-concept proposal; terminal items 409', async () => {
    const q = (await get('/ingest?status=needs_review')).body as IngestQueue;
    const photo = q.items.find((i) => i.filename === 'IMG_0042.jpg')!;
    const moved = (await post(`/ingest/${photo.id}/review`, { action: 'move', conceptSlug: 'imaging.specialty.retinal_scan' }).expect(200)).body as ReviewResult;
    expect(moved.item).toMatchObject({ status: 'accepted', conceptSlug: 'imaging.specialty.retinal_scan' });
    expect(moved.createdConcept).toBeNull();
    await post(`/ingest/${photo.id}/review`, { action: 'discard' }).expect(409);

    const mate = q.items.find((i) => i.text === 'had a yerba mate after lunch')!;
    const accepted = (await post(`/ingest/${mate.id}/review`, { action: 'accept' }).expect(200)).body as ReviewResult;
    expect(accepted.createdConcept).toMatchObject({ slug: 'behavior.nutrition.caffeine.drink.yerba_mate', path: ['Behavior', 'Nutrition', 'Caffeine', 'yerba mate'] });
    expect(accepted.item).toMatchObject({ status: 'accepted', conceptSlug: 'behavior.nutrition.caffeine', observationCount: 1 });
    const caffeine = (await get('/nodes/behavior.nutrition.caffeine')).body as NodeDetail;
    expect(caffeine.variants?.map((v) => v.name)).toEqual(['espresso', 'yerba mate']);
    expect(((await get('/ingest')).body as IngestQueue).counts.needs_review).toBe(1); // the temperature log still waits

    const weak = q.items.find((i) => i.text === 'temperature 38.5 C')!;
    const branch = (await post(`/ingest/${weak.id}/review`, { action: 'create_branch', newConcept: { name: 'Body temperature', parentSlug: 'clinical.vitals', valueKind: 'continuous', unit: '°C' } }).expect(200)).body as ReviewResult;
    expect(branch.createdConcept).toMatchObject({ slug: 'clinical.vitals.body_temperature', name: 'Body temperature' });
    const temp = (await get('/nodes/clinical.vitals.body_temperature').expect(200)).body as NodeDetail;
    expect(temp.valueKind).toBe('continuous');
    expect(temp.summary.nObs).toBe(1);
    const sig = (await get('/signature')).body as ParticipantSignature;
    expect(leaves(sig).find((l) => l.slug === 'clinical.vitals.body_temperature')).toMatchObject({ isNew: true, inList: true, weight: 0 });
    // the new leaf is now a quick-log target
    const log = (await post('/log', { text: 'body temperature 37.2 °C' }).expect(200)).body as QuickLogResult;
    expect(log.filedAs?.conceptSlug).toBe('clinical.vitals.body_temperature');
    // bad requests
    await post(`/ingest/99999/review`, { action: 'discard' }).expect(404);
    const other = (await post('/log', { text: 'xyzzy plugh' })).body as QuickLogResult;
    expect(other.status).toBe('needs_review');
    await post(`/ingest/${other.item.id}/review`, { action: 'accept' }).expect(400);
    await post(`/ingest/${other.item.id}/review`, { action: 'move', conceptSlug: 'nope' }).expect(404);
    await post(`/ingest/${other.item.id}/review`, { action: 'create_branch', newConcept: { name: 'x', parentSlug: 'nope', valueKind: 'text' } }).expect(400);
    const d = (await post(`/ingest/${other.item.id}/review`, { action: 'discard' }).expect(200)).body as ReviewResult;
    expect(d.item.status).toBe('discarded');
  });
  it('POST /import/apple-health parses the export (JSON or raw XML body), files connected-device observations, dedupes on re-import', async () => {
    const xml = readFileSync(new URL('../fixtures/apple-health-sample.xml', import.meta.url), 'utf8');
    const r = (await post('/import/apple-health', { xml }).expect(200)).body as AppleHealthImportResult;
    expect(r.records).toBe(22);
    expect(r.imported).toBe(13);
    expect(r.skipped).toBe(0);
    expect(r.byConcept.map((b) => [b.conceptSlug, b.n])).toEqual(expect.arrayContaining([['physiology.cardiovascular.heart_rate', 3], ['physiology.cardiovascular.blood_pressure', 2], ['physiology.mobility.steps', 2], ['physiology.sleep.sleep_duration', 1], ['physiology.metabolic.weight', 1], ['physiology.metabolic.glucose', 1], ['behavior.nutrition.food_log', 1]]));
    expect(r.item).toMatchObject({ kind: 'apple_health', status: 'auto_filed', filename: 'export.xml', observationCount: 13 });
    expect(r.artifactId).toBeTypeOf('number');
    const pid = alexId(t.graph);
    expect(t.graph.get<{ n: number }>("SELECT COUNT(*) AS n FROM observation WHERE participant_id = ? AND artifact_id = ? AND provenance_class = 'connected_device' AND method = 'import'", pid, r.artifactId)!.n).toBe(13);
    expect(t.graph.get<{ s: string }>("SELECT value_json AS s FROM observation WHERE artifact_id = ? AND value_json LIKE '%diastolic%' ORDER BY observed_at LIMIT 1", r.artifactId)!.s).toBe('{"systolic":124,"diastolic":79}');
    const again = (await request(app).post('/api/participant/import/apple-health').set('Content-Type', 'text/xml').send(xml).expect(200)).body as AppleHealthImportResult;
    expect(again).toMatchObject({ records: 22, imported: 0, skipped: 13, artifactId: null });
    await post('/import/apple-health', { xml: '<html></html>' }).expect(400);
    await post('/import/apple-health', {}).expect(400);
    const sources = (await get('/sources')).body as { sources: { kind: string; verified: boolean; status: string }[] };
    expect(sources.sources.find((s) => s.kind === 'apple_health')).toMatchObject({ status: 'connected', verified: true });
  });
  it('relaxation: after 200 accepted items a leaf auto-files at 0.5', async () => {
    const pid = alexId(t.graph);
    const weight = t.graph.get<{ id: number }>("SELECT id FROM concept WHERE slug = 'physiology.metabolic.weight'")!.id;
    const tie = (await post('/log', { text: 'sleep weight' })).body as QuickLogResult; // weight vs sleep duration tie → confidence 0.5 → review (asks nothing yet)
    expect(tie.status).toBe('needs_review');
    expect(tie.item.proposal).toMatchObject({ conceptSlug: 'physiology.metabolic.weight', confidence: 0.5 });
    for (let i = 0; i < 200; i++) t.graph.run("INSERT INTO ingest_item (participant_id, kind, status, text, concept_id, observation_count, reward_cents, created_at) VALUES (?, 'quicklog', 'accepted', 'seed', ?, 1, 0, ?)", pid, weight, `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}Z`);
    const relaxed = (await post('/log', { text: 'sleep weight 83 kg' })).body as QuickLogResult; // the unit makes it 0.67 anyway; the bare tie is now accepted at 0.5
    expect(relaxed.status).toBe('filed');
    const bare = (await post('/log', { text: 'sleep weight' })).body as QuickLogResult;
    expect(bare.status).toBe('follow_up'); // ≥ relaxed threshold → accepted, but a continuous leaf still needs its reading
    expect(bare.item.proposal?.conceptSlug).toBe('physiology.metabolic.weight');
  });
});
