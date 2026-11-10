// Ingestion: the queue of uploads / quick logs / imports, filing a proposal as observations (variants, one_time
// versions, context side-effects), review actions and the logging-reward hook. Files are metadata only — nothing
// here stores bytes; an artifact row records name / size / sha256 so lineage still points at "the file".
import { createHash } from 'node:crypto';
import { DEMO_TODAY, nowIso, relative } from '@shared/clock';
import { PROVENANCE_RANK, type ProvenanceClass } from '@shared/provenance';
import type { IngestItem, IngestKind, IngestQueue, IngestStatus, NewConceptProposal, Proposal, ReviewAction, ReviewResult, UploadFileInput, UploadResult, ValueKind } from '@shared/api-types';
import { BRANCHING, resolveAttribute, normalise, valueLabel, variantSlugFor, type LeafSpec } from '@shared/branching';
import { slugifyValue } from '@shared/ontology';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { badRequest, conflict, notFound } from '../errors';
import { logActivity } from './activity';
import { appendAudit } from './audit';
import { classifierName, classifyUpload, leafSpecs } from './classify';
import { rebuildCoverage } from './coverage';
import { postLedger } from './ledger';
import { conceptBySlug, conceptPath, concepts, invalidateConcepts, leafOf, type ConceptRow } from './ontology';

export type IngestRow = {
  id: number; participant_id: number; kind: IngestKind; status: IngestStatus; filename: string | null; bytes: number | null; mime: string | null; text: string | null; sha256: string | null;
  proposal_json: string | null; review_reason: string | null; concept_id: number | null; observation_id: number | null; observation_count: number; reward_cents: number; created_at: string; resolved_at: string | null;
};
const STATUSES: IngestStatus[] = ['queued', 'auto_filed', 'needs_review', 'accepted', 'discarded'];

export function toItem(r: IngestRow, db: Db = graph()): IngestItem {
  const c = r.concept_id ? concepts(db).byId.get(r.concept_id) : undefined;
  return {
    id: r.id, kind: r.kind, status: r.status, filename: r.filename, bytes: r.bytes, mime: r.mime, text: r.text,
    proposal: r.proposal_json ? (JSON.parse(r.proposal_json) as Proposal) : null, reviewReason: r.review_reason,
    conceptSlug: c?.slug ?? null, conceptName: c?.name ?? null, observationId: r.observation_id, observationCount: r.observation_count,
    rewardCents: r.reward_cents, createdAt: r.created_at, relative: relative(r.created_at),
  };
}
export function ingestRow(id: number, participantId: number, db: Db = graph()): IngestRow | undefined {
  return db.get<IngestRow>('SELECT * FROM ingest_item WHERE id = ? AND participant_id = ?', id, participantId);
}

export function ingestQueue(participantId: number, status: string | undefined, db: Db = graph()): IngestQueue {
  const counts = { queued: 0, auto_filed: 0, needs_review: 0, accepted: 0, discarded: 0 } as Record<IngestStatus, number>;
  let items: IngestItem[] = [];
  if (db.tableExists('ingest_item')) {
    for (const r of db.all<{ status: IngestStatus; n: number }>('SELECT status, COUNT(*) AS n FROM ingest_item WHERE participant_id = ? GROUP BY status', participantId)) counts[r.status] = r.n;
    const rows = status && STATUSES.includes(status as IngestStatus)
      ? db.all<IngestRow>('SELECT * FROM ingest_item WHERE participant_id = ? AND status = ? ORDER BY created_at DESC, id DESC LIMIT 200', participantId, status)
      : db.all<IngestRow>('SELECT * FROM ingest_item WHERE participant_id = ? ORDER BY created_at DESC, id DESC LIMIT 200', participantId);
    items = rows.map((r) => toItem(r, db));
  }
  return { items, counts, classifier: classifierName(), maxFileBytes: BRANCHING.maxFileBytes, acceptedTypes: [...BRANCHING.acceptedTypes], reviewThreshold: BRANCHING.reviewThreshold };
}

