// Branching decision tree: where a new piece of data goes, as data + pure functions (no DB, no clock, no network).
// The same rules are documented in docs/branching-decision-tree.md. The server's rule classifier calls these with the
// leaves read from the concept table; Claude (when configured) answers the same Proposal shape and is validated against them.
//
//   input kind ──► file upload ──► routeFile()        (MIME / extension / name / text sample)
//              └─► quick log / voice / check-in ──► classifyText()  (normalise → negation → time → number+unit → synonym scoring)
//   then type rules (continuous/float need a value, boolean = true unless negated, text verbatim, one_time appends,
//   categorical resolves its follow-up attribute → existing variant | option | new sub-branch) and the confidence policy.
import type { Extracted, FollowUp, NewConceptProposal, Proposal, UploadFileInput, ValueKind } from './api-types';
import type { ProvenanceClass } from './provenance';
import { ONTOLOGY, inferValueKind, slugifyValue, variantSlug, type ContextName, type ContextRule, type FollowUpDef } from './ontology';

export type VariantSpec = { slug: string; name: string; attribute: string; value: string };
/** What the rules need to know about a leaf (built from the concept table at runtime, from the ontology in unit tests). */
export type LeafSpec = {
  slug: string; name: string; path: string[]; valueKind: ValueKind; unit: string | null; method: string | null;
  synonyms: string[]; followUps: FollowUpDef[]; contextRule: ContextRule | null; variants: VariantSpec[];
  /** group the leaf sits in (for new-concept proposals) */
  parentSlug: string;
};

export const BRANCHING = {
  /** auto-file at or above this confidence; below → needs_review */
  reviewThreshold: 0.6,
  /** once a leaf has ≥ relaxAfterAccepted accepted items its threshold drops here (the notes' "after ~200–300 examples") */
  relaxedThreshold: 0.5,
  relaxAfterAccepted: 200,
  /** MRI / CT studies are the upper bound */
  maxFileBytes: 2 * 1024 * 1024 * 1024,
  acceptedTypes: ['.dcm', '.dicom', '.nii', '.nii.gz', '.zip (imaging study)', '.vcf', '.vcf.gz', 'export.xml (Apple Health)', '.csv', '.json', 'image/* (photos)', 'application/pdf', '.txt'],
  /** confidence assigned by the file router when a rule matches unambiguously */
  fileConfidence: 0.9,
  /** a concept created within this many days reads as "new" in the tree */
  newConceptDays: 30,
} as const;

export function thresholdFor(acceptedCount: number): number {
  return acceptedCount >= BRANCHING.relaxAfterAccepted ? BRANCHING.relaxedThreshold : BRANCHING.reviewThreshold;
}
/** Confidence policy: new-concept proposals and unmatched inputs always go to review. */
export function decide(p: Pick<Proposal, 'conceptSlug' | 'newConcept' | 'confidence'>, acceptedCount = 0): 'auto_filed' | 'needs_review' {
  if (p.newConcept || !p.conceptSlug) return 'needs_review';
  return p.confidence >= thresholdFor(acceptedCount) ? 'auto_filed' : 'needs_review';
}

// ------------------------------------------------------------------------------------------------ normalisation
const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', half: '0.5' };
const COUNT_UNITS = 'cigarettes?|cigs?|coffees?|espressos?|lattes?|cappuccinos?|teas?|beers?|glass(?:es)?|cups?|drinks?|shots?|cans?|pints?|energy drinks?|smokes?|cocktails?|workouts?|runs?|naps?';

