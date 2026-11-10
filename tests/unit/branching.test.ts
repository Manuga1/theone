// The branching decision tree (shared/branching.ts) on ≥ 30 phrases and file names. Pure: no DB, fixed clock.
import { describe, expect, it } from 'vitest';
import { DEMO_NOW } from '../../shared/clock';
import { applyAnswer, classifyText, decide, leafSpecsFromOntology, normalise, parseMeasurement, parseTime, resolveAnswer, routeFile, thresholdFor, valueLabel, variantSlugFor, type LeafSpec } from '../../shared/branching';

const ESPRESSO = { slug: 'behavior.nutrition.caffeine.drink.espresso', name: 'espresso', attribute: 'drink', value: 'espresso' };
const leaves = leafSpecsFromOntology([ESPRESSO]);
const leaf = (slug: string): LeafSpec => leaves.find((l) => l.slug === slug)!;
const c = (text: string) => classifyText(text, leaves, DEMO_NOW);
const filed = (text: string, slug: string) => {
  const r = c(text);
  expect(r.proposal.conceptSlug, `${text} → ${r.proposal.conceptSlug} (${r.proposal.rationale})`).toBe(slug);
  expect(decide(r.proposal), `${text}: confidence ${r.proposal.confidence}`).toBe('auto_filed');
  return r;
};

describe('text pipeline: normalisation, negation, time, numbers', () => {
  it('normalises number words, thousands separators and "a cigarette"', () => {
    expect(normalise('Had two Espressos, 10,000 steps and a cigarette')).toBe('had 2 espressos, 10000 steps and 1 cigarette');
  });
  it('parses times relative to the fixed clock (14:00Z)', () => {
    expect(parseTime('bp this morning', DEMO_NOW).observedAt).toBe('2026-10-24T08:00:00Z');
    expect(parseTime('slept badly last night', DEMO_NOW).observedAt).toBe('2026-10-23T22:00:00Z');
    expect(parseTime('yesterday i walked', DEMO_NOW).observedAt).toBe('2026-10-23T12:00:00Z');
    expect(parseTime('coffee at 3pm', DEMO_NOW)).toMatchObject({ observedAt: '2026-10-23T15:00:00Z', clockHours: 15 }); // 15:00 is after 14:00Z → previous day
    expect(parseTime('went to bed at 11:30pm', DEMO_NOW).observedAt).toBe('2026-10-23T23:30:00Z');
    expect(parseTime('reading at 8am', DEMO_NOW).observedAt).toBe('2026-10-24T08:00:00Z');
    expect(parseTime('3 days ago', DEMO_NOW).observedAt).toBe('2026-10-21T12:00:00Z');
    expect(parseTime('no time words', DEMO_NOW).observedAt).toBe(DEMO_NOW);
  });
  it('parses numbers with units and converts to canonical units', () => {
    expect(parseMeasurement('120/80')).toMatchObject({ kind: 'bp', systolic: 120, diastolic: 80 });
    expect(parseMeasurement('135 over 88')).toMatchObject({ kind: 'bp', systolic: 135, diastolic: 88 });
    expect(parseMeasurement('72 bpm')).toMatchObject({ value: 72, unit: 'bpm' });
    expect(parseMeasurement('180 lb')).toMatchObject({ value: 81.6, unit: 'kg', rawUnit: 'lb' });
    expect(parseMeasurement('82 kg')).toMatchObject({ value: 82, unit: 'kg' });
    expect(parseMeasurement('7 hours')).toMatchObject({ value: 7, unit: 'h' });
    expect(parseMeasurement('6.1 mmol/l')).toMatchObject({ value: 110, unit: 'mg/dL' });
    expect(parseMeasurement('110 mg/dl')).toMatchObject({ value: 110, unit: 'mg/dL' });
    expect(parseMeasurement(normalise('10,000 steps'))).toMatchObject({ value: 10000, unit: 'steps' });
    expect(parseMeasurement('10k steps')).toMatchObject({ value: 10000, unit: 'steps' });
    expect(parseMeasurement('mood 4/5')).toMatchObject({ value: 4, unit: 'score' });
    expect(parseMeasurement('no numbers here')).toBeNull();
  });
});