// ------------------------------------------------------------------------------------------------ sources
const KIND_BY_DOMAIN: Record<string, string> = { imaging: 'imaging', biology: 'genomics' };
/** The source a filed item is attributed to: manual entry for logs, the matching connected source for uploads, else a generic "Uploads" source. */
export function sourceFor(db: Db, participantId: number, kind: IngestKind, leaf: ConceptRow | null, now: string): number {
  const find = (k: string) => db.get<{ id: number }>("SELECT id FROM source WHERE participant_id = ? AND kind = ? AND status = 'connected' ORDER BY id LIMIT 1", participantId, k)?.id;
  const create = (k: string, vendor: string, label: string, action: string, verified: number) =>
    db.run("INSERT INTO source (participant_id, kind, vendor, label, action_label, status, connected_at, last_sync_at, verified, sort_order, created_at) VALUES (?,?,?,?,?,'connected',?,?,?,90,?)", participantId, k, vendor, label, action, now, now, verified, now).lastId;
  let id: number | undefined;
  if (kind === 'quicklog' || kind === 'voice' || kind === 'checkin') id = find('self_report') ?? create('self_report', 'Manual entry', 'Self-reported', 'Add data', 0);
  else if (kind === 'apple_health') {
    // the seeded "Apple Health" card starts as available: the first import connects it (verified: it holds device data)
    const any = db.get<{ id: number }>("SELECT id FROM source WHERE participant_id = ? AND kind = 'apple_health' ORDER BY (status = 'connected') DESC, id LIMIT 1", participantId)?.id;
    id = any ?? create('apple_health', 'Apple Health', 'Apple Health (export.xml)', 'Import export.xml', 1);
    db.run("UPDATE source SET status = 'connected', verified = 1, connected_at = COALESCE(connected_at, ?) WHERE id = ?", now, id);
  } else {
    const domain = leaf?.slug.split('.')[0] ?? '';
    const wanted = kind === 'photo' && leaf?.slug === 'behavior.nutrition.food_log' ? 'nutrition' : leaf?.slug.startsWith('clinical.labs.') ? 'lab' : KIND_BY_DOMAIN[domain];
    id = (wanted ? find(wanted) : undefined) ?? find('upload') ?? create('upload', 'File upload', 'Uploads', 'Upload files', 0);
  }
  db.run('UPDATE source SET last_sync_at = ? WHERE id = ?', now, id);
  return id;
}

// ------------------------------------------------------------------------------------------------ concepts: variants + new leaves
export function ensureVariant(db: Db, leaf: ConceptRow, attribute: string, value: string, now: string): { concept: ConceptRow; created: boolean } {
  const slug = variantSlugFor(leaf, attribute, value);
  const existing = conceptBySlug(slug, db);
  if (existing) return { concept: existing, created: false };
  const maxOrder = db.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM concept')?.n ?? 0;
  db.run(
    "INSERT INTO concept (slug, parent_id, name, level, weight, unit, data_type, min_span_days, freshness_days, collection_method, enrichable, comp_cents, device_cost_cents, reuse_comp_cents, in_ring, in_list, sort_order, description, value_kind, synonyms_json, follow_ups_json, context_rule_json, is_variant, created_at) VALUES (?,?,?,'variant',0,?,?,0,NULL,?,0,0,0,0,0,0,?,?,?,?,NULL,NULL,1,?)",
    slug, leaf.id, value.trim().toLowerCase(), leaf.unit, leaf.data_type ?? null, leaf.collection_method, maxOrder + 1, `Sub-branch of ${leaf.name} (${attribute} = ${value})`, leaf.value_kind, JSON.stringify([value.trim().toLowerCase()]), now);
  invalidateConcepts(db);
  return { concept: conceptBySlug(slug, db)!, created: true };
}
const DATA_TYPE_BY_KIND: Record<ValueKind, string> = { continuous: 'time_series', float: 'structured', boolean: 'structured', text: 'structured', one_time: 'structured', categorical: 'structured', file: 'file', photo: 'file' };
export function createLeafConcept(db: Db, nc: NewConceptProposal, origin: string, now: string): { concept: ConceptRow; created: boolean } {
  const parent = conceptBySlug(nc.parentSlug, db);
  if (!parent || parent.level !== 'group') throw badRequest('newConcept.parentSlug must be an existing group (or set isVariantOf to a leaf)');
  const slug = `${parent.slug}.${slugifyValue(nc.name)}`;
  const existing = conceptBySlug(slug, db);
  if (existing) return { concept: existing, created: false };
  const maxOrder = db.get<{ n: number | null }>('SELECT MAX(sort_order) AS n FROM concept')?.n ?? 0;
  const vk = nc.valueKind;
  db.run(
    "INSERT INTO concept (slug, parent_id, name, level, weight, unit, data_type, min_span_days, freshness_days, collection_method, enrichable, comp_cents, device_cost_cents, reuse_comp_cents, in_ring, in_list, sort_order, description, value_kind, synonyms_json, follow_ups_json, context_rule_json, is_variant, created_at) VALUES (?,?,?,'leaf',0,?,?,0,NULL,?,0,0,0,0,0,1,?,?,?,?,NULL,NULL,0,?)",
    slug, parent.id, nc.name.trim(), nc.unit ?? null, DATA_TYPE_BY_KIND[vk] ?? 'structured', vk === 'file' || vk === 'photo' ? 'upload' : 'self_report', maxOrder + 1, `Created from review (${origin})`, vk, JSON.stringify([nc.name.trim().toLowerCase()]), now);
  invalidateConcepts(db);
  return { concept: conceptBySlug(slug, db)!, created: true };
}

