// Money: integer cents. Card amounts are NET to the participant; fromNet() is the single place the 90/10 split is computed.
import { DEMO_TODAY, nowIso } from '@shared/clock';
import { SPLIT } from '@shared/pricing';
import type { LedgerRow, ParticipantLedger } from '@shared/api-types';
import { graph } from '../db/graph';
import type { Db } from '../db/driver';

export type Split = { gross: number; participant: number; platform: number };

/** net → { gross: round(net / 0.9), participant: net, platform: gross − net } */
export function fromNet(netCents: number): Split {
  const participant = Math.round(netCents);
  const gross = Math.round(participant / SPLIT.participant);
  return { gross, participant, platform: gross - participant };
}

export type LicenseStatus = 'active' | 'expired' | 'revoked';
export function licenseStatus(l: { term_end: string; revoked_at: string | null }, today = DEMO_TODAY): LicenseStatus {
  if (l.revoked_at) return 'revoked';
  return l.term_end > today ? 'active' : 'expired';
}
export function licenseNumber(n: number): string {
  return `#${n}`;
}

type LedgerJoined = {
  id: number; kind: 'license_fee' | 'contribution_payment'; occurred_at: string; memo: string | null;
  gross_cents: number; participant_cents: number; platform_cents: number;
  study_id: number | null; study_name: string | null; org_name: string | null; purpose: string | null;
  license_id: number | null; license_number: number | null; term_start: string | null; term_end: string | null; revoked_at: string | null;
  scope_json: string | null; contribution_id: number | null; contribution_concept: string | null;
  campaign_name: string | null; parent_campaign_id: number | null;
};

export function readLedger(participantId: number, db: Db = graph()): ParticipantLedger {
  const rows = db.all<LedgerJoined>(
    `SELECT e.id, e.kind, e.occurred_at, e.memo, e.gross_cents, e.participant_cents, e.platform_cents,
            e.study_id, s.name AS study_name, o.name AS org_name, s.purpose,
            e.license_id, l.number AS license_number, l.term_start, l.term_end, l.revoked_at, l.scope_concepts_json AS scope_json,
            e.contribution_id, cc.name AS contribution_concept, cp.name AS campaign_name, cp.parent_campaign_id
       FROM ledger_entry e
       LEFT JOIN study s ON s.id = e.study_id
       LEFT JOIN buyer_org o ON o.id = s.buyer_org_id
       LEFT JOIN license l ON l.id = e.license_id
       LEFT JOIN contribution c ON c.id = e.contribution_id
       LEFT JOIN concept cc ON cc.id = c.concept_id
       LEFT JOIN enrollment en ON en.id = l.enrollment_id
       LEFT JOIN opportunity op ON op.id = COALESCE(c.opportunity_id, en.opportunity_id)
       LEFT JOIN campaign cp ON cp.id = op.campaign_id
      WHERE e.participant_id = ?
      ORDER BY e.occurred_at DESC, e.id DESC`, participantId);
  const names = conceptNames(db);
  const entries: LedgerRow[] = rows.map((r) => {
    const status = r.license_id ? licenseStatus({ term_end: r.term_end!, revoked_at: r.revoked_at }) : null;
    const scope: string[] = r.scope_json ? (JSON.parse(r.scope_json) as string[]) : [];
    // a variable-request child campaign is named by the campaign; the root campaign by the study
    const studyName = r.parent_campaign_id !== null && r.campaign_name ? r.campaign_name : r.study_name ?? '';
    return {
      id: r.id,
      date: r.occurred_at.slice(0, 10),
      kind: r.kind,
      title: r.kind === 'license_fee' ? `Research License ${licenseNumber(r.license_number ?? 0)}` : `${r.contribution_concept ?? 'Protocol'} contribution`,
      dataIncluded: r.kind === 'license_fee' ? scope.map((s) => names.get(s) ?? s) : r.contribution_concept ? [r.contribution_concept] : [],
      studyName,
      orgName: r.org_name ?? '',
      purpose: r.purpose ?? (r.memo ?? ''),
      licenseId: r.license_id,
      licenseNumber: r.license_number ? licenseNumber(r.license_number) : null,
      termStart: r.term_start,
      termEnd: r.term_end,
      licenseStatus: status,
      grossCents: r.gross_cents,
      participantCents: r.participant_cents,
      platformCents: r.platform_cents,
      canRevoke: status === 'active',
    };
  });
  return {
    lifetimeEarningsCents: lifetimeEarnings(participantId, db),
    activeLicenses: activeLicenseCount(participantId, db),
    licensedUses: licensedUses(participantId, db),
    entries,
    split: { participant: SPLIT.participant, platform: SPLIT.platform },
  };
}

export function lifetimeEarnings(participantId: number, db: Db = graph()): number {
  return db.get<{ c: number }>('SELECT COALESCE(SUM(participant_cents), 0) AS c FROM ledger_entry WHERE participant_id = ?', participantId)?.c ?? 0;
}
/** "Active licenses" = count(term_end > today ∧ not revoked). */
export function activeLicenseCount(participantId: number, db: Db = graph()): number {
  return db.get<{ c: number }>('SELECT COUNT(*) AS c FROM license WHERE participant_id = ? AND revoked_at IS NULL AND term_end > ?', participantId, DEMO_TODAY)?.c ?? 0;
}
export function licensedUses(participantId: number, db: Db = graph()): number {
  return db.get<{ c: number }>('SELECT COUNT(*) AS c FROM license WHERE participant_id = ? AND revoked_at IS NULL', participantId)?.c ?? 0;
}

/** Append a ledger row. The only writer of ledger_entry. */
export function postLedger(db: Db, row: { participantId: number; kind: 'license_fee' | 'contribution_payment'; netCents: number; occurredAt: string; studyId?: number | null; licenseId?: number | null; contributionId?: number | null; memo?: string | null }): { id: number; split: Split } {
  const split = fromNet(row.netCents);
  const id = db.run(
    'INSERT INTO ledger_entry (participant_id, kind, study_id, license_id, contribution_id, gross_cents, participant_cents, platform_cents, occurred_at, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    row.participantId, row.kind, row.studyId ?? null, row.licenseId ?? null, row.contributionId ?? null, split.gross, split.participant, split.platform, row.occurredAt, row.memo ?? null, nowIso(),
  ).lastId;
  return { id, split };
}

const nameCache = new WeakMap<Db, { version: number; map: Map<string, string> }>();
export function conceptNames(db: Db = graph()): Map<string, string> {
  const hit = nameCache.get(db);
  if (hit && hit.version === db.writeVersion) return hit.map;
  const map = new Map<string, string>();
  if (db.tableExists('concept')) for (const r of db.all<{ slug: string; name: string }>('SELECT slug, name FROM concept')) map.set(r.slug, r.name);
  nameCache.set(db, { version: db.writeVersion, map });
  return map;
}
