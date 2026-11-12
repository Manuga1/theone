// Logging rewards (2026-11-10 notes: "the incentive must exceed the activation energy — e.g. earn $1 per food photo").
// The reward itself is granted by ingest.grantReward() when an item is filed (a contribution_payment ledger row funded by a
// campaign or the platform, daily cap respected, never in vault mode). This module is the read side: the rules, today's and
// this week's totals, and the streak = consecutive days with ≥ 1 filed item or a completed check-in.
import { DEMO_TODAY, addDays } from '@shared/clock';
import type { LoggingRewards, RewardRule } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';
import { isVaultOnly, VAULT_MODE_REASON } from './consent';
import { mapSeq } from '../util/async';

type RuleRow = { id: number; cents: number; per_unit_label: string; daily_cap_cents: number | null; funded_kind: 'campaign' | 'platform'; study_id: number | null; study_name: string | null; slug: string; name: string };

export const FILED = "('auto_filed', 'accepted')";
const FILED_DAY = 'substr(COALESCE(resolved_at, created_at), 1, 10)';

export async function rewardRules(participantId: number, db: Db = graph()): Promise<RewardRule[]> {
  if (!await db.tableExists('reward_rule')) return [];
  const rows = await db.all<RuleRow>(
      `SELECT r.id, r.cents, r.per_unit_label, r.daily_cap_cents, r.funded_kind, r.study_id, s.name AS study_name, c.slug, c.name
       FROM reward_rule r JOIN concept c ON c.id = r.concept_id LEFT JOIN study s ON s.id = r.study_id
      WHERE r.active = 1 AND (r.participant_id IS NULL OR r.participant_id = ?) ORDER BY r.id`, participantId);
  return await mapSeq(rows, async (r) => {
    const today = await db.get<{ n: number; c: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(reward_cents), 0) AS c FROM ingest_item WHERE participant_id = ? AND concept_id = (SELECT id FROM concept WHERE slug = ?) AND status IN ${FILED} AND ${FILED_DAY} = ?`, participantId, r.slug, DEMO_TODAY);
    return {
      id: r.id, conceptSlug: r.slug, conceptName: r.name, cents: r.cents, perUnitLabel: r.per_unit_label, dailyCapCents: r.daily_cap_cents,
      fundedBy: { kind: r.funded_kind, name: r.funded_kind === 'campaign' ? r.study_name ?? 'Campaign' : 'Platform', studyId: r.study_id },
      today: { count: today?.n ?? 0, cents: today?.c ?? 0 },
    };
  });
}

/** Reward cents and rewarded-item count filed today (HomeExtras.rewardsToday). */
export async function rewardsToday(participantId: number, db: Db = graph()): Promise<{ cents: number; count: number }> {
  if (!await db.tableExists('ingest_item')) return { cents: 0, count: 0 };
  const r = await db.get<{ c: number; n: number }>(`SELECT COALESCE(SUM(reward_cents), 0) AS c, SUM(CASE WHEN reward_cents > 0 THEN 1 ELSE 0 END) AS n FROM ingest_item WHERE participant_id = ? AND status IN ${FILED} AND ${FILED_DAY} = ?`, participantId, DEMO_TODAY);
  return { cents: r?.c ?? 0, count: r?.n ?? 0 };
}

/**
 * Streak: consecutive days ending today with ≥ 1 filed item or a completed check-in. A day without activity yet
 * (today) does not break a streak that ran up to yesterday — it is still alive until midnight.
 */
export async function streakDays(participantId: number, db: Db = graph(), today = DEMO_TODAY): Promise<number> {
  const days = new Set<string>();
  if (await db.tableExists('ingest_item')) for (const r of await db.all<{ d: string }>(`SELECT DISTINCT ${FILED_DAY} AS d FROM ingest_item WHERE participant_id = ? AND status IN ${FILED}`, participantId)) days.add(r.d);
  if (await db.tableExists('checkin_day')) for (const r of await db.all<{ d: string }>('SELECT date AS d FROM checkin_day WHERE participant_id = ? AND done = 1', participantId)) days.add(r.d);
  let d = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

export async function loggingRewards(participantId: number, db: Db = graph()): Promise<LoggingRewards> {
  const vault = await isVaultOnly(participantId, db);
  const week = await db.tableExists('ingest_item')
    ? (await db.get<{ c: number }>(`SELECT COALESCE(SUM(reward_cents), 0) AS c FROM ingest_item WHERE participant_id = ? AND status IN ${FILED} AND ${FILED_DAY} >= ?`, participantId, addDays(DEMO_TODAY, -6)))?.c ?? 0
    : 0;
  return {
    enabled: !vault,
    disabledReason: vault ? `Logging rewards are paused in ${VAULT_MODE_REASON}` : null,
    rules: await rewardRules(participantId, db),
    todayCents: (await rewardsToday(participantId, db)).cents,
    weekCents: week,
    streakDays: await streakDays(participantId, db),
  };
}