// ------------------------------------------------------------------------------------------------ filing
export type FileOpts = {
  provenance: ProvenanceClass;
  /** a resolved categorical attribute value may create a missing variant (options, explicit follow-up answers, review) */
  allowVariantCreate: boolean;
  classifier: Proposal['classifier'];
  artifact?: { kind: string; uri: string; sha256: string; bytes: number } | null;
  /** file on this concept instead of proposal.conceptSlug (review "move") */
  conceptOverride?: ConceptRow | null;
  /** the original text (quick log) — context side-effects resolve their attribute from it */
  sourceText?: string | null;
};
export type Filed = { observationId: number; observationCount: number; concept: ConceptRow; leaf: ConceptRow; variantCreated: boolean; valueLabel: string; observedAt: string; path: string[] };

const OBS_SQL = 'INSERT INTO observation (participant_id, concept_id, value_num, value_text, value_json, unit, observed_at, valid_from, valid_to, source_id, method, provenance_class, provenance_rank, verification, confidence, artifact_id, derived_from_id, derivation, contribution_id, classification_json, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?)';

/** Write the observation(s) a proposal describes. Caller wraps in a transaction and rebuilds coverage. */
export function fileProposal(db: Db, participantId: number, item: { id: number; kind: IngestKind }, proposal: Proposal, opts: FileOpts, now: string): Filed {
  const target = opts.conceptOverride ?? (proposal.conceptSlug ? conceptBySlug(proposal.conceptSlug, db) : undefined);
  if (!target || (target.level !== 'leaf' && target.level !== 'variant')) throw notFound('concept');
  const leaf = leafOf(target, db);
  const spec = leafSpecs(db).find((l) => l.slug === leaf.slug);
  const e = proposal.extracted;
  const attrs: Record<string, string> = { ...(e.attributes ?? {}) };
  const valueKind: ValueKind = leaf.value_kind ?? 'text';

  // categorical: resolve the variant this observation is filed on
  let concept = target;
  let variantCreated = false;
  if (target.level === 'leaf' && valueKind === 'categorical' && spec?.followUps[0]) {
    const fu = spec.followUps[0];
    const value = attrs[fu.attribute];
    if (value && fu.createsSubBranch) {
      const existing = conceptBySlug(variantSlugFor(leaf, fu.attribute, value), db);
      if (existing) concept = existing;
      else if (opts.allowVariantCreate) { const v = ensureVariant(db, leaf, fu.attribute, value, now); concept = v.concept; variantCreated = v.created; }
    }
  } else if (target.level === 'variant') {
    const rest = target.slug.slice(leaf.slug.length + 1).split('.');
    if (rest[0] && !attrs[rest[0]]) attrs[rest[0]] = target.name;
  }

  const observedAt = e.observedAt && !Number.isNaN(Date.parse(e.observedAt)) ? e.observedAt : now;
  const rank = PROVENANCE_RANK[opts.provenance];
  const verification = rank >= 2 ? 'verified' : 'self_reported';
  const sourceId = sourceFor(db, participantId, item.kind, leaf, now);
  const method = item.kind === 'photo' ? 'photo' : item.kind === 'upload' ? 'upload' : item.kind === 'apple_health' ? 'import' : 'self_report';
  const classification = JSON.stringify({ classifier: opts.classifier, confidence: proposal.confidence, ingestItemId: item.id });
  const artifactId = opts.artifact ? db.run('INSERT INTO artifact (participant_id, source_id, kind, uri, sha256, bytes, captured_at, created_at) VALUES (?,?,?,?,?,?,?,?)', participantId, sourceId, opts.artifact.kind, opts.artifact.uri, opts.artifact.sha256, opts.artifact.bytes, observedAt, now).lastId : null;

  let valueNum: number | null = e.valueNum ?? null;
  let valueText: string | null = e.valueText ?? null;
  const json: Record<string, unknown> = {};
  if (attrs.systolic && attrs.diastolic) { json.systolic = Number(attrs.systolic); json.diastolic = Number(attrs.diastolic); valueNum = Number(attrs.systolic); }
  if (valueKind === 'boolean') { valueNum = e.valueBool === false ? 0 : 1; valueText = valueText ?? (e.valueBool === false ? 'no' : 'yes'); }
  if (valueKind === 'categorical' && e.valueBool === false) valueNum = 0;
  if (Object.keys(attrs).length) json.attributes = attrs;
  const unit = e.unit ?? leaf.unit;
  let validFrom: string | null = null;
  if (valueKind === 'one_time') {
    validFrom = observedAt.slice(0, 10);
    // updates append: close the previous open version(s) of this fact; nothing is overwritten
    db.run('UPDATE observation SET valid_to = ? WHERE participant_id = ? AND concept_id = ? AND deleted_at IS NULL AND valid_to IS NULL AND observed_at < ?', validFrom, participantId, concept.id, observedAt);
  }
  const observationId = db.run(OBS_SQL, participantId, concept.id, valueNum, valueText, Object.keys(json).length ? JSON.stringify(json) : null, unit, observedAt, validFrom, null, sourceId, method, opts.provenance, rank, verification,
    proposal.confidence, artifactId, classification, now).lastId;
  let observationCount = 1;

  // context side-effect: heart rate during exercise also files an exercise session
  const rule = spec?.contextRule;
  if (rule?.alsoFile && attrs.context === rule.alsoFile.context) {
    const also = conceptBySlug(rule.alsoFile.slug, db);
    const alsoSpec = leafSpecs(db).find((l) => l.slug === rule.alsoFile!.slug);
    if (also && also.level === 'leaf') {
      let alsoConcept = also;
      const alsoAttrs: Record<string, string> = { context: attrs.context, from: leaf.slug };
      const text = opts.sourceText ?? valueText;
      if (alsoSpec && text) {
        const hit = resolveAttribute(alsoSpec, normalise(text), null);
        if (hit) { alsoAttrs[hit.attribute] = hit.value; alsoConcept = hit.variant ? conceptBySlug(hit.variant.slug, db) ?? also : ensureVariant(db, also, hit.attribute, hit.value, now).concept; }
      }
      db.run(OBS_SQL, participantId, alsoConcept.id, null, valueText, JSON.stringify({ attributes: alsoAttrs }), also.unit, observedAt, null, null, sourceId, method, opts.provenance, rank, verification, proposal.confidence, null, classification, now);
      observationCount++;
    }
  }
  const label = valueLabel({ valueKind, unit: leaf.unit, name: leaf.name }, { ...e, attributes: attrs });
  const path = conceptPath(concept.slug, db);
  return { observationId, observationCount, concept, leaf, variantCreated, valueLabel: label, observedAt, path };
}

