// Helpers shared by the buyer screens: saved-cohort loading, the cohort step bar, the red-line banner, and the
// translation of cohort criteria into default campaign variables (using ontology collection defaults, never literals).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { CohortPreview, DemoState, OntologyResponse, SavedCohortDetail, TreeNode } from '@shared/api-types';
import type { CohortCriteria } from '@shared/criteria';
import { DEFAULT_CRITERIA } from '@shared/criteria';
import type { CampaignVariable, ProtocolRequirement, VariableMode } from '@shared/requirement';
import { api } from '../api';
import { useApi, usePersona } from '../hooks';
import { StepBar, type Step } from '../components/StepBar';
import { ErrorBox } from '../components/EmptyState';

export function useCohort(id: string | undefined) {
  return useApi<SavedCohortDetail>(id ? `/buyer/cohorts/${id}` : null);
}

export function cohortSteps(id: string | undefined): Step[] {
  const base = id ? `/b/cohorts/${id}` : '/b/cohorts/new';
  return [
    { key: 'define', label: 'Define', href: id ? `${base}/define` : base },
    { key: 'review', label: 'Review', href: id ? `${base}/funnel` : undefined },
    { key: 'enrich', label: 'Enrich', href: id ? `${base}/missing` : undefined },
    { key: 'proposal', label: 'Proposal', href: id ? `${base}/expand` : undefined },
  ];
}

export function CohortStepBar({ id, active }: { id: string | undefined; active: string }) {
  return <StepBar steps={cohortSteps(id)} active={active} />;
}

/** Sub-navigation inside the Enrich / Proposal steps. */
export function CohortSubNav({ id, active }: { id: string; active: 'funnel' | 'missing' | 'coverage' | 'expand' | 'proposal' }) {
  const items: { key: typeof active; label: string }[] = [
    { key: 'funnel', label: 'Funnel' },
    { key: 'missing', label: 'Missing data' },
    { key: 'coverage', label: 'Coverage' },
    { key: 'expand', label: 'Expand' },
    { key: 'proposal', label: 'Proposal' },
  ];
  return (
    <div className="tabs tabs--pills">
      {items.map((it) => (
        <Link key={it.key} to={`/b/cohorts/${id}/${it.key}`} className={`tab${it.key === active ? ' tab--active' : ''}`}>{it.label}</Link>
      ))}
    </div>
  );
}

/** The org's consent status (red-lines) — derived from a cached preview of the default criteria. */
export function useOrgConsent(): { blocked: boolean; reason: string | null; name: string | null } {
  const [persona] = usePersona();
  const [state, setState] = useState<{ blocked: boolean; reason: string | null; name: string | null }>({ blocked: false, reason: null, name: null });
  useEffect(() => {
    let alive = true;
    if (!persona.startsWith('buyer:')) return;
    api
      .query<CohortPreview & { consent: { name?: string } }>('/buyer/cohorts/preview', DEFAULT_CRITERIA)
      .then((p) => alive && setState({ blocked: p.consent.blocked, reason: p.consent.reason, name: p.consent.name ?? null }))
      .catch(() => alive && setState({ blocked: false, reason: null, name: null }));
    return () => {
      alive = false;
    };
  }, [persona]);
  return state;
}

export function BlockedBanner({ consent, orgName }: { consent: { blocked: boolean; reason: string | null }; orgName?: string | null }) {
  if (!consent.blocked) return null;
  return (
    <div className="callout callout--red mb-16 row gap-12" style={{ alignItems: 'flex-start' }}>
      <ShieldAlert style={{ width: 16, height: 16, flex: '0 0 16px', marginTop: 1 }} />
      <div>
        <div className="strong">Blocked by participant red-lines{orgName ? ` — ${orgName}` : ''}</div>
        <div className="small" style={{ marginTop: 2 }}>
          {consent.reason ?? 'This organisation declares a use that every participant prohibits.'} Every count reads 0 and cohort or campaign creation is refused (HTTP 403).
          Switch to a research organisation in the header to continue.
        </div>
      </div>
    </div>
  );
}

export function orgFromState(state: DemoState | null, persona: string) {
  const id = persona.startsWith('buyer:') ? Number(persona.slice(6)) : null;
  return state?.orgs.find((o) => o.id === id) ?? null;
}

export function PageState({ error, loading, children }: { error: Error | null; loading: boolean; children?: ReactNode }) {
  if (error) return <ErrorBox error={error} />;
  if (loading) return <div className="faint small" style={{ padding: 20 }}>Loading…</div>;
  return <>{children}</>;
}

// ---------- ontology helpers ----------
export function flattenLeaves(domains: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    if (n.level === 'leaf' || n.children.length === 0) out.push(n);
    else n.children.forEach(walk);
  };
  domains.forEach(walk);
  return out;
}
export function useOntologyLeaves() {
  const q = useApi<OntologyResponse>('/buyer/ontology');
  const leaves = useMemo(() => (q.data ? flattenLeaves(q.data.domains) : []), [q.data]);
  const bySlug = useMemo(() => new Map(leaves.map((l) => [l.slug, l])), [leaves]);
  return { ...q, leaves, bySlug };
}