export function normalise(text: string): string {
  let t = String(text ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  t = t.replace(/(\d),(\d{3})\b/g, '$1$2');
  t = t.replace(/[^a-z0-9 .,:/%&'°+-]/g, ' ');
  t = t.replace(/\ba couple of\b/g, '2').replace(/\bcouple of\b/g, '2');
  t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)\b/g, (w) => NUMBER_WORDS[w]);
  t = t.replace(new RegExp(`\\b(?:a|an|another)\\s+(${COUNT_UNITS})\\b`, 'g'), '1 $1');
  t = t.replace(/\b(?:a|an)\s+(hour|hr)\b/g, '1 $1');
  return t.replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------------------------------------ negation
const NEGATION = /\b(didn'?t|did not|don'?t|do not|no|not|never|skipped|skip|skipping|without|haven'?t|have not|forgot|forgot to|missed|none|zero|0)\b/;
export function detectNegation(norm: string): boolean {
  return NEGATION.test(norm);
}

// ------------------------------------------------------------------------------------------------ time
export type TimeHit = { observedAt: string; matched: string | null; clockHours: number | null };
const DAY_MS = 86_400_000;
function dayStart(iso: string, offsetDays: number): Date {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  return new Date(d.getTime() + offsetDays * DAY_MS);
}
function atHours(base: Date, hours: number): string {
  return new Date(base.getTime() + Math.round(hours * 3_600_000)).toISOString().replace('.000Z', 'Z');
}
const PHRASE_TIMES: { re: RegExp; day: number; hours: number }[] = [
  { re: /\bthis morning\b/, day: 0, hours: 8 },
  { re: /\blast night\b/, day: -1, hours: 22 },
  { re: /\byesterday (?:morning)\b/, day: -1, hours: 8 },
  { re: /\byesterday (?:evening|night)\b/, day: -1, hours: 20 },
  { re: /\byesterday\b/, day: -1, hours: 12 },
  { re: /\bthis afternoon\b/, day: 0, hours: 15 },
  { re: /\bthis evening\b|\btonight\b/, day: 0, hours: 20 },
  { re: /\bat noon\b|\bnoon\b|\blunchtime\b/, day: 0, hours: 12 },
  { re: /\bmidnight\b/, day: 0, hours: 0 },
  { re: /\bbefore breakfast\b|\bfasting\b/, day: 0, hours: 7.5 },
  { re: /\bafter breakfast\b/, day: 0, hours: 9 },
  { re: /\bbefore lunch\b/, day: 0, hours: 12 },
  { re: /\bafter lunch\b/, day: 0, hours: 13.5 },
  { re: /\bbefore dinner\b/, day: 0, hours: 18 },
  { re: /\bafter dinner\b/, day: 0, hours: 20 },
  { re: /\bbefore bed\b|\bbedtime\b/, day: 0, hours: 22.5 },
  { re: /\bthis week\b/, day: 0, hours: 12 },
];
/** "this morning" 08:00, "last night" previous day 22:00, "yesterday", "at 8pm", "11:30pm", "3 days ago"; default now. A time after `now` rolls back one day. */
export function parseTime(norm: string, nowIso: string): TimeHit {
  const now = new Date(nowIso);
  let day = 0;
  let hours: number | null = null;
  let matched: string | null = null;
  const ago = /\b(\d+) days? ago\b/.exec(norm);
  if (ago) { day = -Number(ago[1]); hours = 12; matched = ago[0]; }
  for (const p of PHRASE_TIMES) {
    const m = p.re.exec(norm);
    if (m) { day = p.day; hours = p.hours; matched = m[0]; break; }
  }
  let clockHours: number | null = null;
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(norm);
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm))/.exec(norm);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === 'pm') h += 12;
    clockHours = h + Number(ampm[2] ?? 0) / 60;
    matched = matched ? `${matched} ${ampm[0]}` : ampm[0];
  } else if (h24) {
    clockHours = Number(h24[1]) + Number(h24[2]) / 60;
    matched = matched ? `${matched} ${h24[0]}` : h24[0];
  }
  if (clockHours !== null) hours = clockHours;
  if (hours === null) return { observedAt: now.toISOString().replace('.000Z', 'Z'), matched: null, clockHours: null };
  let at = atHours(dayStart(nowIso, day), hours);
  if (Date.parse(at) > now.getTime()) at = atHours(dayStart(nowIso, day - 1), hours);
  return { observedAt: at, matched, clockHours };
}

// ------------------------------------------------------------------------------------------------ number + unit
export type Measurement =
  | { kind: 'bp'; systolic: number; diastolic: number; unit: 'mmHg'; raw: string }
  | { kind: 'value'; value: number; unit: string | null; rawValue: number; rawUnit: string | null; raw: string };