// ------------------------------------------------------------------------------------------------ rewards (stage 2 seeds the rules; the hook is live)
type RuleRow = { id: number; cents: number; daily_cap_cents: number | null; funded_kind: 'campaign' | 'platform'; study_id: number | null; per_unit_label: string; study_name: string | null };
/** Reward for one filed item: an active reward_rule on the leaf, unless the participant is vault-only; respects the daily cap. Posts a ledger row. */
export function grantReward(db: Db, participantId: number, leaf: ConceptRow, itemId: number, now: string): number {
  if (!db.tableExists('reward_rule')) return 0;
  const vault = db.get<{ v: number }>('SELECT vault_only AS v FROM consent_setting WHERE participant_id = ?', participantId)?.v ?? 0;
  if (vault) return 0;
  const rule = db.get<RuleRow>(
    `SELECT r.id, r.cents, r.daily_cap_cents, r.funded_kind, r.study_id, r.per_unit_label, s.name AS study_name FROM reward_rule r LEFT JOIN study s ON s.id = r.study_id
      WHERE r.concept_id = ? AND r.active = 1 AND (r.participant_id IS NULL OR r.participant_id = ?) ORDER BY r.participant_id DESC LIMIT 1`, leaf.id, participantId);
  if (!rule || rule.cents <= 0) return 0;
  const today = now.slice(0, 10);
  const paidToday = db.get<{ c: number }>('SELECT COALESCE(SUM(reward_cents), 0) AS c FROM ingest_item WHERE participant_id = ? AND concept_id = ? AND substr(COALESCE(resolved_at, created_at), 1, 10) = ?', participantId, leaf.id, today)?.c ?? 0;
  const cents = rule.daily_cap_cents === null ? rule.cents : Math.max(0, Math.min(rule.cents, rule.daily_cap_cents - paidToday));
  if (cents <= 0) return 0;
  postLedger(db, { participantId, kind: 'contribution_payment', netCents: cents, occurredAt: now, studyId: rule.study_id, memo: `Logging reward: ${leaf.name} (${rule.per_unit_label}) — funded by ${rule.funded_kind === 'campaign' ? rule.study_name ?? 'a campaign' : 'the platform'}` });
  db.run('UPDATE ingest_item SET reward_cents = ? WHERE id = ?', cents, itemId);
  return cents;
}