describe('text pipeline: 30+ phrases', () => {
  it('1 "I smoked a cigarette" → cigarettes, asks the brand', () => {
    const r = c('I smoked a cigarette');
    expect(r.proposal.conceptSlug).toBe('behavior.tobacco.cigarettes');
    expect(r.proposal.followUp).toMatchObject({ attribute: 'brand', question: 'What brand?', createsSubBranch: true });
    expect(r.proposal.extracted.valueNum).toBe(1);
  });
  it('2 brand answer "Marlboro" → a new sub-branch (variant) under cigarettes', () => {
    const pending = c('I smoked a cigarette').proposal;
    const { proposal, attribute } = applyAnswer(leaf('behavior.tobacco.cigarettes'), pending, 'Marlboro');
    expect(attribute).toMatchObject({ attribute: 'brand', value: 'marlboro', source: 'answer', variant: null });
    expect(proposal.followUp).toBeNull();
    expect(proposal.newConcept).toMatchObject({ name: 'Marlboro', isVariantOf: 'behavior.tobacco.cigarettes', parentSlug: 'behavior.tobacco.cigarettes' });
    expect(variantSlugFor(leaf('behavior.tobacco.cigarettes'), 'brand', 'Marlboro')).toBe('behavior.tobacco.cigarettes.brand.marlboro');
  });
  it('3 a known brand in the text proposes the sub-branch for review', () => {
    const r = c('smoked 2 Marlboros after dinner');
    expect(r.proposal.conceptSlug).toBe('behavior.tobacco.cigarettes');
    expect(r.proposal.extracted.attributes).toMatchObject({ brand: 'marlboro' });
    expect(r.proposal.newConcept?.isVariantOf).toBe('behavior.tobacco.cigarettes');
    expect(decide(r.proposal)).toBe('needs_review');
    expect(r.proposal.extracted.observedAt).toBe('2026-10-23T20:00:00Z');
  });
  it('4 "didn\'t smoke today" → negated, no follow-up', () => {
    const r = filed("didn't smoke today", 'behavior.tobacco.cigarettes');
    expect(r.negated).toBe(true);
    expect(r.proposal.extracted.valueBool).toBe(false);
    expect(r.proposal.followUp).toBeNull();
  });
  it('5 "BP 120/80 this morning" → home blood pressure, systolic/diastolic, 08:00', () => {
    const r = filed('BP 120/80 this morning', 'physiology.cardiovascular.blood_pressure');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 120, unit: 'mmHg', observedAt: '2026-10-24T08:00:00Z', attributes: { systolic: '120', diastolic: '80' } });
    expect(valueLabel(leaf('physiology.cardiovascular.blood_pressure'), r.proposal.extracted)).toBe('120/80 mmHg');
  });
  it('6 "blood pressure was 135 over 88 last night"', () => {
    const r = filed('blood pressure was 135 over 88 last night', 'physiology.cardiovascular.blood_pressure');
    expect(r.proposal.extracted.observedAt).toBe('2026-10-23T22:00:00Z');
    expect(r.proposal.alternatives[0]?.conceptSlug).toBe('clinical.vitals.clinic_blood_pressure');
  });
  it('7 a bare "120/80" still files as home BP (records-fed clinic BP scores lower)', () => {
    filed('120/80', 'physiology.cardiovascular.blood_pressure');
  });
  it('8 "heart rate 72 bpm" → rest context', () => {
    const r = filed('heart rate 72 bpm', 'physiology.cardiovascular.heart_rate');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 72, unit: 'bpm', context: 'rest' });
  });
  it('9 "heart rate hit 160 during my run" → exercise context (also files an exercise session)', () => {
    const r = filed('heart rate hit 160 during my run', 'physiology.cardiovascular.heart_rate');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 160, context: 'exercise' });
    expect(leaf('physiology.cardiovascular.heart_rate').contextRule?.alsoFile).toEqual({ context: 'exercise', slug: 'behavior.exercise.session' });
  });
  it('10 "resting hr 58 while sleeping" → sleep context', () => {
    const r = filed('resting hr 58 while sleeping', 'physiology.cardiovascular.heart_rate');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 58, context: 'sleep' });
  });
  it('11 "ran 5k this morning" → exercise session, activity run (option → sub-branch)', () => {
    const r = filed('ran 5k this morning', 'behavior.exercise.session');
    expect(r.proposal.extracted.attributes).toMatchObject({ activity: 'run', distance_km: '5' });
    expect(r.proposal.newConcept).toBeNull();
    expect(r.proposal.followUp).toBeNull();
  });
  it('12 "workout at the gym for 45 min" → session, gym, 45 min', () => {
    const r = filed('workout at the gym for 45 min', 'behavior.exercise.session');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 45, attributes: { activity: 'gym' } });
  });
  it('13 "went for a swim" → asks nothing (swim is an option)', () => {
    const r = filed('went for a swim', 'behavior.exercise.session');
    expect(r.proposal.extracted.attributes?.activity).toBe('swim');
  });
  it('14 "played tennis" → known free value → new sub-branch proposal (review)', () => {
    const r = c('played tennis for an hour');
    expect(r.proposal.conceptSlug).toBe('behavior.exercise.session');
    expect(r.proposal.newConcept?.isVariantOf).toBe('behavior.exercise.session');
    expect(decide(r.proposal)).toBe('needs_review');
  });
  it('15 "weight 180 lb" → 81.6 kg', () => {
    const r = filed('weight 180 lb', 'physiology.metabolic.weight');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 81.6, unit: 'kg', attributes: { raw: '180 lb' } });
  });
  it('16 "weighed 82 kg today"', () => {
    expect(filed('weighed 82 kg today', 'physiology.metabolic.weight').proposal.extracted.valueNum).toBe(82);
  });
  it('17 "slept 7 hours" → sleep duration', () => {
    expect(filed('slept 7 hours', 'physiology.sleep.sleep_duration').proposal.extracted).toMatchObject({ valueNum: 7, unit: 'h' });
  });
  it('18 "glucose 6.1 mmol/L before breakfast" → 110 mg/dL at 07:30', () => {
    const r = filed('glucose 6.1 mmol/L before breakfast', 'physiology.metabolic.glucose');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 110, unit: 'mg/dL', observedAt: '2026-10-24T07:30:00Z', attributes: { raw: '6.1 mmol/L' } });
  });
  it('19 "fasting glucose 110 mg/dL"', () => {
    expect(filed('fasting glucose 110 mg/dL', 'physiology.metabolic.glucose').proposal.extracted.valueNum).toBe(110);
  });
  it('20 "10,000 steps today"', () => {
    expect(filed('10,000 steps today', 'physiology.mobility.steps').proposal.extracted).toMatchObject({ valueNum: 10000, unit: 'steps' });
  });
  it('21 "yesterday I walked 8000 steps" → yesterday', () => {
    const r = filed('yesterday I walked 8000 steps', 'physiology.mobility.steps');
    expect(r.proposal.extracted.observedAt).toBe('2026-10-23T12:00:00Z');
  });
  it('22 "had two espressos this morning" → caffeine, existing espresso sub-branch, ×2', () => {
    const r = filed('had two espressos this morning', 'behavior.nutrition.caffeine');
    expect(r.attribute).toMatchObject({ attribute: 'drink', value: 'espresso', source: 'variant' });
    expect(r.attribute?.variant?.slug).toBe(ESPRESSO.slug);
    expect(r.proposal.extracted.valueNum).toBe(2);
    expect(r.proposal.newConcept).toBeNull();
    expect(valueLabel(leaf('behavior.nutrition.caffeine'), r.proposal.extracted)).toBe('espresso ×2');
  });
  it('23 "coffee with milk at 3pm" → option coffee (no review), 15:00', () => {
    const r = filed('coffee with milk at 3pm', 'behavior.nutrition.caffeine');
    expect(r.attribute).toMatchObject({ value: 'coffee', source: 'option', variant: null });
    expect(r.proposal.extracted.observedAt).toBe('2026-10-23T15:00:00Z');
  });
  it('24 "had a yerba mate" → proposes a new drink sub-branch for review', () => {
    const r = c('had a yerba mate after lunch');
    expect(r.proposal.conceptSlug).toBe('behavior.nutrition.caffeine');
    expect(r.proposal.newConcept).toMatchObject({ name: 'Yerba Mate', isVariantOf: 'behavior.nutrition.caffeine', valueKind: 'categorical' });
    expect(decide(r.proposal)).toBe('needs_review');
  });
  it('25 "a cup of tea" → asks nothing? no: tea is an option', () => {
    expect(filed('a cup of tea', 'behavior.nutrition.caffeine').attribute?.value).toBe('tea');
  });
  it('26 "took my meds" → adherence true', () => {
    const r = filed('took my meds', 'clinical.medications.adherence_today');
    expect(r.proposal.extracted.valueBool).toBe(true);
    expect(valueLabel(leaf('clinical.medications.adherence_today'), r.proposal.extracted)).toBe('Yes');
  });
  it('27 "skipped my metformin" → adherence false', () => {
    expect(filed('skipped my metformin', 'clinical.medications.adherence_today').proposal.extracted.valueBool).toBe(false);
  });
  it('28 "mood 4/5" → daily mood score 4', () => {
    const r = filed('mood 4/5', 'behavior.mood.daily_mood');
    expect(r.proposal.extracted.attributes?.score).toBe('4');
    expect(r.proposal.followUp).toBeNull();
  });
  it('29 "feeling pretty low today, mood 2" → score 2', () => {
    expect(filed('feeling pretty low today, mood 2', 'behavior.mood.daily_mood').proposal.extracted.attributes?.score).toBe('2');
  });
  it('30 "feeling great" with no number → score from the alias', () => {
    expect(filed('feeling great', 'behavior.mood.daily_mood').proposal.extracted.attributes?.score).toBe('5');
  });
  it('31 "went to bed at 11:30pm" → bedtime 23.5 h on the previous night', () => {
    const r = filed('went to bed at 11:30pm', 'behavior.sleep.bedtime_log');
    expect(r.proposal.extracted).toMatchObject({ valueNum: 23.5, observedAt: '2026-10-23T23:30:00Z' });
  });
  it('32 "ate a salad for lunch" → food log, verbatim text', () => {
    const r = filed('ate a salad for lunch', 'behavior.nutrition.food_log');
    expect(r.proposal.extracted.valueText).toBe('ate a salad for lunch');
  });
  it('33 "my father had a heart attack at 68" → family conditions (one_time)', () => {
    const r = filed('my father had a heart attack at 68', 'family.history.conditions');
    expect(leaf('family.history.conditions').valueKind).toBe('one_time');
    expect(r.proposal.extracted.valueText).toBe('my father had a heart attack at 68');
  });
  it('34 "HRV 42 ms" → HRV not heart rate', () => {
    expect(filed('HRV 42 ms', 'physiology.cardiovascular.hrv').proposal.extracted).toMatchObject({ valueNum: 42, unit: 'ms' });
  });
  it('35 "3 beers last night" → alcohol use', () => {
    const r = filed('3 beers last night', 'behavior.substance.alcohol_use');
    expect(r.proposal.extracted.observedAt).toBe('2026-10-23T22:00:00Z');
  });
  it('36 "SpO2 95% overnight"', () => {
    expect(filed('SpO2 95% overnight', 'physiology.sleep.spo2').proposal.extracted.valueNum).toBe(95);
  });
  it('37 "weight" without a number → asks for the reading; the answer completes it', () => {
    const r = c('weight');
    expect(r.proposal.conceptSlug).toBe('physiology.metabolic.weight');
    expect(r.proposal.followUp).toMatchObject({ attribute: 'value', createsSubBranch: false });
    const done = applyAnswer(leaf('physiology.metabolic.weight'), r.proposal, '183 lb');
    expect(done.proposal.followUp).toBeNull();
    expect(done.proposal.extracted.valueNum).toBe(83);
  });
  it('38 "temperature 38.5 C" → no concept (review), 39 "hello there" → nothing matched', () => {
    const t = c('temperature 38.5 C');
    expect(t.proposal.conceptSlug).toBeNull();
    expect(decide(t.proposal)).toBe('needs_review');
    const h = c('hello there');
    expect(h.proposal).toMatchObject({ conceptSlug: null, confidence: 0 });
  });
  it('40 ambiguous "feeling stressed and anxious" → mood tracking (stress) beats daily mood', () => {
    expect(c('feeling stressed and anxious').proposal.conceptSlug).toBe('behavior.stress.mood');
  });
  it('resolveAnswer maps aliases to options and keeps free text', () => {
    expect(resolveAnswer(leaf('behavior.nutrition.caffeine'), 'drink', 'a latte')).toMatchObject({ value: 'coffee', source: 'option' });
    expect(resolveAnswer(leaf('behavior.nutrition.caffeine'), 'drink', 'Espresso')).toMatchObject({ value: 'espresso', source: 'variant' });
    expect(resolveAnswer(leaf('behavior.nutrition.caffeine'), 'drink', 'it was a kombucha')).toMatchObject({ value: 'kombucha', source: 'answer' });
    expect(resolveAnswer(leaf('behavior.tobacco.cigarettes'), 'brand', 'Lucky Strike').value).toBe('lucky strike');
  });
  it('confidence policy: 0.6, relaxed to 0.5 after 200 accepted items; new concepts always review', () => {
    expect(thresholdFor(0)).toBe(0.6);
    expect(thresholdFor(199)).toBe(0.6);
    expect(thresholdFor(200)).toBe(0.5);
    expect(decide({ conceptSlug: 'x', newConcept: null, confidence: 0.55 }, 0)).toBe('needs_review');
    expect(decide({ conceptSlug: 'x', newConcept: null, confidence: 0.55 }, 250)).toBe('auto_filed');
    expect(decide({ conceptSlug: 'x', newConcept: { name: 'n', parentSlug: 'p', valueKind: 'text' }, confidence: 0.99 })).toBe('needs_review');
  });
});

