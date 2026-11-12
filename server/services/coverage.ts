// Materialized per-(participant, concept) coverage, rebuilt from non-deleted observations. Observations filed on a
// variant sub-branch roll up into its parent leaf (completeness ignores variants; the leaf carries the score).
// n_obs counts primary measurements (derivation IS NULL); summary rows (monthly trajectories, photo-derived
// nutrition estimates) are kept in the observation table but not counted as measurements.
import { graph } from '../db/graph';
import type { Db } from '../db/driver';

export type CoverageRow = {
  concept_id: number; slug: string; first_at: string; last_at: string; span_days: number; n_obs: number;
  best_prov_rank: number; verified_n: number; self_report_n: number; last_value_num: number | null; protocol_days: number;
};

export async function rebuildCoverage(participantId: number, db: Db = graph()): Promise<void> {
  await db.tx(async () => {
        await db.run('DELETE FROM participant_coverage WHERE participant_id = ?', participantId);
        // variant sub-branch observations roll up into their leaf (leaf_id); aggregates first, then per-leaf lookups
        await db.run(
          `INSERT INTO participant_coverage (participant_id, concept_id, first_at, last_at, span_days, n_obs, best_prov_rank, verified_n, self_report_n, last_value_num, protocol_days)
           WITH obs AS (
             SELECT o.*, CASE WHEN k.level = 'variant' THEN k.parent_id ELSE o.concept_id END AS leaf_id
               FROM observation o JOIN concept k ON k.id = o.concept_id
              WHERE o.participant_id = ? AND o.deleted_at IS NULL
           ), agg AS (
             SELECT leaf_id, MIN(CASE WHEN derivation IS NULL THEN observed_at END) AS first_at, MAX(CASE WHEN derivation IS NULL THEN observed_at END) AS last_at,
                    SUM(CASE WHEN derivation IS NULL THEN 1 ELSE 0 END) AS n_obs, MAX(provenance_rank) AS best_prov_rank,
                    SUM(CASE WHEN derivation IS NULL AND provenance_rank >= 2 THEN 1 ELSE 0 END) AS verified_n,
                    SUM(CASE WHEN derivation IS NULL AND provenance_rank = 1 THEN 1 ELSE 0 END) AS self_report_n
               FROM obs GROUP BY leaf_id
             HAVING SUM(CASE WHEN derivation IS NULL THEN 1 ELSE 0 END) > 0
           )
           SELECT ?, a.leaf_id, a.first_at, a.last_at,
                  CAST(julianday(substr(a.last_at, 1, 10)) - julianday(substr(a.first_at, 1, 10)) AS INTEGER),
                  a.n_obs, a.best_prov_rank, a.verified_n, a.self_report_n,
                  (SELECT b.value_num FROM obs b WHERE b.leaf_id = a.leaf_id AND b.derivation IS NULL AND b.value_num IS NOT NULL ORDER BY b.observed_at DESC LIMIT 1),
                  (SELECT COUNT(DISTINCT substr(b.observed_at, 1, 10)) FROM obs b WHERE b.leaf_id = a.leaf_id AND b.provenance_class = 'protocol_measurement' AND b.contribution_id IS NOT NULL)
             FROM agg a`,
          participantId, participantId,
        );
      });
}

export async function coverageFor(participantId: number, db: Db = graph()): Promise<Map<string, CoverageRow>> {
  const rows = await db.all<CoverageRow>(
      `SELECT c.concept_id, k.slug, c.first_at, c.last_at, c.span_days, c.n_obs, c.best_prov_rank, c.verified_n, c.self_report_n, c.last_value_num, c.protocol_days
       FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE c.participant_id = ?`, participantId);
  return new Map(rows.map((r) => [r.slug, r]));
}

/** Coverage as of an earlier date, computed from observations (used for the "+6 this month" delta). */
export async function coverageAsOf(participantId: number, asOf: string, db: Db = graph()): Promise<Map<string, CoverageRow>> {
  const rows = await db.all<CoverageRow>(
    `WITH obs AS (
       SELECT o.*, CASE WHEN k.level = 'variant' THEN k.parent_id ELSE o.concept_id END AS leaf_id
         FROM observation o JOIN concept k ON k.id = o.concept_id
        WHERE o.participant_id = ? AND o.deleted_at IS NULL AND substr(o.observed_at, 1, 10) <= ?
     )
     SELECT obs.leaf_id AS concept_id, lk.slug, MIN(CASE WHEN obs.derivation IS NULL THEN obs.observed_at END) AS first_at, MAX(CASE WHEN obs.derivation IS NULL THEN obs.observed_at END) AS last_at,
            CAST(julianday(substr(MAX(CASE WHEN obs.derivation IS NULL THEN obs.observed_at END), 1, 10)) - julianday(substr(MIN(CASE WHEN obs.derivation IS NULL THEN obs.observed_at END), 1, 10)) AS INTEGER) AS span_days,
            SUM(CASE WHEN obs.derivation IS NULL THEN 1 ELSE 0 END) AS n_obs,
            MAX(obs.provenance_rank) AS best_prov_rank,
            SUM(CASE WHEN obs.derivation IS NULL AND obs.provenance_rank >= 2 THEN 1 ELSE 0 END) AS verified_n,
            SUM(CASE WHEN obs.derivation IS NULL AND obs.provenance_rank = 1 THEN 1 ELSE 0 END) AS self_report_n,
            NULL AS last_value_num,
            0 AS protocol_days
       FROM obs JOIN concept lk ON lk.id = obs.leaf_id
      GROUP BY obs.leaf_id, lk.slug
     HAVING SUM(CASE WHEN obs.derivation IS NULL THEN 1 ELSE 0 END) > 0`, participantId, asOf);
  return new Map(rows.map((r) => [r.slug, r]));
}