// ------------------------------------------------------------------------------------------------ queue writes
const EVENT_CATEGORY = (slug: string): string => {
  if (slug.startsWith('clinical.labs.')) return 'labs';
  if (slug.startsWith('clinical.medications.')) return 'medications';
  if (slug.startsWith('clinical.') || slug.startsWith('outcomes.')) return 'clinical';
  if (slug.startsWith('imaging.')) return 'imaging';
  if (slug.startsWith('biology.')) return 'genomics';
  return 'lifestyle';
};
export function insertItem(db: Db, participantId: number, row: { kind: IngestKind; status: IngestStatus; filename?: string | null; bytes?: number | null; mime?: string | null; text?: string | null; sha256?: string | null; proposal: Proposal | null; reviewReason?: string | null; createdAt: string }): number {
  return db.run(
    'INSERT INTO ingest_item (participant_id, kind, status, filename, bytes, mime, text, sha256, proposal_json, review_reason, concept_id, observation_id, observation_count, reward_cents, created_at, resolved_at) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,0,0,?,NULL)',
    participantId, row.kind, row.status, row.filename ?? null, row.bytes ?? null, row.mime ?? null, row.text ?? null, row.sha256 ?? null, row.proposal ? JSON.stringify(row.proposal) : null, row.reviewReason ?? null, row.createdAt).lastId;
}
/** File a proposal for an existing queue row, mark it filed, log, reward. Caller wraps in a tx. */
export function fileItem(db: Db, participantId: number, itemId: number, kind: IngestKind, proposal: Proposal, opts: FileOpts, status: 'auto_filed' | 'accepted', now: string): Filed & { rewardCents: number } {
  const sourceText = opts.sourceText ?? db.get<{ t: string | null }>('SELECT text AS t FROM ingest_item WHERE id = ?', itemId)?.t ?? null;
  const filed = fileProposal(db, participantId, { id: itemId, kind }, proposal, { ...opts, sourceText }, now);
  const finalProposal: Proposal = { ...proposal, conceptSlug: filed.leaf.slug, conceptName: filed.leaf.name, path: conceptPath(filed.leaf.slug, db), newConcept: null };
  db.run('UPDATE ingest_item SET status = ?, concept_id = ?, observation_id = ?, observation_count = ?, proposal_json = ?, review_reason = NULL, resolved_at = ? WHERE id = ?',
    status, filed.leaf.id, filed.observationId, filed.observationCount, JSON.stringify(finalProposal), now, itemId);
  const rewardCents = grantReward(db, participantId, filed.leaf, itemId, now);
  if (filed.variantCreated) auditBranch(db, participantId, filed.concept, `quick log${kind === 'checkin' ? ' (check-in)' : ''}: “${(sourceText ?? '').slice(0, 60)}”`, now);
  const what = kind === 'upload' || kind === 'photo' ? 'Upload filed' : kind === 'apple_health' ? 'Apple Health import' : kind === 'checkin' ? 'Check-in filed' : 'Quick log filed';
  logActivity(db, { participantId, kind: `ingest_${kind}`, text: `${what}: ${filed.path.join(' › ')}${filed.valueLabel ? ` — ${filed.valueLabel}` : ''}${filed.variantCreated ? ' (new sub-branch)' : ''}${rewardCents ? ` · +$${(rewardCents / 100).toFixed(2)}` : ''}`, amountCents: rewardCents || null, occurredAt: now });
  db.run('INSERT INTO event (participant_id, occurred_at, kind, category, title, detail, concept_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
    participantId, filed.observedAt, kind === 'upload' || kind === 'photo' ? 'upload' : kind === 'apple_health' ? 'import' : 'log', EVENT_CATEGORY(filed.leaf.slug), `${filed.leaf.name}${filed.concept.id !== filed.leaf.id ? ` › ${filed.concept.name}` : ''}`, filed.valueLabel || null, filed.leaf.id, now);
  rebuildCoverage(participantId, db);
  return { ...filed, rewardCents };
}