describe('file routing', () => {
  const r = (name: string, extra: Partial<Parameters<typeof routeFile>[0]> = {}) => routeFile({ name, bytes: 1000, mime: '', ...extra }, leaves, DEMO_NOW);
  it('MRI upload: knee → MRI (musculoskeletal); brain .dcm → MRI (brain); bare scan.dcm → review (which modality?)', () => {
    const knee = r('knee-mri-2026-10-18.zip', { bytes: 412_000_000, mime: 'application/zip' });
    expect(knee).toMatchObject({ kind: 'proposal', provenance: 'clinical_source', proposal: { conceptSlug: 'imaging.mri.mri_musculoskeletal', confidence: 0.9 } });
    expect(r('brain-mri.dcm')).toMatchObject({ kind: 'proposal', proposal: { conceptSlug: 'imaging.mri.mri_brain' } });
    expect(r('chest-ct.nii.gz')).toMatchObject({ kind: 'proposal', proposal: { conceptSlug: 'imaging.xray_ct.chest_xray' } });
    const scan = r('scan.dcm', { mime: 'application/dicom' });
    expect(scan.kind).toBe('proposal');
    if (scan.kind === 'proposal') { expect(scan.proposal.conceptSlug).toBeNull(); expect(scan.reviewReason).toMatch(/modality/); expect(scan.proposal.alternatives.length).toBeGreaterThan(1); }
  });
  it('VCF → exome; a "genome" VCF proposes a new Genome concept', () => {
    expect(r('exome.vcf.gz', { bytes: 96_000_000 })).toMatchObject({ kind: 'proposal', proposal: { conceptSlug: 'biology.genomics.exome', confidence: 0.9 } });
    const g = r('alex-genome.vcf');
    expect(g).toMatchObject({ kind: 'proposal', proposal: { conceptSlug: null, newConcept: { name: 'Genome', parentSlug: 'biology.genomics', valueKind: 'file' } } });
  });
  it('Apple Health export.xml → the importer', () => {
    expect(r('export.xml', { mime: 'text/xml' })).toEqual({ kind: 'apple_health' });
    expect(r('apple_health_export.zip')).toEqual({ kind: 'apple_health' });
  });
  it('CSV/JSON with recognisable headers → the leaf with connected_device provenance', () => {
    expect(r('watch.csv', { mime: 'text/csv', textSample: 'timestamp,heart_rate\n2026-10-01T06:00:00Z,62' })).toMatchObject({ kind: 'proposal', provenance: 'connected_device', proposal: { conceptSlug: 'physiology.cardiovascular.heart_rate' } });
    expect(r('fitbit-steps.csv', { textSample: 'date,steps\n2026-10-01,8123' })).toMatchObject({ proposal: { conceptSlug: 'physiology.mobility.steps' } });
    expect(r('withings.json', { mime: 'application/json', textSample: '[{"date":"2026-10-01","weight":82.1}]' })).toMatchObject({ proposal: { conceptSlug: 'physiology.metabolic.weight' } });
    expect(r('omron.csv', { textSample: 'date,systolic,diastolic,pulse' })).toMatchObject({ proposal: { conceptSlug: 'physiology.cardiovascular.blood_pressure' } });
    const unknown = r('data.csv', { textSample: 'a,b,c\n1,2,3' });
    expect(unknown.kind === 'proposal' && unknown.reviewReason).toMatch(/column header/);
  });
  it('meal photo → food log (photo-derived); an unnamed photo asks what it is', () => {
    expect(r('lunch-2026-10-23.jpg', { mime: 'image/jpeg', bytes: 2_100_000 })).toMatchObject({ kind: 'proposal', ingestKind: 'photo', provenance: 'photo_derived', proposal: { conceptSlug: 'behavior.nutrition.food_log', confidence: 0.85 } });
    expect(r('IMG_0042.heic', { mime: 'image/heic', textSample: 'dinner with friends' })).toMatchObject({ proposal: { conceptSlug: 'behavior.nutrition.food_log' } });
    const img = r('IMG_0042.jpg', { mime: 'image/jpeg' });
    expect(img.kind === 'proposal' && img.proposal.conceptSlug).toBeNull();
    expect(img.kind === 'proposal' && img.reviewReason).toMatch(/photo/);
  });
  it('PDF lab report → the matching lab leaf; other PDFs → clinical document', () => {
    expect(r('quest-results.pdf', { mime: 'application/pdf', textSample: 'Lipid panel: LDL 128 mg/dL HDL 46 reference range' })).toMatchObject({ proposal: { conceptSlug: 'clinical.labs.lipid_panel', confidence: 0.9 } });
    expect(r('labs.pdf', { mime: 'application/pdf', textSample: 'HbA1c 7.2 % result' })).toMatchObject({ proposal: { conceptSlug: 'clinical.labs.hba1c' } });
    expect(r('referral-letter.pdf', { mime: 'application/pdf', textSample: 'Dear colleague, thank you for seeing this patient' })).toMatchObject({ proposal: { conceptSlug: 'clinical.encounters.document', confidence: 0.7 } });
    const which = r('labs.pdf', { mime: 'application/pdf', textSample: 'lab results attached' });
    expect(which.kind === 'proposal' && which.reviewReason).toMatch(/panel/);
  });
  it('rejects oversized and unsupported files; unknown types go to review', () => {
    expect(r('huge.zip', { bytes: 3 * 1024 ** 3 })).toMatchObject({ kind: 'reject' });
    expect(r('setup.exe')).toMatchObject({ kind: 'reject', reason: expect.stringMatching(/unsupported/) });
    const odd = r('notes.xyz');
    expect(odd.kind === 'proposal' && odd.reviewReason).toMatch(/Unrecognised/);
  });
  it('plain-text files run through the quick-log pipeline', () => {
    expect(r('log.txt', { mime: 'text/plain', textSample: 'bp 128/82 this morning' })).toMatchObject({ provenance: 'self_report', proposal: { conceptSlug: 'physiology.cardiovascular.blood_pressure' } });
  });
});
