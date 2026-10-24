// Guard tables: every legal edge passes, every other edge throws HttpError 409; service calls honour them.
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../../server/errors';
import { assertTransition, canTransition, CAMPAIGN_TRANSITIONS, CONTRIBUTION_TRANSITIONS, ENROLLMENT_TRANSITIONS, OPPORTUNITY_TRANSITIONS, REPLACEABLE_STATUSES, STARTED_STATUSES } from '../../server/services/state';
import { acceptOpportunity, declineOpportunity, reviewOpportunity, viewOpportunity } from '../../server/services/consent';
import { launchCampaign, requestProposal } from '../../server/services/campaign';
import { simulateContribution } from '../../server/services/simulate';
import { seededDbs, alexId, type TestDbs } from '../helpers/db';

const status = (fn: () => unknown) => { try { fn(); return 200; } catch (e) { return e instanceof HttpError ? e.status : 500; } };

describe('state machines (pure)', () => {
  it('campaign: draft → proposal_requested → active → closed; nothing leaves closed', () => {
    expect(canTransition(CAMPAIGN_TRANSITIONS, 'draft', 'proposal_requested')).toBe(true);
    expect(canTransition(CAMPAIGN_TRANSITIONS, 'draft', 'active')).toBe(true);
    expect(canTransition(CAMPAIGN_TRANSITIONS, 'proposal_requested', 'active')).toBe(true);
    expect(canTransition(CAMPAIGN_TRANSITIONS, 'active', 'closed')).toBe(true);
    expect(canTransition(CAMPAIGN_TRANSITIONS, 'active', 'draft')).toBe(false);
    expect(canTransition(CAMPAIGN_TRANSITIONS, 'closed', 'active')).toBe(false);
    expect(status(() => assertTransition('campaign', CAMPAIGN_TRANSITIONS, 'active', 'proposal_requested'))).toBe(409);
  });
  it('opportunity: offered → viewed → reviewed → accepted | declined; accepted → in_progress → submitted → verified | rejected → paid; side states', () => {
    const legal: [string, string][] = [['offered', 'viewed'], ['viewed', 'reviewed'], ['reviewed', 'accepted'], ['reviewed', 'declined'], ['accepted', 'in_progress'], ['in_progress', 'submitted'], ['submitted', 'verified'], ['submitted', 'rejected'], ['verified', 'paid'], ['offered', 'expired'], ['in_progress', 'withdrawn'], ['declined', 'replaced'], ['rejected', 'replaced']];
    for (const [a, b] of legal) expect(canTransition(OPPORTUNITY_TRANSITIONS, a as never, b as never), `${a}→${b}`).toBe(true);
    const illegal: [string, string][] = [['offered', 'accepted'], ['viewed', 'accepted'], ['paid', 'offered'], ['declined', 'accepted'], ['accepted', 'paid'], ['paid', 'withdrawn'], ['expired', 'viewed'], ['replaced', 'offered']];
    for (const [a, b] of illegal) expect(status(() => assertTransition('opportunity', OPPORTUNITY_TRANSITIONS, a as never, b as never)), `${a}→${b}`).toBe(409);
    for (const s of Object.keys(OPPORTUNITY_TRANSITIONS)) expect(Array.isArray(OPPORTUNITY_TRANSITIONS[s as never])).toBe(true);
    expect(STARTED_STATUSES).toContain('paid');
    expect(STARTED_STATUSES).not.toContain('accepted');
    expect(REPLACEABLE_STATUSES.sort()).toEqual(['declined', 'expired', 'rejected', 'withdrawn']);
  });
  it('enrollment and contribution tables', () => {
    expect(canTransition(ENROLLMENT_TRANSITIONS, 'active', 'completed')).toBe(true);
    expect(canTransition(ENROLLMENT_TRANSITIONS, 'completed', 'revoked')).toBe(true);
    expect(canTransition(ENROLLMENT_TRANSITIONS, 'withdrawn', 'active')).toBe(false);
    expect(canTransition(CONTRIBUTION_TRANSITIONS, 'pending', 'verified')).toBe(false);
    expect(canTransition(CONTRIBUTION_TRANSITIONS, 'submitted', 'rejected')).toBe(true);
  });
});

describe('state machines (services, scale 0.05)', () => {
  let t: TestDbs;
  let pid: number;
  beforeAll(() => { t = seededDbs(); pid = alexId(t.graph); });

  it('accept before review → 409; decline is final; contribute on a declined offer → 409', () => {
    const opp = t.graph.get<{ id: number }>("SELECT op.id FROM opportunity op JOIN campaign c ON c.id = op.campaign_id WHERE op.participant_id = ? AND op.status = 'offered' AND c.name = 'Medication Adherence Survey'", pid)!.id;
    expect(status(() => acceptOpportunity(pid, opp, t.graph))).toBe(409);
    expect(viewOpportunity(pid, opp, t.graph)).toBe('viewed');
    expect(viewOpportunity(pid, opp, t.graph)).toBe('viewed'); // idempotent
    expect(status(() => acceptOpportunity(pid, opp, t.graph))).toBe(409);
    expect(reviewOpportunity(pid, opp, t.graph)).toBe('reviewed');
    expect(declineOpportunity(pid, opp, t.graph)).toBe('declined');
    expect(status(() => acceptOpportunity(pid, opp, t.graph))).toBe(409);
    expect(status(() => declineOpportunity(pid, opp, t.graph))).toBe(409);
    expect(status(() => viewOpportunity(pid, 999999, t.graph))).toBe(404);
  });
  it('campaign guards: an active campaign cannot be launched or re-proposed', () => {
    const active = t.graph.get<{ id: number }>("SELECT id FROM campaign WHERE status = 'active' AND name = 'Metabolic Monitoring Study'")!.id;
    expect(status(() => launchCampaign(1, active, t.graph))).toBe(409);
    expect(status(() => requestProposal(1, active, t.graph))).toBe(409);
    expect(status(() => launchCampaign(2, active, t.graph))).toBe(404); // other org
  });
  it('a verified contribution cannot be simulated twice; an unknown one is 404', () => {
    const done = t.graph.get<{ id: number }>("SELECT id FROM contribution WHERE participant_id = ? AND status = 'verified' LIMIT 1", pid)!.id;
    expect(status(() => simulateContribution(pid, done, t.graph))).toBe(409);
    expect(status(() => simulateContribution(pid, 999999, t.graph))).toBe(404);
  });
});
