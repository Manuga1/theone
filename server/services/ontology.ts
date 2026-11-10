// Concept table access + tree building. The DB is the source of truth at runtime (shared/ontology.ts is the seed input).
import type { TreeNode, NodeState, LeafOverlay, OntologyResponse, TreeNodeExtras, ValueKind } from '@shared/api-types';
import { DEMO_TODAY, daysBetween } from '@shared/clock';
import { BRANCHING } from '@shared/branching';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';

export type ConceptRow = {
  id: number; slug: string; parent_id: number | null; name: string; level: 'domain' | 'group' | 'leaf' | 'variant'; weight: number;
  unit: string | null; data_type: TreeNode['dataType'] | null; min_span_days: number; freshness_days: number | null; collection_method: string | null;
  enrichable: number; comp_cents: number; device_cost_cents: number; reuse_comp_cents: number; in_ring: number; in_list: number; sort_order: number; description: string | null;
  value_kind: ValueKind | null; synonyms_json: string; follow_ups_json: string | null; context_rule_json: string | null; is_variant: number; created_at: string;
};

/** License (reuse) fee for a concept: the ontology's reuse_comp_cents, else ≈ 15 % of its collection comp with a 300¢ floor. */
export function reuseFeeCents(c: Pick<ConceptRow, 'comp_cents' | 'reuse_comp_cents'>): number {
  if (c.reuse_comp_cents > 0) return c.reuse_comp_cents;
  return Math.max(300, Math.round(c.comp_cents * 0.15));
}

const cache = new WeakMap<Db, { version: number; rows: ConceptRow[]; bySlug: Map<string, ConceptRow>; byId: Map<number, ConceptRow>; children: Map<number | null, ConceptRow[]> }>();

export function concepts(db: Db = graph()) {
  const hit = cache.get(db);
  if (hit && hit.version === db.writeVersion) return hit;
  const rows = db.tableExists('concept') ? db.all<ConceptRow>('SELECT * FROM concept ORDER BY sort_order') : [];
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<number | null, ConceptRow[]>();
  for (const r of rows) {
    const list = children.get(r.parent_id) ?? [];
    list.push(r);
    children.set(r.parent_id, list);
  }
  const entry = { version: db.writeVersion, rows, bySlug, byId, children };
  cache.set(db, entry);
  return entry;
}
/** A concept created within the last 30 days (variants from quick logs, review "create branch", buyer variable requests). */
export function isNewConcept(createdAt: string): boolean {
  return daysBetween(createdAt.slice(0, 10), DEMO_TODAY) <= BRANCHING.newConceptDays;
}
/** Drop the cached concept rows (a concept was inserted inside a still-open transaction). */
export function invalidateConcepts(db: Db = graph()): void {
  cache.delete(db);
}
export function conceptBySlug(slug: string, db: Db = graph()): ConceptRow | undefined {
  return concepts(db).bySlug.get(slug);
}
export function conceptPath(slug: string, db: Db = graph()): string[] {
  const { bySlug, byId } = concepts(db);
  const out: string[] = [];
  let c = bySlug.get(slug);
  while (c) { out.unshift(c.name); c = c.parent_id ? byId.get(c.parent_id) : undefined; }
  return out;
}
export function leaves(db: Db = graph()): ConceptRow[] {
  return concepts(db).rows.filter((r) => r.level === 'leaf');
}
/** Variant sub-branches of a leaf (level 'variant', parent_id = the leaf). */
export function variantsOf(leafId: number, db: Db = graph()): ConceptRow[] {
  return (concepts(db).children.get(leafId) ?? []).filter((r) => r.level === 'variant');
}
/** The leaf itself plus its variants: observations of a leaf live on any of these concept ids. */
export function familyIds(leaf: ConceptRow, db: Db = graph()): number[] {
  return [leaf.id, ...variantsOf(leaf.id, db).map((v) => v.id)];
}
/** For a variant, its leaf; for a leaf, itself. */
export function leafOf(c: ConceptRow, db: Db = graph()): ConceptRow {
  if (c.level !== 'variant' || !c.parent_id) return c;
  return concepts(db).byId.get(c.parent_id) ?? c;
}
export function domains(db: Db = graph()): ConceptRow[] {
  return concepts(db).rows.filter((r) => r.level === 'domain');
}

export type LeafInfo = { state: NodeState; overlay: LeafOverlay; pct: number; extras?: TreeNodeExtras };
const NO_OVERLAY: LeafOverlay = { opportunity: false, demand: false };

/** Builds the domain → group → leaf tree. `leafInfo` supplies state/overlay per leaf; group/domain pct are weighted. */
export function buildTree(leafInfo: (c: ConceptRow) => LeafInfo, db: Db = graph(), opts: { includeHidden?: boolean } = {}): TreeNode[] {
  const { children } = concepts(db);
  const node = (c: ConceptRow): TreeNode => {
    const base = {
      slug: c.slug, name: c.name, level: c.level as TreeNode['level'], dataType: c.data_type ?? undefined, unit: c.unit, inRing: !!c.in_ring, inList: !!c.in_list,
      compCents: c.comp_cents, deviceCostCents: c.device_cost_cents, reuseCompCents: c.level === 'leaf' ? reuseFeeCents(c) : 0, enrichable: !!c.enrichable, minSpanDays: c.min_span_days, collectionMethod: c.collection_method, weight: c.weight,
    };
    if (c.level === 'leaf') {
      const info = leafInfo(c);
      const variantCount = (children.get(c.id) ?? []).filter((k) => k.level === 'variant').length;
      return { ...base, valueKind: c.value_kind ?? undefined, variantCount, ...(info.extras ?? {}), pct: info.pct, state: info.state, overlay: info.overlay, children: [] };
    }
    const kids = (children.get(c.id) ?? []).filter((k) => opts.includeHidden || k.in_list || k.level !== 'leaf').map(node);
    const weighted = (children.get(c.id) ?? []).filter((k) => k.weight > 0);
    const pct = weighted.reduce((a, k) => {
      const kn = kids.find((x) => x.slug === k.slug);
      return a + k.weight * (kn ? kn.pct : 0);
    }, 0);
    const state: NodeState = pct >= 99.5 ? 'verified' : pct > 0 ? 'partial' : 'missing';
    return { ...base, pct: Math.round(pct * 10) / 10, state, overlay: NO_OVERLAY, children: kids };
  };
  return (children.get(null) ?? []).map(node);
}

/** Buyer-side ontology: structure + defaults only (no participant state); concepts created in the last 30 days are marked `isNew`. */
export function ontologyResponse(db: Db = graph()): OntologyResponse {
  const tree = buildTree((c) => ({ state: 'missing', overlay: NO_OVERLAY, pct: 0, extras: { isNew: isNewConcept(c.created_at) } }), db, { includeHidden: true });
  return { domains: tree, conceptCount: concepts(db).rows.filter((r) => r.level !== 'variant').length };
}