/** A new branch (variant or leaf) changes the participant's ontology: audited like any governance write. */
export function auditBranch(db: Db, participantId: number, c: ConceptRow, origin: string, now: string): void {
  appendAudit(db, { participantId, kind: 'branch_created', refTable: 'concept', refId: c.id, at: now, summary: `New ${c.level === 'variant' ? 'sub-branch' : 'branch'} ${conceptPath(c.slug, db).join(' › ')} created from ${origin}`, payload: { slug: c.slug, level: c.level, parentId: c.parent_id, valueKind: c.value_kind } });
}

// ------------------------------------------------------------------------------------------------ uploads
const ARTIFACT_KIND = (name: string, mime: string, slug: string | null): string => {
  const n = name.toLowerCase();
  if (/\.(dcm|dicom|nii|nii\.gz)$/.test(n) || mime.includes('dicom') || slug?.startsWith('imaging.')) return 'dicom';
  if (/\.vcf(\.gz)?$/.test(n) || slug?.startsWith('biology.genomics.')) return 'vcf';
  if (mime.startsWith('image/')) return 'photo';
  if (n.endsWith('.pdf')) return 'ehr_doc';
  if (/\.(csv|json)$/.test(n)) return 'device_raw';
  return 'file';
};

export async function uploadFiles(participantId: number, files: UploadFileInput[], db: Db = graph()): Promise<UploadResult> {
  if (!Array.isArray(files) || files.length === 0) throw badRequest('files[] is required');
  if (files.length > 50) throw badRequest('at most 50 files per upload');
  const now = nowIso();
  const result: UploadResult = { items: [], autoFiled: 0, needsReview: 0, rejected: [], rewardCents: 0 };
  for (const raw of files) {
    const f: UploadFileInput = { name: String(raw?.name ?? ''), bytes: Number(raw?.bytes ?? 0), mime: String(raw?.mime ?? ''), sha256: raw?.sha256 ?? null, textSample: raw?.textSample ? String(raw.textSample).slice(0, 8000) : null, lastModified: raw?.lastModified ?? null };
    const r = await classifyUpload(f, db);
    if (r.route.kind === 'reject') { result.rejected.push({ name: f.name, reason: r.route.reason }); continue; }
    if (r.route.kind === 'apple_health') { result.rejected.push({ name: f.name, reason: 'Apple Health export: use "Import export.xml" (POST /import/apple-health) so the records are parsed' }); continue; }
    const route = r.route;
    const sha = f.sha256 ?? createHash('sha256').update(`${f.name}:${f.bytes}:${f.mime}`).digest('hex');
    const itemId = db.tx(() => {
      const id = insertItem(db, participantId, { kind: route.ingestKind, status: r.status === 'auto_filed' ? 'auto_filed' : 'needs_review', filename: f.name, bytes: f.bytes, mime: f.mime || null, text: f.textSample, sha256: sha, proposal: route.proposal, reviewReason: route.reviewReason, createdAt: now });
      if (r.status === 'auto_filed') {
        const filed = fileItem(db, participantId, id, route.ingestKind, route.proposal, { provenance: route.provenance, allowVariantCreate: true, classifier: route.proposal.classifier, artifact: { kind: ARTIFACT_KIND(f.name, f.mime, route.proposal.conceptSlug), uri: `upload://${id}/${encodeURIComponent(f.name)}`, sha256: sha, bytes: f.bytes } }, 'auto_filed', now);
        result.rewardCents += filed.rewardCents;
        result.autoFiled++;
      } else {
        result.needsReview++;
        logActivity(db, { participantId, kind: 'ingest_review', text: `Upload needs a look: ${f.name} — ${route.reviewReason ?? 'low confidence'}`, occurredAt: now });
      }
      return id;
    });
    result.items.push(toItem(ingestRow(itemId, participantId, db)!, db));
  }
  return result;
}

