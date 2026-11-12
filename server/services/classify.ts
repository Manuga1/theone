// Classifier: the rule engine (shared/branching.ts) always runs; Claude is layered on top when an Anthropic credential is
// configured (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth` profile). CLASSIFIER=rules forces the rules
// (tests always set it); CLASSIFIER=claude forces an attempt even without an env credential (ant auth profile).
// Any API/auth error falls back to the rules and records classifier: 'rules'. Never called from tests with Claude.
// Hosted deployments (isHosted()) always classify by rules, whatever credential is present: quick logs and upload text
// would otherwise leave the server for a third party. HOSTED_CLASSIFIER=claude lifts that, and must only be set after a
// data-processing agreement with the model provider is in place AND the consent / privacy notice discloses the processing.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { nowIso } from '@shared/clock';
import type { ClassifierName, Proposal, UploadFileInput } from '@shared/api-types';
import { BRANCHING, classifyText, decide, routeFile, thresholdFor, type FileRoute, type LeafSpec, type TextClassification, type VariantSpec } from '@shared/branching';
import type { ContextRule, FollowUpDef } from '@shared/ontology';
import { graph } from '../db/graph';
import { isHosted } from '../db/paths';
import type { Db } from '../db/driver';
import { concepts, conceptPath, type ConceptRow } from './ontology';

// ------------------------------------------------------------------------------------------------ leaf specs from the DB
const specCache = new WeakMap<Db, { source: object; specs: LeafSpec[] }>();

