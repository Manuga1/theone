// Read side of the opportunity marketplace for the participant (P6 cards, P7 review detail).
import { CohortCriteria } from '@shared/criteria';
import type { CampaignVariable } from '@shared/requirement';
import type { ContributionItem, OpportunityCard, OpportunityDetail, OpportunityStatus, OpportunityTab, ParticipantOpportunities } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { conceptNames } from './ledger';
import { participantMatches } from './match';

export type SeedVariable = CampaignVariable & { label?: string };

type OppRow = {
  id: number; status: OpportunityStatus; missing: string; comp_max_cents: number; offered_at: string; completed_at: string | null; reviewed_at: string | null;
  campaign_id: number; variables_json: string; study_id: number; study_name: string; purpose: string; license_term_months: number; criteria_json: string | null;
  org_name: string; org_type: string; enrollment_id: number | null;
};

export function tabOf(status: OpportunityStatus): OpportunityTab {
  if (status === 'offered' || status === 'viewed' || status === 'reviewed') return 'available';
  if (status === 'accepted' || status === 'in_progress' || status === 'submitted' || status === 'verified') return 'in_progress';
  return 'past';
}
export function sponsorType(orgType: string): OpportunityCard['sponsorType'] {
  if (orgType === 'pharma') return 'pharma';
  if (orgType === 'biotech') return 'biotech';
  if (orgType === 'academic') return 'academic';
  return 'other';
}

export function variableLabel(v: SeedVariable, names: Map<string, string>): string {
  if (v.label) return v.label;
  const name = names.get(v.conceptSlug) ?? v.conceptSlug;
  const p = v.requirement.protocol;
  if (v.mode === 'reuse') return name;
  if (!p) return name;
  if (p.method === 'survey') return p.durationDays > 1 ? `${name} (${p.durationDays}-day)` : name;
  if (p.durationDays <= 1) return p.method === 'kit' ? `${name} (kit)` : p.method === 'upload' ? `${name} (upload)` : `${name} (protocol)`;
  return `${p.durationDays} days ${name.toLowerCase()}`;
}

const SELECT = `SELECT op.id, op.status, op.missing_concepts_json AS missing, op.comp_max_cents, op.offered_at, op.completed_at, op.reviewed_at,
      cp.id AS campaign_id, cp.variables_json, s.id AS study_id, s.name AS study_name, s.purpose, s.license_term_months, cd.criteria_json,
      o.name AS org_name, o.type AS org_type, (SELECT e.id FROM enrollment e WHERE e.opportunity_id = op.id ORDER BY e.id DESC LIMIT 1) AS enrollment_id
   FROM opportunity op JOIN campaign cp ON cp.id = op.campaign_id JOIN study s ON s.id = cp.study_id JOIN buyer_org o ON o.id = s.buyer_org_id
   LEFT JOIN cohort_definition cd ON cd.id = s.cohort_definition_id`;

export function listOpportunities(participantId: number, tab: OpportunityTab | undefined, db: Db = graph()): ParticipantOpportunities {
  if (!db.tableExists('opportunity')) return { counts: { available: 0, in_progress: 0, past: 0 }, items: [] };
  const rows = db.all<OppRow>(`${SELECT} WHERE op.participant_id = ? ORDER BY op.offered_at DESC, op.id DESC`, participantId);
  const cards = rows.map((r) => toCard(r, participantId, db));
  // available offers oldest-first (the order they were received); in-progress / past newest-first
  const tabRank: Record<OpportunityTab, number> = { available: 0, in_progress: 1, past: 2 };
  cards.sort((a, b) => tabRank[a.tab] - tabRank[b.tab] || (a.tab === 'available' ? a.offeredAt.localeCompare(b.offeredAt) : b.offeredAt.localeCompare(a.offeredAt)));
  const counts = { available: 0, in_progress: 0, past: 0 } as Record<OpportunityTab, number>;
  for (const c of cards) counts[c.tab]++;
  return { counts, items: tab ? cards.filter((c) => c.tab === tab) : cards };
}