// ------------------------------------------------------------------------------------------------ review
export function reviewItem(participantId: number, itemId: number, action: ReviewAction, db: Db = graph()): ReviewResult {
  const row = ingestRow(itemId, participantId, db);
  if (!row) throw notFound('ingest item');
  if (row.status !== 'needs_review' && row.status !== 'queued') throw conflict(`item is ${row.status}; only needs_review items can be reviewed`);
  if (!action || typeof action !== 'object' || !('action' in action)) throw badRequest('action is required');
  const proposal: Proposal = row.proposal_json ? (JSON.parse(row.proposal_json) as Proposal) : { conceptSlug: null, conceptName: null, path: [], newConcept: null, confidence: 0, rationale: '', extracted: { valueText: row.text, observedAt: row.created_at, attributes: {} }, followUp: null, classifier: 'rules', alternatives: [] };
  const now = nowIso();
  const provenance: ProvenanceClass = row.kind === 'photo' ? 'photo_derived' : row.kind === 'upload' ? (proposal.conceptSlug?.startsWith('physiology.') || proposal.conceptSlug?.startsWith('behavior.') ? 'connected_device' : 'clinical_source') : 'self_report';
  const artifact = row.filename ? { kind: ARTIFACT_KIND(row.filename, row.mime ?? '', proposal.conceptSlug), uri: `upload://${row.id}/${encodeURIComponent(row.filename)}`, sha256: row.sha256 ?? createHash('sha256').update(row.filename).digest('hex'), bytes: row.bytes ?? 0 } : null;

  return db.tx(() => {
    let createdConcept: ReviewResult['createdConcept'] = null;
    let filed: (Filed & { rewardCents: number }) | null = null;
    const file = (p: Proposal, override: ConceptRow | null) => fileItem(db, participantId, row.id, row.kind, p, { provenance, allowVariantCreate: true, classifier: p.classifier, artifact, conceptOverride: override }, 'accepted', now);
    switch (action.action) {
      case 'discard':
        db.run("UPDATE ingest_item SET status = 'discarded', resolved_at = ? WHERE id = ?", now, row.id);
        logActivity(db, { participantId, kind: 'ingest_discard', text: `Discarded: ${row.filename ?? row.text ?? 'item'}`, occurredAt: now });
        break;
      case 'accept': {
        if (proposal.newConcept) return reviewItem(participantId, itemId, { action: 'create_branch', newConcept: proposal.newConcept }, db);
        if (!proposal.conceptSlug) throw badRequest('nothing to accept: the proposal names no concept — move it or create a branch');
        filed = file(proposal, null);
        break;
      }
      case 'move': {
        const target = conceptBySlug(String(action.conceptSlug ?? ''), db);
        if (!target || (target.level !== 'leaf' && target.level !== 'variant')) throw notFound('concept');
        const leaf = leafOf(target, db);
        filed = file({ ...proposal, conceptSlug: leaf.slug, conceptName: leaf.name, path: conceptPath(leaf.slug, db), newConcept: null }, target);
        break;
      }
      case 'create_branch': {
        const nc = action.newConcept;
        if (!nc || typeof nc !== 'object' || !nc.name?.trim() || !nc.parentSlug) throw badRequest('newConcept { name, parentSlug, valueKind, isVariantOf? } is required');
        let target: ConceptRow;
        if (nc.isVariantOf) {
          const leaf = conceptBySlug(nc.isVariantOf, db);
          if (!leaf || leaf.level !== 'leaf') throw notFound('isVariantOf leaf');
          const spec = leafSpecs(db).find((l) => l.slug === leaf.slug);
          const attribute = spec?.followUps[0]?.attribute ?? 'value';
          const v = ensureVariant(db, leaf, attribute, nc.name, now);
          target = v.concept;
          if (v.created) { createdConcept = { slug: target.slug, name: target.name, path: conceptPath(target.slug, db) }; auditBranch(db, participantId, target, `review of item #${row.id}`, now); }
          const p: Proposal = { ...proposal, conceptSlug: leaf.slug, conceptName: leaf.name, path: conceptPath(leaf.slug, db), newConcept: null, extracted: { ...proposal.extracted, attributes: { ...(proposal.extracted.attributes ?? {}), [attribute]: target.name } } };
          filed = file(p, target);
        } else {
          const valueKind = nc.valueKind ?? (row.kind === 'upload' ? 'file' : row.kind === 'photo' ? 'photo' : 'text');
          const c = createLeafConcept(db, { ...nc, valueKind }, row.filename ?? row.text ?? `item ${row.id}`, now);
          target = c.concept;
          if (c.created) { createdConcept = { slug: target.slug, name: target.name, path: conceptPath(target.slug, db) }; auditBranch(db, participantId, target, `review of item #${row.id}`, now); }
          filed = file({ ...proposal, conceptSlug: target.slug, conceptName: target.name, path: conceptPath(target.slug, db), newConcept: null }, target);
        }
        if (createdConcept) logActivity(db, { participantId, kind: 'branch_created', text: `New branch created from review: ${createdConcept.path.join(' › ')}`, occurredAt: now });
        break;
      }
      default:
        throw badRequest(`unknown action ${(action as { action: string }).action}`);
    }
    if (filed?.variantCreated && !createdConcept) createdConcept = { slug: filed.concept.slug, name: filed.concept.name, path: filed.path };
    return { item: toItem(ingestRow(row.id, participantId, db)!, db), createdConcept, rewardCents: filed?.rewardCents ?? 0 };
  });
}

/** Counts for the home card: items waiting for review and items auto-filed today. */
export function inboxCounts(participantId: number, db: Db = graph()): { needsReview: number; autoFiledToday: number } {
  if (!db.tableExists('ingest_item')) return { needsReview: 0, autoFiledToday: 0 };
  return {
    needsReview: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ingest_item WHERE participant_id = ? AND status = 'needs_review'", participantId)?.n ?? 0,
    autoFiledToday: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ingest_item WHERE participant_id = ? AND status IN ('auto_filed', 'accepted') AND substr(created_at, 1, 10) = ?", participantId, DEMO_TODAY)?.n ?? 0,
  };
}
export { type LeafSpec };