const METHOD_BY_COLLECTION: Record<string, ProtocolRequirement['method']> = {
  device: 'device', photo: 'photo', kit: 'kit', survey: 'survey', protocol: 'protocol', upload: 'upload', self_report: 'survey',
};
const DURATION_BY_METHOD: Record<ProtocolRequirement['method'], number> = { device: 14, photo: 7, kit: 1, survey: 1, protocol: 1, upload: 1 };

/** Default protocol for a concept, from its ontology collection method. */
export function defaultProtocol(leaf: TreeNode | undefined, minProvRank: number): ProtocolRequirement {
  const method = METHOD_BY_COLLECTION[leaf?.collectionMethod ?? ''] ?? 'protocol';
  return { method, durationDays: DURATION_BY_METHOD[method], minProvRank: Math.min(minProvRank, 3) };
}

/** Reuse (license) fee for a leaf: `TreeNode.reuseCompCents` when the ontology serves it, else none. */
export function reuseFeeCents(leaf: TreeNode | undefined): number | null {
  const v = leaf?.reuseCompCents;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Can this leaf be collected at all? Only leaves with a platform collection protocol can be put in a collect mode. */
export function canCollect(leaf: TreeNode | undefined): boolean {
  return !!leaf?.enrichable;
}

/**
 * Default mode for a modality the cohort already requires: 'reuse' for anything without a collection protocol
 * (EHR history, imaging and other file-type records that cannot be collected quickly), 'collect_if_missing' for
 * enrichable leaves (device, kit, photo, survey protocols).
 */
export function defaultMode(leaf: TreeNode | undefined): VariableMode {
  return canCollect(leaf) ? 'collect_if_missing' : 'reuse';
}

/** Rebuild a campaign variable for a mode: reuse keeps the historical requirement and pays the license fee; collect modes add the protocol and collection comp. */
export function withMode(v: CampaignVariable, mode: VariableMode, leaf: TreeNode | undefined): CampaignVariable {
  const m = canCollect(leaf) ? mode : 'reuse';
  const historical = v.requirement.historical;
  if (m === 'reuse') {
    return { ...v, mode: m, requirement: { ...(historical ? { historical } : {}) }, compCents: reuseFeeCents(leaf) ?? 0, deviceCostCents: 0 };
  }
  const minProvRank = historical?.minProvRank ?? v.requirement.protocol?.minProvRank ?? 3;
  return {
    ...v,
    mode: m,
    requirement: { ...(historical ? { historical } : {}), protocol: v.requirement.protocol ?? defaultProtocol(leaf, minProvRank) },
    compCents: leaf?.compCents ?? 0,
    deviceCostCents: leaf?.deviceCostCents ?? 0,
  };
}

/** Campaign variables for "expand this cohort": collect each required modality where missing, reuse the rest. */
export function variablesFromCriteria(criteria: CohortCriteria, bySlug: Map<string, TreeNode>, modes: Partial<Record<string, VariableMode>> = {}): CampaignVariable[] {
  return criteria.modalities.map((m) => {
    const leaf = bySlug.get(m.slug);
    const base: CampaignVariable = {
      conceptSlug: m.slug,
      mode: 'reuse',
      requirement: { historical: { minSpanDays: m.minSpanDays, minProvRank: m.minProvRank } },
      compCents: 0,
      deviceCostCents: 0,
    };
    return withMode(base, modes[m.slug] ?? defaultMode(leaf), leaf);
  });
}

/** Fee shown per variable row: the reuse (license) fee for reuse rows, the collection comp otherwise. */
export function variableFeeCents(v: CampaignVariable, leaf: TreeNode | undefined): number | null {
  if (v.mode !== 'reuse') return v.compCents;
  return v.compCents > 0 ? v.compCents : reuseFeeCents(leaf);
}

export const MODE_OPTIONS: { key: VariableMode; label: string; hint: string }[] = [
  { key: 'reuse', label: 'Reuse', hint: 'License the data the participant already holds; pays a reuse fee, no new collection.' },
  { key: 'collect_if_missing', label: 'Collect if missing', hint: 'Collect only from participants who lack it; reuse (and pay the fee) for the rest.' },
  { key: 'collect_all', label: 'Collect for all', hint: 'Re-measure every member under the protocol, including ready-now participants.' },
];

export const MODE_LABEL: Record<CampaignVariable['mode'], string> = { reuse: 'Reuse existing', collect_if_missing: 'Collect if missing', collect_all: 'Collect for all' };

export function requirementLabel(v: CampaignVariable): string {
  const parts: string[] = [];
  if (v.requirement.historical) {
    const d = v.requirement.historical.minSpanDays;
    parts.push(d >= 365 ? `≥ ${Math.round(d / 365)} y history` : d >= 30 ? `≥ ${Math.round(d / 30)} mo history` : d > 0 ? `≥ ${d} d history` : 'any history');
  }
  if (v.requirement.protocol) parts.push(`${v.requirement.protocol.durationDays} d ${v.requirement.protocol.method}`);
  return parts.join(' or ') || '—';
}
