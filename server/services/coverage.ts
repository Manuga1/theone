// Materialized per-(participant, concept) coverage, rebuilt from non-deleted observations.
// n_obs counts primary measurements (derivation IS NULL); summary rows (monthly trajectories, photo-derived
// nutrition estimates) are kept in the observation table but not counted as measurements.
import { graph } from '../db/graph';
import type { Db } from '../db/driver';

export type CoverageRow = {
  concept_id: number; slug: string; first_at: string; last_at: string; span_days: number; n_obs: number;
  best_prov_rank: number; verified_n: number; self_report_n: number; last_value_num: number | null; protocol_days: number;
};

export function rebuildCoverage(participantId: number, db: Db = graph()): void {
  db.tx(() => {
    db.run('DELETE FROM participant_coverage WHERE participant_id = ?', participantId);
    db.run(
      `INSERT INTO participant_coverage (participant_id, concept_id, first_at, last_at, span_days, n_obs, best_prov_rank, verified_n, self_report_n, last_value_num, protocol_days)
       SELECT o.participant_id, o.concept_id, MIN(CASE WHEN o.derivation IS NULL THEN o.observed_at END), MAX(CASE WHEN o.derivation IS NULL THEN o.observed_at END),
              CAST(julianday(substr(MAX(CASE WHEN o.derivation IS NULL THEN o.observed_at END), 1, 10)) - julianday(substr(MIN(CASE WHEN o.derivation IS NULL THEN o.observed_at END), 1, 10)) AS INTEGER),
              SUM(CASE WHEN o.derivation IS NULL THEN 1 ELSE 0 END),
              MAX(o.provenance_rank),
              SUM(CASE WHEN o.derivation IS NULL AND o.provenance_rank >= 2 THEN 1 ELSE 0 END),
              SUM(CASE WHEN o.derivation IS NULL AND o.provenance_rank = 1 THEN 1 ELSE 0 END),
              (SELECT o2.value_num FROM observation o2 WHERE o2.participant_id = o.participant_id AND o2.concept_id = o.concept_id AND o2.deleted_at IS NULL AND o2.derivation IS NULL AND o2.value_num IS NOT NULL ORDER BY o2.observed_at DESC LIMIT 1),
              (SELECT COUNT(DISTINCT substr(o3.observed_at, 1, 10)) FROM observation o3 WHERE o3.participant_id = o.participant_id AND o3.concept_id = o.concept_id AND o3.deleted_at IS NULL AND o3.provenance_class = 'protocol_measurement' AND o3.contribution_id IS NOT NULL)
         FROM observation o
        WHERE o.participant_id = ? AND o.deleted_at IS NULL
        GROUP BY o.concept_id
       HAVING SUM(CASE WHEN o.derivation IS NULL THEN 1 ELSE 0 END) > 0`,
      participantId,
    );
  });
}

export function coverageFor(participantId: number, db: Db = graph()): Map<string, CoverageRow> {
  const rows = db.all<CoverageRow>(
    `SELECT c.concept_id, k.slug, c.first_at, c.last_at, c.span_days, c.n_obs, c.best_prov_rank, c.verified_n, c.self_report_n, c.last_value_num, c.protocol_days
       FROM participant_coverage c JOIN concept k ON k.id = c.concept_id WHERE c.participant_id = ?`, participantId);
  return new Map(rows.map((r) => [r.slug, r]));
}

/** Coverage as of an earlier date, computed from observations (used for the "+6 this month" delta). */
export function coverageAsOf(participantId: number, asOf: string, db: Db = graph()): Map<string, CoverageRow> {
  const rows = db.all<CoverageRow>(
    `SELECT o.concept_id, k.slug, MIN(CASE WHEN o.derivation IS NULL THEN o.observed_at END) AS first_at, MAX(CASE WHEN o.derivation IS NULL THEN o.observed_at END) AS last_at,
            CAST(julianday(substr(MAX(CASE WHEN o.derivation IS NULL THEN o.observed_at END), 1, 10)) - julianday(substr(MIN(CASE WHEN o.derivation IS NULL THEN o.observed_at END), 1, 10)) AS INTEGER) AS span_days,
            SUM(CASE WHEN o.derivation IS NULL THEN 1 ELSE 0 END) AS n_obs,
            MAX(o.provenance_rank) AS best_prov_rank,
            SUM(CASE WHEN o.derivation IS NULL AND o.provenance_rank >= 2 THEN 1 ELSE 0 END) AS verified_n,
            SUM(CASE WHEN o.derivation IS NULL AND o.provenance_rank = 1 THEN 1 ELSE 0 END) AS self_report_n,
            NULL AS last_value_num,
            0 AS protocol_days
       FROM observation o JOIN concept k ON k.id = o.concept_id
      WHERE o.participant_id = ? AND o.deleted_at IS NULL AND substr(o.observed_at, 1, 10) <= ?
      GROUP BY o.concept_id
     HAVING n_obs > 0`, participantId, asOf);
  return new Map(rows.map((r) => [r.slug, r]));
}