export function opportunityDetail(participantId: number, id: number, db: Db = graph()): OpportunityDetail | null {
  const r = db.get<OppRow>(`${SELECT} WHERE op.id = ? AND op.participant_id = ?`, id, participantId);
  if (!r) return null;
  const card = toCard(r, participantId, db);
  const names = conceptNames(db);
  const vars = JSON.parse(r.variables_json) as SeedVariable[];
  const collect = vars.filter((v) => v.mode !== 'reuse');
  const receive = Array.from(new Set(vars.map((v) => names.get(v.conceptSlug) ?? v.conceptSlug)));
  return {
    ...card,
    reviewed: !!r.reviewed_at || !['offered', 'viewed'].includes(r.status),
    consent: {
      organization: r.org_name,
      purpose: r.purpose,
      receive,
      doNotReceive: ['Identity: name, contact details, date of birth', 'Data outside the listed scope', 'Raw files beyond the study variables', 'Any data after the license term ends'],
      licenseTermMonths: r.license_term_months,
      futureReuse: false,
      recontact: 'platform_only',
      compCents: r.comp_max_cents,
      perTask: collect.map((v) => ({ conceptSlug: v.conceptSlug, name: names.get(v.conceptSlug) ?? v.conceptSlug, compCents: v.compCents, method: v.requirement.protocol?.method ?? 'protocol', durationDays: v.requirement.protocol?.durationDays ?? 1 })),
      reusedCompCents: vars.filter((v) => v.mode === 'reuse').reduce((a, v) => a + v.compCents, 0),
    },
  };
}

function toCard(r: OppRow, participantId: number, db: Db): OpportunityCard {
  const names = conceptNames(db);
  const vars = JSON.parse(r.variables_json) as SeedVariable[];
  const collect = vars.filter((v) => v.mode !== 'reuse');
  const reuse = vars.filter((v) => v.mode === 'reuse');
  const criteria = r.criteria_json ? CohortCriteria.parse(JSON.parse(r.criteria_json)) : null;
  return {
    id: r.id,
    status: r.status,
    tab: tabOf(r.status),
    title: r.study_name,
    sponsor: r.org_name,
    sponsorType: sponsorType(r.org_type),
    purpose: r.purpose,
    compCents: r.comp_max_cents,
    compIsMax: collect.length >= 4,
    requirements: collect.map((v) => variableLabel(v, names)),
    reused: reuse.map((v) => variableLabel(v, names)),
    likelyMatch: criteria ? participantMatches(criteria, participantId, db) : false,
    campaignId: r.campaign_id,
    studyId: r.study_id,
    enrollmentId: r.enrollment_id,
    offeredAt: r.offered_at,
    completedAt: r.completed_at,
    contributions: contributions(r.id, db),
  };
}

export function contributions(opportunityId: number, db: Db = graph()): ContributionItem[] {
  return db.all<{ id: number; slug: string; name: string; method: string; duration_days: number; status: ContributionItem['status']; comp_cents: number; observation_count: number }>(
    `SELECT c.id, k.slug, k.name, c.method, c.duration_days, c.status, c.comp_cents, c.observation_count FROM contribution c JOIN concept k ON k.id = c.concept_id WHERE c.opportunity_id = ? ORDER BY c.id`, opportunityId)
    .map((c) => ({ id: c.id, conceptSlug: c.slug, name: c.name, method: c.method, durationDays: c.duration_days, status: c.status, compCents: c.comp_cents, observationCount: c.observation_count }));
}

/** Sum of comp across available offers (P1 "up to $…" tile). */
export function availableSummary(participantId: number, db: Db = graph()): { count: number; maxCents: number } {
  if (!db.tableExists('opportunity')) return { count: 0, maxCents: 0 };
  const r = db.get<{ n: number; c: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(comp_max_cents), 0) AS c FROM opportunity WHERE participant_id = ? AND status IN ('offered','viewed','reviewed')", participantId);
  return { count: r?.n ?? 0, maxCents: r?.c ?? 0 };
}
