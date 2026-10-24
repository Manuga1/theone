// Node states, overlays and weighted group/domain/overall completeness, as of a date.
//   verified: data exists ∧ best_prov_rank ≥ 2 ∧ span ≥ min_span_days ∧ fresh
//   partial:  a row exists but one test fails (e.g. self-report only, stale, too short)
//   missing:  nothing on record
import { DEMO_TODAY, daysBetween, addDays } from '@shared/clock';
import type { LeafOverlay, NodeState, ParticipantSignature, RingNode, TreeNode } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { coverageAsOf, coverageFor, type CoverageRow } from './coverage';
import { buildTree, concepts, leaves, type ConceptRow } from './ontology';

export type LeafEval = { slug: string; state: NodeState; score: number; reason: string | null; cov: CoverageRow | null };

export function leafState(c: ConceptRow, cov: CoverageRow | null | undefined, asOf = DEMO_TODAY): { state: NodeState; reason: string | null } {
  if (!cov || cov.n_obs <= 0) return { state: 'missing', reason: null };
  const last = cov.last_at.slice(0, 10);
  const first = cov.first_at.slice(0, 10);
  const effectiveLast = last < asOf ? last : asOf;
  const span = Math.max(0, daysBetween(first, effectiveLast));
  if (cov.best_prov_rank < 2) return { state: 'partial', reason: 'self-reported only' };
  if (span < c.min_span_days) return { state: 'partial', reason: `needs ${c.min_span_days} days of history (${span} so far)` };
  if (c.freshness_days !== null && daysBetween(last, asOf) > c.freshness_days) return { state: 'partial', reason: `last record ${daysBetween(last, asOf)} days ago` };
  return { state: 'verified', reason: null };
}
export function scoreOf(state: NodeState): number {
  return state === 'verified' ? 1 : state === 'partial' ? 0.5 : 0;
}

export type Completeness = {
  overall: number;
  domains: Map<string, number>;
  groups: Map<string, number>;
  leaves: Map<string, LeafEval>;
};

export function computeCompleteness(participantId: number, asOf = DEMO_TODAY, db: Db = graph()): Completeness {
  const cov = asOf === DEMO_TODAY ? coverageFor(participantId, db) : coverageAsOf(participantId, asOf, db);
  const { children, rows } = concepts(db);
  const leafMap = new Map<string, LeafEval>();
  for (const c of leaves(db)) {
    const r = cov.get(c.slug) ?? null;
    const { state, reason } = leafState(c, r, asOf);
    leafMap.set(c.slug, { slug: c.slug, state, score: scoreOf(state), reason, cov: r });
  }
  const groups = new Map<string, number>();
  const domainsM = new Map<string, number>();
  for (const g of rows.filter((r) => r.level === 'group')) {
    const kids = (children.get(g.id) ?? []).filter((k) => k.weight > 0);
    groups.set(g.slug, kids.reduce((a, k) => a + k.weight * (leafMap.get(k.slug)?.score ?? 0), 0) * 100);
  }
  let overall = 0;
  for (const d of rows.filter((r) => r.level === 'domain')) {
    const kids = (children.get(d.id) ?? []).filter((k) => k.weight > 0);
    const pct = kids.reduce((a, k) => a + k.weight * (groups.get(k.slug) ?? 0), 0);
    domainsM.set(d.slug, pct);
    overall += d.weight * pct;
  }
  return { overall, domains: domainsM, groups, leaves: leafMap };
}

/** Overall % now and the delta vs 30 days earlier (both rounded before subtracting). */
export function completenessSummary(participantId: number, db: Db = graph()): { pct: number; deltaMonth: number; now: Completeness } {
  const now = computeCompleteness(participantId, DEMO_TODAY, db);
  const before = computeCompleteness(participantId, addDays(DEMO_TODAY, -30), db);
  return { pct: Math.round(now.overall), deltaMonth: Math.round(now.overall) - Math.round(before.overall), now };
}

const OPEN = "('offered','viewed','reviewed')";

/** Overlays: `opportunity` when an open opportunity lists the leaf; `demand` when an active campaign collects it. */
export function overlays(participantId: number, db: Db = graph()): Map<string, LeafOverlay> {
  const out = new Map<string, LeafOverlay>();
  const get = (slug: string) => { let o = out.get(slug); if (!o) { o = { opportunity: false, demand: false }; out.set(slug, o); } return o; };
  if (db.tableExists('opportunity')) {
    for (const r of db.all<{ id: number; missing: string }>(`SELECT id, missing_concepts_json AS missing FROM opportunity WHERE participant_id = ? AND status IN ${OPEN} ORDER BY offered_at`, participantId)) {
      for (const slug of JSON.parse(r.missing) as string[]) {
        const o = get(slug);
        if (!o.opportunity) { o.opportunity = true; o.opportunityId = r.id; }
      }
    }
    for (const r of db.all<{ vars: string }>("SELECT variables_json AS vars FROM campaign WHERE status = 'active'")) {
      for (const v of JSON.parse(r.vars) as { conceptSlug: string; mode: string }[]) if (v.mode !== 'reuse') get(v.conceptSlug).demand = true;
    }
  }
  return out;
}

export function signatureTree(participantId: number, db: Db = graph()): { tree: TreeNode[]; completeness: Completeness; overlays: Map<string, LeafOverlay> } {
  const completeness = computeCompleteness(participantId, DEMO_TODAY, db);
  const ov = overlays(participantId, db);
  const tree = buildTree((c) => {
    const e = completeness.leaves.get(c.slug);
    const state = e?.state ?? 'missing';
    const o = ov.get(c.slug) ?? { opportunity: false, demand: false };
    return { state, pct: scoreOf(state) * 100, overlay: { opportunity: state !== 'verified' && o.opportunity, demand: o.demand, opportunityId: state !== 'verified' && o.opportunity ? o.opportunityId : undefined } };
  }, db);
  return { tree, completeness, overlays: ov };
}

export const SIGNATURE_LEGEND: ParticipantSignature['legend'] = [
  { key: 'verified', label: 'Verified' },
  { key: 'partial', label: 'Partial / self-reported' },
  { key: 'missing', label: 'Missing' },
  { key: 'opportunity', label: 'Opportunity' },
  { key: 'demand', label: 'Requested by research' },
];

export function ring(completeness: Completeness, db: Db = graph()): RingNode[] {
  return concepts(db).rows.filter((r) => r.level === 'domain' && r.in_ring).map((d) => ({ slug: d.slug, name: ringName(d), pct: Math.round(completeness.domains.get(d.slug) ?? 0) }));
}
function ringName(d: ConceptRow): string {
  const m = /\(([^)]+)\)/.exec(d.name);
  if (m) return m[1];
  return d.name.replace(' History', '');
}