type UnitPattern = { re: RegExp; unit: string; canonical?: string; convert?: (v: number) => number; specific: boolean };
const N = '(\\d+(?:\\.\\d+)?)';
const UNIT_PATTERNS: UnitPattern[] = [
  { re: new RegExp(`${N}\\s*(?:bpm|beats per minute)\\b`), unit: 'bpm', specific: true },
  { re: new RegExp(`${N}\\s*(?:lbs?|pounds?)\\b`), unit: 'lb', canonical: 'kg', convert: (v) => Math.round(v * 0.45359237 * 10) / 10, specific: true },
  { re: new RegExp(`${N}\\s*(?:kg|kilos?|kilograms?)\\b`), unit: 'kg', specific: true },
  { re: new RegExp(`${N}\\s*(?:mmol/?l|mmol)\\b`), unit: 'mmol/L', canonical: 'mg/dL', convert: (v) => Math.round(v * 18), specific: true },
  { re: new RegExp(`${N}\\s*(?:mg/dl)\\b`), unit: 'mg/dL', specific: true },
  { re: new RegExp(`${N}\\s*(?:ms|milliseconds?)\\b`), unit: 'ms', specific: true },
  { re: new RegExp(`${N}\\s*(?:kcal|calories|cal)\\b`), unit: 'kcal', specific: true },
  { re: new RegExp(`${N}\\s*k\\s*steps?\\b`), unit: 'steps', convert: (v) => v * 1000, specific: true },
  { re: new RegExp(`${N}\\s*steps?\\b`), unit: 'steps', specific: true },
  { re: new RegExp(`${N}\\s*(?:°\\s*c|°\\s*f|degrees|celsius|fahrenheit)\\b`), unit: '°C', specific: true },
  { re: new RegExp(`${N}\\s*(?:cigarettes?|cigs?|smokes?)\\b`), unit: 'cigarettes', specific: true },
  { re: new RegExp(`${N}\\s*(?:${COUNT_UNITS})\\b`), unit: 'drinks', specific: false },
  { re: new RegExp(`${N}\\s*(?:%|percent)`), unit: '%', specific: false },
  { re: new RegExp(`${N}\\s*(?:h|hr|hrs|hours?)\\b`), unit: 'h', specific: false },
  { re: new RegExp(`${N}\\s*(?:min|mins|minutes?)\\b`), unit: 'min', specific: false },
  { re: new RegExp(`${N}\\s*(?:km|kilometers?|kilometres?|k)\\b`), unit: 'km', specific: false },
  { re: new RegExp(`${N}\\s*(?:miles?|mi)\\b`), unit: 'mi', canonical: 'km', convert: (v) => Math.round(v * 1.609 * 10) / 10, specific: false },
];
const SCORE_RE = /\b([1-5])\s*(?:\/|out of|of)\s*5\b/;
const BP_RE = /\b(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\b/;

export function parseMeasurement(norm: string): Measurement | null {
  const bp = BP_RE.exec(norm);
  if (bp) return { kind: 'bp', systolic: Number(bp[1]), diastolic: Number(bp[2]), unit: 'mmHg', raw: bp[0] };
  const score = SCORE_RE.exec(norm);
  if (score) return { kind: 'value', value: Number(score[1]), unit: 'score', rawValue: Number(score[1]), rawUnit: 'score', raw: score[0] };
  for (const p of UNIT_PATTERNS) {
    const m = p.re.exec(norm);
    if (!m) continue;
    const raw = Number(m[1]);
    return { kind: 'value', value: p.convert ? p.convert(raw) : raw, unit: p.canonical ?? p.unit, rawValue: raw, rawUnit: p.unit, raw: m[0] };
  }
  // a bare number (not part of a time, ratio or percentage)
  const bare = /(?<![\d.:/%-])(\d+(?:\.\d+)?)(?![\d.:/%]|\s*(?:am|pm)\b)/.exec(norm);
  if (bare) return { kind: 'value', value: Number(bare[1]), unit: null, rawValue: Number(bare[1]), rawUnit: null, raw: bare[0] };
  return null;
}
/** Units the quick-log parser can map onto a leaf unit (canonical on both sides). */
const UNIT_FAMILY: Record<string, string> = { lb: 'kg', kg: 'kg', 'mmol/L': 'mg/dL', 'mg/dL': 'mg/dL', bpm: 'bpm', ms: 'ms', kcal: 'kcal', steps: 'steps', '%': '%', h: 'h', min: 'min', km: 'km', drinks: 'drinks', cigarettes: 'cigarettes', score: '1-5', mmHg: 'mmHg', sessions: 'sessions' };
export function unitsCompatible(leafUnit: string | null, unit: string | null): boolean {
  if (!leafUnit || !unit) return false;
  return (UNIT_FAMILY[leafUnit] ?? leafUnit) === (UNIT_FAMILY[unit] ?? unit);
}
const SPECIFIC_UNITS = new Set(['bpm', 'kg', 'mg/dL', 'ms', 'kcal', 'steps', 'cigarettes', 'mmHg']);

// ------------------------------------------------------------------------------------------------ phrase matching
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Whole-word match that tolerates a plural suffix on the phrase's last word. */
export function phraseRegex(phrase: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${esc(phrase.toLowerCase())}(?:s|es)?(?![a-z0-9])`);
}
export function hasPhrase(norm: string, phrase: string): boolean {
  return phraseRegex(phrase).test(norm);
}
/** Longest phrases first; a matched span is blanked so "mate" cannot score again inside "yerba mate". */
function matchPhrases(norm: string, phrases: string[]): string[] {
  const hits: string[] = [];
  let work = norm;
  for (const p of [...new Set(phrases)].sort((a, b) => b.length - a.length)) {
    const re = phraseRegex(p);
    const m = re.exec(work);
    if (m) {
      hits.push(p);
      work = work.slice(0, m.index) + ' '.repeat(m[0].length) + work.slice(m.index + m[0].length);
    }
  }
  return hits;
}
const words = (s: string) => s.trim().split(/\s+/).length;

// ------------------------------------------------------------------------------------------------ scoring
export type LeafScore = { leaf: LeafSpec; score: number; hits: string[]; variantHits: string[]; unitFit: boolean };

/** Leaf scores for a normalised quick log: synonym hits (+1, +0.5 per extra word), variant values (+1), unit fit (+1.5 / +2 for a BP pair), a number for a numeric leaf (+0.5); records/lab-fed concepts −0.5. */
export function scoreLeaves(norm: string, leaves: LeafSpec[], m: Measurement | null): LeafScore[] {
  const out: LeafScore[] = [];
  for (const leaf of leaves) {
    const hits = matchPhrases(norm, leaf.synonyms);
    const variantHits = matchPhrases(norm, leaf.variants.map((v) => v.value)).filter((v) => !hits.includes(v));
    // follow-up vocabulary is evidence too: known free values (+1, e.g. a cigarette brand) and option aliases (+0.5)
    const known = matchPhrases(norm, leaf.followUps.flatMap((f) => f.knownValues ?? [])).filter((v) => !hits.includes(v));
    const optionWords = matchPhrases(norm, leaf.followUps.flatMap((f) => [...(f.options ?? []), ...Object.values(f.aliases ?? {}).flat()]).filter((w) => !/^\d+$/.test(w))).filter((v) => !hits.includes(v) && !variantHits.includes(v));
    let score = hits.reduce((a, h) => a + 1 + 0.5 * (words(h) - 1), 0) + variantHits.length + known.length + 0.5 * optionWords.length;
    let unitFit = false;
    const numeric = leaf.valueKind === 'continuous' || leaf.valueKind === 'float';
    if (m) {
      if (m.kind === 'bp') {
        if (leaf.unit === 'mmHg') { score += 2; unitFit = true; }
      } else if (m.unit) {
        if (unitsCompatible(leaf.unit, m.unit) && (score > 0 || SPECIFIC_UNITS.has(m.unit))) { score += 1.5; unitFit = true; }
        else if (numeric && score > 0 && !unitsCompatible(leaf.unit, m.unit)) score -= 0.5;
      } else if (numeric && score > 0 && leaf.unit) score += 0.5;
    }
    if (score > 0 && (leaf.method === 'ehr' || leaf.method === 'lab' || leaf.method === 'derived')) score -= 0.5;
    if (score > 0) out.push({ leaf, score, hits, variantHits, unitFit });
  }
  return out.sort((a, b) => b.score - a.score || a.leaf.slug.localeCompare(b.leaf.slug));
}
/** confidence = best / (best + ½·runner-up + ½), capped at 0.98 → 0.67 for one clean hit, 0.5 for a tie. */
export function confidenceOf(best: number, second: number): number {
  if (best <= 0) return 0;
  return Math.min(0.98, Math.round((best / (best + 0.5 * second + 0.5)) * 100) / 100);
}

// ------------------------------------------------------------------------------------------------ follow-ups / variants
export type AttributeHit = { attribute: string; value: string; source: 'variant' | 'option' | 'known' | 'answer'; variant: VariantSpec | null };

function findVariant(leaf: LeafSpec, attribute: string, value: string): VariantSpec | null {
  const slug = variantSlug(leaf.slug, attribute, value);
  return leaf.variants.find((v) => v.slug === slug || (v.attribute === attribute && v.value.toLowerCase() === value.toLowerCase())) ?? null;
}
/** Resolve a categorical leaf's follow-up attribute from text: existing variant → option (via aliases) → known free value → null (ask). */
export function resolveAttribute(leaf: LeafSpec, norm: string, m: Measurement | null): AttributeHit | null {
  const fu = leaf.followUps[0];
  if (!fu) return null;
  for (const v of leaf.variants.filter((x) => x.attribute === fu.attribute).sort((a, b) => b.value.length - a.value.length)) {
    if (hasPhrase(norm, v.value)) return { attribute: fu.attribute, value: v.value, source: 'variant', variant: v };
  }
  const options = fu.options ?? [];
  const numericOptions = options.length > 0 && options.every((o) => /^\d+$/.test(o));
  if (numericOptions && m && m.kind === 'value' && (m.unit === 'score' || m.unit === null) && options.includes(String(m.value))) {
    return { attribute: fu.attribute, value: String(m.value), source: 'option', variant: findVariant(leaf, fu.attribute, String(m.value)) };
  }
  const candidates: { value: string; phrase: string }[] = [];
  for (const o of options) {
    candidates.push({ value: o, phrase: o });
    for (const a of fu.aliases?.[o] ?? []) candidates.push({ value: o, phrase: a });
  }
  for (const c of candidates.sort((a, b) => b.phrase.length - a.phrase.length)) {
    if (hasPhrase(norm, c.phrase)) return { attribute: fu.attribute, value: c.value, source: 'option', variant: findVariant(leaf, fu.attribute, c.value) };
  }
  for (const k of [...(fu.knownValues ?? [])].sort((a, b) => b.length - a.length)) {
    if (hasPhrase(norm, k)) return { attribute: fu.attribute, value: k, source: 'known', variant: findVariant(leaf, fu.attribute, k) };
  }
  return null;
}
/** The user answered the follow-up: an option alias, an existing variant, or free text (→ a new sub-branch). */
export function resolveAnswer(leaf: LeafSpec, attribute: string, answer: string): AttributeHit {
  const norm = normalise(answer);
  const fu = leaf.followUps.find((f) => f.attribute === attribute);
  const viaText = fu ? resolveAttribute({ ...leaf, followUps: [fu] }, norm, null) : null;
  if (viaText) return { ...viaText, source: viaText.variant ? 'variant' : viaText.source === 'known' ? 'answer' : viaText.source };
  const value = norm.replace(/^(?:it was |just |some |a |an |the )+/, '').replace(/[.,!]+$/, '').trim();
  return { attribute, value, source: 'answer', variant: findVariant(leaf, attribute, value) };
}
export function newVariantProposal(leaf: LeafSpec, attribute: string, value: string): NewConceptProposal {
  return { name: value.replace(/\b\w/g, (c) => c.toUpperCase()), parentSlug: leaf.slug, valueKind: leaf.valueKind, unit: leaf.unit, isVariantOf: leaf.slug };
}
export function variantSlugFor(leaf: Pick<LeafSpec, 'slug'>, attribute: string, value: string): string {
  return variantSlug(leaf.slug, attribute, value);
}

// ------------------------------------------------------------------------------------------------ context
export function resolveContext(rule: ContextRule | null, norm: string): ContextName | null {
  if (!rule) return null;
  for (const r of rule.rules) if (r.keywords.some((k) => hasPhrase(norm, k))) return r.context;
  return rule.default;
}

// ------------------------------------------------------------------------------------------------ text pipeline
export type TextClassification = { proposal: Proposal; negated: boolean; measurement: Measurement | null; time: TimeHit; attribute: AttributeHit | null; scores: LeafScore[] };

const VALUE_FOLLOW_UP = (leaf: LeafSpec): FollowUp => ({ attribute: 'value', question: `What was the reading${leaf.unit ? ` (${leaf.unit})` : ''}?`, createsSubBranch: false });

export function classifyText(text: string, leaves: LeafSpec[], nowIso: string): TextClassification {
  const norm = normalise(text);
  const negated = detectNegation(norm);
  const time = parseTime(norm, nowIso);
  const m = parseMeasurement(norm);
  const scores = scoreLeaves(norm, leaves, m);
  const best = scores[0];
  const second = scores[1]?.score ?? 0;
  const confidence = best ? confidenceOf(best.score, second) : 0;
  const alternatives = scores.slice(1, 4).map((s) => ({ conceptSlug: s.leaf.slug, conceptName: s.leaf.name, confidence: best ? Math.min(0.98, Math.round((s.score / (best.score + 0.5 * second + 0.5)) * 100) / 100) : 0 }));
  if (!best) {
    const proposal: Proposal = {
      conceptSlug: null, conceptName: null, path: [], newConcept: null, confidence: 0,
      rationale: 'No concept keyword matched; a person decides where this belongs (or whether it is a new data point).',
      extracted: { valueText: text.trim() || null, observedAt: time.observedAt, attributes: {} }, followUp: null, classifier: 'rules', alternatives: [],
    };
    return { proposal, negated, measurement: m, time, attribute: null, scores };
  }
  const leaf = best.leaf;
  const why: string[] = [];
  if (best.hits.length) why.push(`matched ${best.hits.map((h) => `“${h}”`).join(', ')}`);
  if (best.variantHits.length) why.push(`known sub-branch ${best.variantHits.map((h) => `“${h}”`).join(', ')}`);
  if (best.unitFit && m) why.push(`${m.kind === 'bp' ? 'a systolic/diastolic pair' : `unit ${m.unit}`} fits ${leaf.name}`);
  if (time.matched) why.push(`time “${time.matched}”`);
  if (negated) why.push('negation detected');

  const extracted: Extracted = { observedAt: time.observedAt, attributes: {}, context: null, valueNum: null, valueText: null, valueBool: null, unit: leaf.unit };
  let followUp: FollowUp | null = null;
  let newConcept: NewConceptProposal | null = null;
  let attribute: AttributeHit | null = null;
  const attrs = extracted.attributes!;

  // measurement → value
  if (m?.kind === 'bp') {
    extracted.valueNum = m.systolic; extracted.unit = 'mmHg';
    attrs.systolic = String(m.systolic); attrs.diastolic = String(m.diastolic);
  } else if (m) {
    if (leaf.valueKind === 'continuous' || leaf.valueKind === 'float') {
      if (m.unit === null || unitsCompatible(leaf.unit, m.unit)) { extracted.valueNum = m.value; extracted.unit = leaf.unit ?? m.unit; }
      if (m.rawUnit && m.rawUnit !== (extracted.unit ?? '')) attrs.raw = `${m.rawValue} ${m.rawUnit}`;
    } else if (m.unit === 'drinks' || m.unit === 'cigarettes' || m.unit === null) {
      extracted.valueNum = m.value;
    } else if (m.unit) {
      attrs[m.unit === 'km' ? 'distance_km' : m.unit === 'min' ? 'minutes' : m.unit === 'h' ? 'hours' : m.unit] = String(m.value);
      if (leaf.unit === 'min' && m.unit === 'min') extracted.valueNum = m.value;
    }
  }
  // bedtime-style leaves take the clock time as their value
  if (leaf.unit === 'h' && leaf.valueKind === 'continuous' && time.clockHours !== null && extracted.valueNum === null && /\bbed|asleep|lights out/.test(norm)) {
    extracted.valueNum = Math.round(time.clockHours * 100) / 100;
  }
  // context bucketing (heart rate during exercise / sleep / rest)
  const ctx = resolveContext(leaf.contextRule, norm);
  if (ctx) { extracted.context = ctx; attrs.context = ctx; }

  switch (leaf.valueKind) {
    case 'continuous': case 'float':
      if (negated) { extracted.valueBool = false; extracted.valueText = text.trim(); }
      else if (extracted.valueNum === null) followUp = VALUE_FOLLOW_UP(leaf);
      break;
    case 'boolean':
      extracted.valueBool = !negated;
      extracted.valueText = text.trim();
      break;
    case 'text': case 'one_time': case 'photo': case 'file':
      extracted.valueText = text.trim();
      break;
    case 'categorical': {
      extracted.valueText = text.trim();
      if (negated) { extracted.valueBool = false; extracted.valueNum = extracted.valueNum ?? 0; break; }
      if (extracted.valueNum === null && (leaf.unit === 'drinks' || leaf.unit === 'cigarettes')) extracted.valueNum = 1;
      attribute = resolveAttribute(leaf, norm, m);
      const fu = leaf.followUps[0] ?? null;
      if (attribute) {
        attrs[attribute.attribute] = attribute.value;
        if (!attribute.variant && attribute.source === 'known' && fu?.createsSubBranch) newConcept = newVariantProposal(leaf, attribute.attribute, attribute.value);
        why.push(`${attribute.attribute} = “${attribute.value}” (${attribute.variant ? 'existing sub-branch' : attribute.source === 'option' ? 'option' : 'new sub-branch'})`);
      } else if (fu) followUp = { attribute: fu.attribute, question: fu.question, options: fu.options, createsSubBranch: fu.createsSubBranch };
      break;
    }
  }

  const proposal: Proposal = {
    conceptSlug: leaf.slug, conceptName: leaf.name, path: leaf.path, newConcept, confidence,
    rationale: why.join('; ') || `best keyword match: ${leaf.name}`,
    extracted, followUp, classifier: 'rules', alternatives,
  };
  return { proposal, negated, measurement: m, time, attribute, scores };
}

/** Apply a follow-up answer to a pending proposal (value for numeric leaves, attribute for categorical ones). */
export function applyAnswer(leaf: LeafSpec, pending: Proposal, answer: string): { proposal: Proposal; attribute: AttributeHit | null } {
  const fu = pending.followUp;
  const extracted: Extracted = { ...pending.extracted, attributes: { ...(pending.extracted.attributes ?? {}) } };
  const attrs = extracted.attributes!;
  if (!fu) return { proposal: pending, attribute: null };
  if (fu.attribute === 'value') {
    const norm = normalise(answer);
    const m = parseMeasurement(norm);
    if (m?.kind === 'bp') { extracted.valueNum = m.systolic; extracted.unit = 'mmHg'; attrs.systolic = String(m.systolic); attrs.diastolic = String(m.diastolic); }
    else if (m) { extracted.valueNum = m.value; extracted.unit = leaf.unit ?? m.unit; if (m.rawUnit && m.rawUnit !== (extracted.unit ?? '')) attrs.raw = `${m.rawValue} ${m.rawUnit}`; }
    const ok = extracted.valueNum !== null && extracted.valueNum !== undefined;
    return { proposal: { ...pending, extracted, followUp: ok ? null : fu, rationale: ok ? `${pending.rationale}; value from follow-up answer` : pending.rationale }, attribute: null };
  }
  const hit = resolveAnswer(leaf, fu.attribute, answer);
  attrs[hit.attribute] = hit.value;
  const newConcept = !hit.variant && fu.createsSubBranch ? newVariantProposal(leaf, hit.attribute, hit.value) : null;
  return {
    proposal: { ...pending, extracted, followUp: null, newConcept, rationale: `${pending.rationale}; ${hit.attribute} = “${hit.value}” from follow-up answer${newConcept ? ' (new sub-branch)' : ''}` },
    attribute: hit,
  };
}

/** Human label for a filed value: "120/80 mmHg", "72 bpm", "Yes", "espresso ×2", verbatim text. */
export function valueLabel(leaf: Pick<LeafSpec, 'valueKind' | 'unit' | 'name'>, e: Extracted): string {
  const a = e.attributes ?? {};
  if (a.systolic && a.diastolic) return `${a.systolic}/${a.diastolic} mmHg`;
  switch (leaf.valueKind) {
    case 'boolean': return e.valueBool === false ? 'No' : 'Yes';
    case 'categorical': {
      const attr = Object.entries(a).find(([k]) => k !== 'context' && k !== 'raw');
      const n = e.valueNum && e.valueNum !== 1 ? ` ×${e.valueNum}` : '';
      return attr ? `${attr[1]}${n}` : e.valueBool === false ? 'None' : `${leaf.name}${n}`;
    }
    case 'continuous': case 'float':
      if (e.valueBool === false) return 'None';
      return e.valueNum === null || e.valueNum === undefined ? e.valueText ?? '' : `${e.valueNum}${e.unit ? ` ${e.unit}` : ''}${a.context ? ` (${a.context})` : ''}`;
    default: return e.valueText ?? (e.valueNum !== null && e.valueNum !== undefined ? String(e.valueNum) : '');
  }
}

// ------------------------------------------------------------------------------------------------ file routing
export type FileRoute =
  | { kind: 'reject'; reason: string }
  | { kind: 'apple_health' }
  | { kind: 'proposal'; proposal: Proposal; provenance: ProvenanceClass; ingestKind: 'upload' | 'photo'; reviewReason: string | null };

const IMAGING_EXT = new Set(['dcm', 'dicom', 'nii', 'nii.gz', 'nrrd']);
const BLOCKED_EXT = new Set(['exe', 'dll', 'bat', 'cmd', 'sh', 'msi', 'dmg', 'app', 'js', 'scr', 'com']);
const MEAL_WORDS = ['meal', 'lunch', 'dinner', 'breakfast', 'food', 'snack', 'brunch', 'plate', 'dish', 'salad', 'pizza', 'burger', 'sandwich', 'bowl'];
const LAB_WORDS = ['lab', 'labs', 'result', 'results', 'panel', 'hba1c', 'a1c', 'ldl', 'hdl', 'cholesterol', 'glucose', 'creatinine', 'reference range', 'specimen', 'quest', 'labcorp'];
const CSV_COLUMNS: { re: RegExp; slug: string }[] = [
  { re: /\b(?:systolic|diastolic)\b/, slug: 'physiology.cardiovascular.blood_pressure' },
  { re: /\b(?:hrv|sdnn|rmssd)\b/, slug: 'physiology.cardiovascular.hrv' },
  { re: /\b(?:heart_rate|heartrate|heart rate|hr|bpm|pulse)\b/, slug: 'physiology.cardiovascular.heart_rate' },
  { re: /\b(?:steps?|step_count)\b/, slug: 'physiology.mobility.steps' },
  { re: /\b(?:sleep|asleep|sleep_duration|time_in_bed)\b/, slug: 'physiology.sleep.sleep_duration' },
  { re: /\b(?:cgm|sensor_glucose|dexcom)\b/, slug: 'physiology.metabolic.cgm' },
  { re: /\b(?:glucose|blood_sugar)\b/, slug: 'physiology.metabolic.glucose' },
  { re: /\b(?:weight|body_mass|bodymass|kg|lbs?)\b/, slug: 'physiology.metabolic.weight' },
  { re: /\b(?:spo2|oxygen)\b/, slug: 'physiology.sleep.spo2' },
  { re: /\b(?:kcal|calories|energy)\b/, slug: 'behavior.nutrition.food_log' },
];

function extensionOf(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.nii.gz')) return 'nii.gz';
  if (n.endsWith('.vcf.gz')) return 'vcf.gz';
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i + 1) : '';
}
function base(leaf: LeafSpec, confidence: number, rationale: string, extracted: Extracted, alternatives: Proposal['alternatives'] = []): Proposal {
  return { conceptSlug: leaf.slug, conceptName: leaf.name, path: leaf.path, newConcept: null, confidence, rationale, extracted, followUp: null, classifier: 'rules', alternatives };
}
function unresolved(rationale: string, extracted: Extracted, alternatives: Proposal['alternatives'] = [], newConcept: NewConceptProposal | null = null): Proposal {
  return { conceptSlug: null, conceptName: null, path: [], newConcept, confidence: newConcept ? 0.7 : 0.4, rationale, extracted, followUp: null, classifier: 'rules', alternatives };
}
const alt = (l: LeafSpec, confidence: number) => ({ conceptSlug: l.slug, conceptName: l.name, confidence });

/** Route an uploaded file by MIME / extension / name / text sample. Files are metadata only: nothing here reads bytes. */
export function routeFile(file: UploadFileInput, leaves: LeafSpec[], nowIso: string): FileRoute {
  const name = String(file.name ?? '').trim();
  if (!name) return { kind: 'reject', reason: 'a file name is required' };
  const bytes = Number(file.bytes ?? 0);
  if (!Number.isFinite(bytes) || bytes < 0) return { kind: 'reject', reason: 'bytes must be a non-negative number' };
  if (bytes > BRANCHING.maxFileBytes) return { kind: 'reject', reason: `larger than the ${Math.round(BRANCHING.maxFileBytes / 1024 ** 3)} GiB limit (MRI / CT studies are the upper bound)` };
  const lower = name.toLowerCase();
  const ext = extensionOf(lower);
  const mime = String(file.mime ?? '').toLowerCase();
  const sample = normalise(file.textSample ?? '');
  const nameNorm = normalise(lower.replace(/[._-]+/g, ' '));
  const by = (slug: string) => leaves.find((l) => l.slug === slug);
  const observedAt = file.lastModified && !Number.isNaN(Date.parse(file.lastModified)) ? new Date(file.lastModified).toISOString().replace('.000Z', 'Z') : nowIso;
  const fileExtracted = (extra: Record<string, string> = {}): Extracted => ({ valueText: name, observedAt, attributes: { filename: name, mime: mime || 'unknown', bytes: String(bytes), ...extra } });

  if (BLOCKED_EXT.has(ext)) return { kind: 'reject', reason: `unsupported file type .${ext}` };
  // Apple Health export
  if ((ext === 'xml' && (lower === 'export.xml' || /apple|health|export/.test(lower))) || (ext === 'zip' && /export|apple.?health/.test(lower))) return { kind: 'apple_health' };

  // imaging
  const imagingWords = /\b(mri|ct|xray|x ray|dicom|scan|radiograph|dexa|dxa)\b/.test(nameNorm) || /\bmri\b|\bct\b/.test(sample);
  if (IMAGING_EXT.has(ext) || mime.includes('dicom') || ((ext === 'zip' || ext === 'tar' || ext === 'gz' || ext === '') && imagingWords) || imagingWords) {
    const imaging = leaves.filter((l) => l.slug.startsWith('imaging.'));
    const text = `${nameNorm} ${sample}`;
    const scored = imaging.map((l) => ({ l, hits: matchPhrases(text, l.synonyms) })).map((x) => ({ ...x, s: x.hits.reduce((a, h) => a + (h === 'mri' || h === 'ct' || h === 'scan' ? 0.5 : 1), 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    const bestS = scored[0];
    const specific = bestS && bestS.s >= 1 && (scored.length < 2 || scored[1].s < bestS.s);
    const alternatives = scored.slice(0, 4).map((x) => alt(x.l, Math.min(0.98, x.s / ((bestS?.s ?? 1) + 1))));
    if (specific) {
      return { kind: 'proposal', ingestKind: 'upload', provenance: 'clinical_source', reviewReason: null,
        proposal: base(bestS.l, BRANCHING.fileConfidence, `imaging file (.${ext || 'zip'}); “${bestS.hits.join('”, “')}” in the name selects ${bestS.l.name}`, fileExtracted({ modality: bestS.l.name }), alternatives.filter((a) => a.conceptSlug !== bestS.l.slug)) };
    }
    return { kind: 'proposal', ingestKind: 'upload', provenance: 'clinical_source', reviewReason: 'Which modality / body region is this imaging study?',
      proposal: unresolved(`imaging file (.${ext || 'zip'}) but the name does not say which modality or body region`, fileExtracted(), alternatives.length ? alternatives : imaging.slice(0, 4).map((l) => alt(l, 0.3))) };
  }
  // genomics
  if (ext === 'vcf' || ext === 'vcf.gz' || /\bvcf\b/.test(nameNorm)) {
    const exome = by('biology.genomics.exome');
    if (/\bgenome\b|\bwgs\b/.test(nameNorm) && !/\bexome\b|\bwes\b/.test(nameNorm)) {
      const parent = exome?.parentSlug ?? 'biology.genomics';
      return { kind: 'proposal', ingestKind: 'upload', provenance: 'clinical_source', reviewReason: 'The file says “genome”: a whole-genome branch does not exist yet — create it, or file under Exome?',
        proposal: unresolved('VCF named as a whole genome; the ontology only has Exome', fileExtracted(), exome ? [alt(exome, 0.5)] : [], { name: 'Genome', parentSlug: parent, valueKind: 'file', unit: null, isVariantOf: null }) };
    }
    if (exome) return { kind: 'proposal', ingestKind: 'upload', provenance: 'clinical_source', reviewReason: null, proposal: base(exome, BRANCHING.fileConfidence, 'VCF variant file → Exome', fileExtracted()) };
  }
  // tabular device exports
  if (ext === 'csv' || ext === 'json' || mime === 'text/csv' || mime === 'application/json') {
    const header = `${sample.split('\n')[0] ?? ''} ${nameNorm}`;
    for (const c of CSV_COLUMNS) {
      const leaf = by(c.slug);
      if (leaf && c.re.test(header)) {
        return { kind: 'proposal', ingestKind: 'upload', provenance: 'connected_device', reviewReason: null, proposal: base(leaf, BRANCHING.fileConfidence, `${ext.toUpperCase()} export with a recognisable ${leaf.name.toLowerCase()} column`, fileExtracted({ format: ext })) };
      }
    }
    const t = classifyText(`${nameNorm} ${sample}`, leaves, nowIso);
    return { kind: 'proposal', ingestKind: 'upload', provenance: 'connected_device', reviewReason: t.proposal.conceptSlug ? null : 'No recognisable column header (heart_rate, steps, sleep, glucose, weight, systolic …)',
      proposal: { ...t.proposal, confidence: Math.min(t.proposal.confidence, 0.55), extracted: fileExtracted({ format: ext }), followUp: null, rationale: `no recognisable column header; ${t.proposal.rationale}` } };
  }
  // photos
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'].includes(ext)) {
    const food = by('behavior.nutrition.food_log');
    const text = `${nameNorm} ${sample}`;
    const meal = MEAL_WORDS.filter((w) => hasPhrase(text, w));
    if (food && meal.length) {
      return { kind: 'proposal', ingestKind: 'photo', provenance: 'photo_derived', reviewReason: null, proposal: base(food, 0.85, `photo; “${meal.join('”, “')}” suggests a meal → Food log (photo-derived)`, fileExtracted({ meal: meal[0] })) };
    }
    const alts = ['behavior.nutrition.food_log', 'imaging.specialty.retinal_scan', 'clinical.encounters.document'].map((s) => by(s)).filter((l): l is LeafSpec => !!l).map((l) => alt(l, 0.3));
    return { kind: 'proposal', ingestKind: 'photo', provenance: 'photo_derived', reviewReason: 'What is this photo of? (a meal, a document, a scan …)', proposal: unresolved('photo without a meal hint in its name or caption', fileExtracted(), alts) };
  }
  // documents
  if (ext === 'pdf' || mime === 'application/pdf') {
    const text = `${nameNorm} ${sample}`;
    const labHit = LAB_WORDS.filter((w) => hasPhrase(text, w));
    if (labHit.length) {
      const labs = leaves.filter((l) => l.slug.startsWith('clinical.labs.'));
      const scored = labs.map((l) => ({ l, hits: matchPhrases(text, l.synonyms) })).filter((x) => x.hits.length).sort((a, b) => b.hits.length - a.hits.length);
      const alternatives = scored.map((x) => alt(x.l, Math.min(0.98, x.hits.length / ((scored[0]?.hits.length ?? 1) + 1))));
      if (scored.length && (scored.length === 1 || scored[0].hits.length > scored[1].hits.length)) {
        return { kind: 'proposal', ingestKind: 'upload', provenance: 'clinical_source', reviewReason: null, proposal: base(scored[0].l, BRANCHING.fileConfidence, `PDF lab report (“${labHit.slice(0, 3).join('”, “')}”); “${scored[0].hits.join('”, “')}” selects ${scored[0].l.name}`, fileExtracted({ document: 'lab report' }), alternatives.slice(1)) };
      }
      return { kind: 'proposal', ingestKind: 'upload', provenance: 'clinical_source', reviewReason: 'Which lab panel does this report hold?', proposal: unresolved(`PDF lab report (“${labHit.slice(0, 3).join('”, “')}”) without a recognisable panel name`, fileExtracted({ document: 'lab report' }), alternatives.length ? alternatives : labs.map((l) => alt(l, 0.3))) };
    }
    const doc = by('clinical.encounters.document');
    if (doc) return { kind: 'proposal', ingestKind: 'upload', provenance: 'clinical_source', reviewReason: null, proposal: base(doc, 0.7, 'PDF without lab-report wording → clinical document', fileExtracted({ document: 'other' })) };
  }
  // plain text → the quick-log pipeline
  if (ext === 'txt' || ext === 'md' || mime.startsWith('text/')) {
    const t = classifyText(file.textSample ?? name, leaves, nowIso);
    return { kind: 'proposal', ingestKind: 'upload', provenance: 'self_report', reviewReason: t.proposal.conceptSlug ? null : 'No concept keyword matched in the text', proposal: { ...t.proposal, followUp: null, extracted: { ...t.proposal.extracted, attributes: { ...(t.proposal.extracted.attributes ?? {}), filename: name } } } };
  }
  return { kind: 'proposal', ingestKind: 'upload', provenance: 'self_report', reviewReason: `Unrecognised file type (.${ext || '?'} / ${mime || 'unknown MIME'}) — where should it go?`, proposal: unresolved(`no routing rule for .${ext || '?'} / ${mime || 'unknown MIME'}`, fileExtracted()) };
}

/** Leaf specs straight from the canonical ontology (unit tests; the server builds them from the concept table). */
export function leafSpecsFromOntology(variants: VariantSpec[] = []): LeafSpec[] {
  const out: LeafSpec[] = [];
  for (const d of ONTOLOGY) for (const g of d.groups) for (const l of g.leaves) {
    out.push({
      slug: l.slug, name: l.name, path: [d.name, g.name, l.name], valueKind: inferValueKind(l), unit: l.unit ?? null, method: l.method,
      synonyms: l.synonyms ?? [], followUps: l.followUps ?? [], contextRule: l.contextRule ?? null, parentSlug: g.slug,
      variants: variants.filter((v) => v.slug.startsWith(l.slug + '.')),
    });
  }
  return out;
}

/** Deterministic value-slug for a variant name (exported for the ingest service and tests). */
export { slugifyValue };
