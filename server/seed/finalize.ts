// After the population exists: compute each seeded campaign's eligible count and estimate from real queries.
import { CohortCriteria } from '@shared/criteria';
import type { CampaignVariable } from '@shared/requirement';
import { evaluateCohort } from '../services/cohort';
import { buildEstimate } from '../services/estimate';
import type { SeedCtx } from './context';

export function finalizeCampaigns(ctx: SeedCtx): void {
  const db = ctx.graph;
  const rows = db.all<{ id: number; study_id: number; buyer_org_id: number; target_complete_n: number; variables_json: string; criteria_json: string | null }>(
    `SELECT c.id, c.study_id, s.buyer_org_id, c.target_complete_n, c.variables_json, cd.criteria_json
       FROM campaign c JOIN study s ON s.id = c.study_id LEFT JOIN cohort_definition cd ON cd.id = s.cohort_definition_id
      WHERE c.status IN ('draft', 'proposal_requested', 'active')`);
  db.tx(() => {
    for (const r of rows) {
      if (!r.criteria_json) continue;
      const criteria = CohortCriteria.parse(JSON.parse(r.criteria_json));
      const variables = JSON.parse(r.variables_json) as CampaignVariable[];
      const ev = evaluateCohort(criteria, { orgId: r.buyer_org_id, variables, skipCache: true }, db);
      const estimate = buildEstimate({ targetN: r.target_complete_n, readyNow: ev.readyNow, groups: ev.groups, variables });
      db.run('UPDATE campaign SET eligible_n = ?, estimate_json = ? WHERE id = ?', ev.recontactBase, JSON.stringify(estimate), r.id);
    }
  });
}
