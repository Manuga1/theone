// State machines with guard tables. Illegal transitions throw HttpError 409 (conflict). Counters are never derived
// from these tables — they are always GROUP BY status queries; the tables only guard writes.
import type { CampaignStatus, OpportunityStatus } from '@shared/api-types';
import { conflict } from '../errors';

export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['proposal_requested', 'active'],
  proposal_requested: ['active', 'closed'],
  active: ['closed'],
  closed: [],
};

export const OPPORTUNITY_TRANSITIONS: Record<OpportunityStatus, OpportunityStatus[]> = {
  offered: ['viewed', 'reviewed', 'declined', 'expired'],
  viewed: ['reviewed', 'declined', 'expired'],
  reviewed: ['accepted', 'declined', 'expired'],
  accepted: ['in_progress', 'withdrawn'],
  in_progress: ['submitted', 'paid', 'rejected', 'withdrawn'],
  submitted: ['verified', 'rejected', 'paid', 'withdrawn'],
  verified: ['paid'],
  rejected: ['replaced'],
  paid: [],
  declined: ['replaced'],
  expired: ['replaced'],
  withdrawn: ['replaced'],
  replaced: [],
};

export type EnrollmentStatus = 'active' | 'completed' | 'withdrawn' | 'revoked';
export const ENROLLMENT_TRANSITIONS: Record<EnrollmentStatus, EnrollmentStatus[]> = {
  active: ['completed', 'withdrawn', 'revoked'],
  completed: ['revoked'],
  withdrawn: [],
  revoked: [],
};

export type ContributionStatus = 'pending' | 'submitted' | 'verified' | 'rejected';
export const CONTRIBUTION_TRANSITIONS: Record<ContributionStatus, ContributionStatus[]> = {
  pending: ['submitted'],
  submitted: ['verified', 'rejected'],
  verified: [],
  rejected: [],
};

/** Opportunity statuses that count as "started" (collection under way or finished). */
export const STARTED_STATUSES: OpportunityStatus[] = ['in_progress', 'submitted', 'verified', 'rejected', 'paid'];
/** Statuses that still allow a response (the P6 "Available" tab). */
export const OPEN_STATUSES: OpportunityStatus[] = ['offered', 'viewed', 'reviewed'];
/**
 * Statuses that need a replacement participant (B7 "need replacement / recontact"). Recontact never rewrites these to
 * 'replaced' (counters would move backwards): the original keeps its terminal status and `replaced_by_id` links the
 * replacement offer; "need replacement" counts only rows whose replaced_by_id IS NULL.
 */
export const REPLACEABLE_STATUSES: OpportunityStatus[] = ['declined', 'rejected', 'expired', 'withdrawn'];

export function canTransition<S extends string>(table: Record<S, S[]>, from: S, to: S): boolean {
  return (table[from] ?? []).includes(to);
}

export function assertTransition<S extends string>(kind: string, table: Record<S, S[]>, from: S, to: S): void {
  if (!canTransition(table, from, to)) throw conflict(`${kind} cannot move from "${from}" to "${to}"`);
}

export const sqlList = (statuses: readonly string[]): string => `(${statuses.map((s) => `'${s}'`).join(',')})`;