/** Leaf specs (synonyms, follow-ups, context rules, existing variants) from the concept table; cached per concept-cache entry. */
export async function leafSpecs(db: Db = graph()): Promise<LeafSpec[]> {
  const entry = await concepts(db);
  const hit = specCache.get(db);
  if (hit && hit.source === entry) return hit.specs;
  const { rows, byId, children } = entry;
  const specs: LeafSpec[] = [];
  for (const c of rows) {
    if (c.level !== 'leaf') continue;
    const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
    const variants: VariantSpec[] = (children.get(c.id) ?? []).filter((k) => k.level === 'variant').map((k) => variantSpecOf(k, c));
    specs.push({
      slug: c.slug, name: c.name, path: await conceptPath(c.slug, db), valueKind: c.value_kind ?? 'text', unit: c.unit, method: c.collection_method,
      synonyms: safeJson<string[]>(c.synonyms_json, []), followUps: safeJson<FollowUpDef[] | null>(c.follow_ups_json, null) ?? [],
      contextRule: safeJson<ContextRule | null>(c.context_rule_json, null), variants, parentSlug: parent?.slug ?? c.slug.split('.').slice(0, 2).join('.'),
    });
  }
  specCache.set(db, { source: entry, specs });
  return specs;
}
export function variantSpecOf(k: ConceptRow, leaf: ConceptRow): VariantSpec {
  const rest = k.slug.slice(leaf.slug.length + 1).split('.');
  return { slug: k.slug, name: k.name, attribute: rest[0] ?? 'value', value: k.name.toLowerCase() };
}
function safeJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
/** Accepted (auto-filed or accepted) ingest items per concept: the per-concept relaxation counter. */
export async function acceptedCount(conceptId: number, db: Db = graph()): Promise<number> {
  if (!await db.tableExists('ingest_item')) return 0;
  return (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ingest_item WHERE concept_id = ? AND status IN ('auto_filed', 'accepted')", conceptId))?.n ?? 0;
}
export async function thresholdForConcept(conceptId: number | null, db: Db = graph()): Promise<number> {
  return thresholdFor(conceptId ? await acceptedCount(conceptId, db) : 0);
}

// ------------------------------------------------------------------------------------------------ Claude
const ProposalSchema = z.object({
  conceptSlug: z.string().nullable().describe('slug of the best existing leaf, or null when none fits'),
  newConcept: z.object({
    name: z.string(),
    parentSlug: z.string().describe('an existing group slug for a new leaf, or the leaf slug when isVariantOf is set'),
    valueKind: z.enum(['continuous', 'float', 'boolean', 'text', 'one_time', 'categorical', 'file', 'photo']),
    unit: z.string().nullable(),
    isVariantOf: z.string().nullable().describe('leaf slug when this is a sub-branch (variant) of an existing categorical leaf'),
  }).nullable(),
  confidence: z.number().min(0).max(1),
  extracted: z.object({
    valueNum: z.number().nullable(),
    valueText: z.string().nullable(),
    valueBool: z.boolean().nullable(),
    unit: z.string().nullable(),
    observedAt: z.string().nullable().describe('ISO timestamp, resolved against the given current time'),
    attributes: z.array(z.object({ key: z.string(), value: z.string() })).describe('e.g. systolic/diastolic, brand, drink, activity, context'),
    context: z.enum(['rest', 'exercise', 'sleep']).nullable(),
  }),
  followUp: z.object({ attribute: z.string(), question: z.string(), options: z.array(z.string()).nullable(), createsSubBranch: z.boolean() }).nullable(),
  rationale: z.string(),
});
type ClaudeProposal = z.infer<typeof ProposalSchema>;

let client: Anthropic | null | undefined;
let disabledReason: string | null = null;

function envWantsClaude(): boolean {
  if (isHosted() && (process.env.HOSTED_CLASSIFIER ?? '').toLowerCase() !== 'claude') return false;
  const mode = (process.env.CLASSIFIER ?? '').toLowerCase();
  if (mode === 'rules') return false;
  if (mode === 'claude') return true;
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function anthropic(): Anthropic | null {
  if (client !== undefined) return client;
  if (!envWantsClaude()) { client = null; return client; }
  try {
    client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
  } catch (e) {
    disabledReason = `Anthropic client not configured: ${(e as Error).message}`;
    client = null;
  }
  return client;
}
/** Which classifier files uploads and quick logs right now. */
export function classifierName(): ClassifierName {
  return anthropic() ? 'claude' : 'rules';
}
/** Tests and the demo reset: forget the client so env changes are picked up. */
export function resetClassifier(): void {
  client = undefined;
  disabledReason = null;
  promptCache = null;
}
export function classifierDisabledReason(): string | null {
  return disabledReason;
}

let promptCache: { source: object; text: string } | null = null;
async function ontologyPrompt(db: Db): Promise<string> {
  const source = await leafSpecs(db);
  if (promptCache && promptCache.source === source) return promptCache.text;
  const compact = (await leafSpecs(db)).map((l) => ({
    slug: l.slug, name: l.name, valueKind: l.valueKind, unit: l.unit, synonyms: l.synonyms,
    followUps: l.followUps.map((f) => ({ attribute: f.attribute, question: f.question, options: f.options ?? null, createsSubBranch: f.createsSubBranch })),
    variants: l.variants.map((v) => ({ slug: v.slug, [v.attribute]: v.value })),
    contextRule: l.contextRule ? { attribute: 'context', contexts: l.contextRule.rules.map((r) => r.context), default: l.contextRule.default } : null,
  }));
  const text = [
    'You file a participant\'s health data into their personal health graph. Pick the ONE best existing leaf, or propose a new concept.',
    'Rules:',
    '1. Quick logs are self-reports. Prefer leaves fed by self-report / devices over record- or lab-fed concepts for the same measurement (home BP over clinic BP).',
    '2. Detect negation ("didn\'t", "no", "skipped"): boolean → false, counts → 0; no follow-up when negated.',
    '3. Resolve times against the given current time: "this morning" 08:00, "last night" previous day 22:00, "yesterday", "at 8pm"; a clock time after now means the previous day. Default: now.',
    '4. Extract number + unit and convert to the leaf unit: 120/80 → systolic/diastolic mmHg; lb → kg; mmol/L → mg/dL (×18); "10,000 steps"; "7 h sleep".',
    '5. Type rules: continuous/float need a value (else followUp {attribute:"value"}); boolean = true unless negated; text verbatim; one_time appends a new version; categorical must resolve its follow-up attribute (brand, drink, activity, score): an existing variant or option → attributes; a value that is neither → newConcept with isVariantOf = the leaf (a new sub-branch); unknown → followUp with the leaf\'s question.',
    '6. Continuous leaves with a contextRule store attributes.context (exercise / sleep / rest) from the wording.',
    '7. confidence is your probability that the chosen leaf is right (0..1). Genuinely new data points (no leaf fits) → conceptSlug null + newConcept (parentSlug = an existing group) and a lower confidence; they are reviewed by a person.',
    '8. Never invent slugs: conceptSlug and parentSlug must come from the ontology below.',
    `9. Auto-filing threshold: ${BRANCHING.reviewThreshold}.`,
    'Ontology (leaves):',
    JSON.stringify(compact),
  ].join('\n');
  promptCache = { source, text };
  return text;
}

async function askClaude(input: string, db: Db): Promise<ClaudeProposal | null> {
  const c = anthropic();
  if (!c) return null;
  try {
    const r = await c.messages.parse({
      model: process.env.CLASSIFIER_MODEL ?? 'claude-opus-5-5',
      max_tokens: 2048,
      system: [{ type: 'text', text: await ontologyPrompt(db), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: input }],
      output_config: { format: zodOutputFormat(ProposalSchema) },
    });
    if (r.stop_reason === 'refusal') return null;
    return r.parsed_output ?? null;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      disabledReason = 'Anthropic credential rejected (401) — using the rule classifier';
      client = null;
    } else if (e instanceof Anthropic.APIError) {
      disabledReason = `Anthropic API error ${e.status ?? ''}: ${e.message}`.trim();
    } else {
      disabledReason = `classifier error: ${(e as Error).message}`;
    }
    return null;
  }
}

/** Merge Claude's answer onto the rule proposal; anything that does not validate against the ontology keeps the rules' answer. */
function merge(rules: Proposal, claude: ClaudeProposal | null, specs: LeafSpec[]): Proposal {
  if (!claude) return rules;
  const bySlug = new Map(specs.map((s) => [s.slug, s]));
  const leaf = claude.conceptSlug ? bySlug.get(claude.conceptSlug) : undefined;
  if (claude.conceptSlug && !leaf) return rules; // invented slug → rules
  let newConcept: Proposal['newConcept'] = null;
  if (claude.newConcept) {
    const nc = claude.newConcept;
    const parentOk = nc.isVariantOf ? bySlug.has(nc.isVariantOf) : specs.some((s) => s.parentSlug === nc.parentSlug);
    if (!parentOk) return rules;
    newConcept = { name: nc.name, parentSlug: nc.isVariantOf ?? nc.parentSlug, valueKind: nc.valueKind, unit: nc.unit, isVariantOf: nc.isVariantOf };
  }
  const attributes: Record<string, string> = {};
  for (const a of claude.extracted.attributes) if (a.key && a.value) attributes[a.key] = a.value;
  const observedAt = claude.extracted.observedAt && !Number.isNaN(Date.parse(claude.extracted.observedAt)) ? new Date(claude.extracted.observedAt).toISOString().replace('.000Z', 'Z') : rules.extracted.observedAt ?? nowIso();
  return {
    conceptSlug: leaf?.slug ?? null, conceptName: leaf?.name ?? null, path: leaf?.path ?? [], newConcept,
    confidence: Math.max(0, Math.min(1, Math.round(claude.confidence * 100) / 100)),
    rationale: claude.rationale,
    extracted: { valueNum: claude.extracted.valueNum, valueText: claude.extracted.valueText, valueBool: claude.extracted.valueBool, unit: claude.extracted.unit ?? leaf?.unit ?? null, observedAt, attributes, context: claude.extracted.context },
    followUp: claude.followUp ? { attribute: claude.followUp.attribute, question: claude.followUp.question, options: claude.followUp.options ?? undefined, createsSubBranch: claude.followUp.createsSubBranch } : null,
    classifier: 'claude',
    alternatives: rules.alternatives.filter((a) => a.conceptSlug !== leaf?.slug),
  };
}

// ------------------------------------------------------------------------------------------------ public API
export type TextResult = TextClassification & { status: 'auto_filed' | 'needs_review' | 'follow_up'; threshold: number };

/** Classify a quick log / voice transcript / check-in answer. */
export async function classifyQuickLog(text: string, db: Db = graph()): Promise<TextResult> {
  const specs = await leafSpecs(db);
  const rules = classifyText(text, specs, nowIso());
  const claude = await askClaude(`Current time: ${nowIso()}\nQuick log: ${text}`, db);
  const proposal = merge(rules.proposal, claude, specs);
  return await finish({ ...rules, proposal }, db);
}
async function finish(r: TextClassification, db: Db): Promise<TextResult> {
  const leafId = r.proposal.conceptSlug ? (await concepts(db)).bySlug.get(r.proposal.conceptSlug)?.id ?? null : null;
  const threshold = await thresholdForConcept(leafId, db);
  const status = r.proposal.followUp && !r.proposal.newConcept && r.proposal.conceptSlug && r.proposal.confidence >= threshold ? 'follow_up' : decide(r.proposal, leafId ? await acceptedCount(leafId, db) : 0);
  return { ...r, status, threshold };
}

export type FileResult = { route: FileRoute; status: 'auto_filed' | 'needs_review' | null; threshold: number };

/** Classify an uploaded file's metadata (name / size / MIME / text sample). */
export async function classifyUpload(file: UploadFileInput, db: Db = graph()): Promise<FileResult> {
  const specs = await leafSpecs(db);
  const route = routeFile(file, specs, nowIso());
  if (route.kind !== 'proposal') return { route, status: null, threshold: BRANCHING.reviewThreshold };
  const claude = await askClaude(`Current time: ${nowIso()}\nUploaded file (metadata only): name=${file.name} bytes=${file.bytes} mime=${file.mime || 'unknown'}${file.textSample ? `\nText sample:\n${file.textSample.slice(0, 4000)}` : ''}`, db);
  const proposal = merge(route.proposal, claude, specs);
  const leafId = proposal.conceptSlug ? (await concepts(db)).bySlug.get(proposal.conceptSlug)?.id ?? null : null;
  const threshold = await thresholdForConcept(leafId, db);
  const status = decide(proposal, leafId ? await acceptedCount(leafId, db) : 0);
  return { route: { ...route, proposal, reviewReason: status === 'needs_review' ? route.reviewReason ?? (proposal.newConcept ? 'Proposes a new branch' : `Confidence ${proposal.confidence} is below ${threshold}`) : null }, status, threshold };
}
