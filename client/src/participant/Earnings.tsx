// P8 Asset Ledger: lifetime earnings + active licenses tiles, the who/what/purpose/period/compensation table with Revoke
// (micro rewards grouped per day), the logging-rewards card (rules, today, streak, funding) and the tamper-evident audit
// card (hash chain head, Verify, simulated daily Merkle anchors). The stage-2 fetches (/rewards, /audit) are made only
// when the ledger payload carries the matching LedgerExtras, so an older API shows a hint instead of logging 404s.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ShieldCheck, FlaskConical, Percent, Flame, Vault, Link2, CheckCircle2, AlertTriangle, Anchor, RefreshCw, Lock } from 'lucide-react';
import type { ParticipantLedger, LedgerRow, LoggingRewards, AuditLog, AuditVerify } from '@shared/api-types';
import { dateLong } from '@shared/fmt';
import { useApi } from '../hooks';
import { api, ApiRequestError } from '../api';
import { useAction } from '../useAction';
import { pushToast } from '../toast';
import { Card, StatTile, LedgerTable, RevokeDialog, ErrorBox, Money, Num, Pill } from '../components';

export const shortHash = (h: string | null | undefined, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : '—');

/** Logging rewards: which rules pay what, what was earned today, the streak and who funds each rule. */
export function LoggingRewardsCard({ served, summaryToday }: { served: boolean; summaryToday: number | undefined }) {
  const q = useApi<LoggingRewards>(served ? '/participant/rewards' : null);
  const unserved = !served || (q.error instanceof ApiRequestError && q.error.status === 404);
  const d = q.data;
  const right = d ? <span className="streak" title="Consecutive days with at least one filed item or a completed check-in"><Flame /> {d.streakDays}-day streak</span> : null;
  return (
    <Card title="Logging rewards" sub="Micro-payments for logs, photos and check-ins. Each is a ledger row that names the funding campaign or the platform." right={right}>
      {unserved && <div className="small faint">Logging rewards are not served by this API yet{typeof summaryToday === 'number' ? <> · <Money cents={summaryToday} exact /> earned today</> : null}.</div>}
      {q.error && !unserved && <ErrorBox error={q.error} />}
      {d && (
        <div className="col gap-12">
          {!d.enabled && (
            <div className="callout callout--amber row gap-8" style={{ alignItems: 'center' }}>
              <Vault style={{ width: 14, height: 14, flex: '0 0 14px' }} />
              <span>{d.disabledReason ?? 'Rewards are off.'} <Link to="/p/permissions">Permissions</Link></span>
            </div>
          )}
          <div className="rewards-nums">
            <div><div className="big-num" data-testid="rewards-today"><Money cents={d.todayCents} exact /></div><div className="tiny faint">today</div></div>
            <div><div className="big-num"><Money cents={d.weekCents} exact /></div><div className="tiny faint">last 7 days</div></div>
            <div><div className="big-num"><Num n={d.streakDays} /></div><div className="tiny faint">day streak</div></div>
          </div>
          <div className="table-wrap">
            <table className="table table--compact table--rewards">
              <thead><tr><th>Rule</th><th className="num">Pays</th><th className="num">Cap</th><th>Funded by</th><th className="num">Today</th></tr></thead>
              <tbody>
                {d.rules.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="strong" to={`/p/node/${r.conceptSlug}`}>{r.conceptName}</Link><div className="tiny faint">{/^per\b/i.test(r.perUnitLabel) ? r.perUnitLabel : `per ${r.perUnitLabel}`}</div></td>
                    <td className="num"><Money cents={r.cents} exact /></td>
                    <td className="muted num">{r.dailyCapCents !== null ? <><Money cents={r.dailyCapCents} exact /><span className="tiny faint">/day</span></> : '—'}</td>
                    <td>{r.fundedBy.kind === 'campaign' ? <Pill variant="accent" sm title={r.fundedBy.studyId ? `Study #${r.fundedBy.studyId}` : undefined}>{r.fundedBy.name}</Pill> : <Pill variant="neutral" sm>{r.fundedBy.name}</Pill>}</td>
                    <td className="num">{r.today.count > 0 ? <><Num n={r.today.count} /> · <Money cents={r.today.cents} exact /></> : <span className="faint">—</span>}{r.dailyCapCents !== null && r.today.cents >= r.dailyCapCents && <div className="tiny faint">at cap</div>}</td>
                  </tr>
                ))}
                {d.rules.length === 0 && <tr><td colSpan={5} className="faint center">No active reward rules.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="note">The incentive must beat the activation energy: a food photo or a reading takes seconds and pays at once. Caps keep a campaign's spend predictable; the funding study is named on every row.</div>
        </div>
      )}
      {served && !d && !q.error && <div className="faint small">Loading…</div>}
    </Card>
  );
}

/** Tamper-evident log: hash-chained audit events, Verify (recomputes the chain) and simulated daily Merkle anchors. */
export function AuditCard({ served, summary }: { served: boolean; summary: ParticipantLedger['audit'] }) {
  const q = useApi<AuditLog>(served ? '/participant/audit' : null);
  const [result, setResult] = useState<AuditVerify | null>(null);
  const [showAll, setShowAll] = useState(false);
  const verify = useAction(async () => {
    const r = await api.query<AuditVerify>('/participant/audit/verify');
    setResult(r);
    pushToast(r.ok ? 'success' : 'error', r.ok ? `Chain intact: ${r.events} events verified` : `Chain broken at event #${r.brokenAt ?? '?'}`);
  }, { errorPrefix: 'Verify' });
  const unserved = !served || (q.error instanceof ApiRequestError && q.error.status === 404);
  const d = q.data;
  const v = result ?? d?.verify ?? null;
  const events = d ? (showAll ? d.events : d.events.slice(0, 6)) : [];
  return (
    <Card title="Tamper-evident log" sub="Every governance and economic write appends a hash-chained audit event in the same transaction as the write itself." right={v ? <span className={`pill pill--sm ${v.ok ? 'pill--verified' : 'pill--missing'}`} data-testid="audit-status">{v.ok ? <CheckCircle2 style={{ width: 10, height: 10 }} /> : <AlertTriangle style={{ width: 10, height: 10 }} />} {v.ok ? 'intact' : 'broken'}</span> : null}>
      {unserved && <div className="small faint">The audit log is not served by this API yet{summary ? <> · {summary.events} events · head {shortHash(summary.headHash)}</> : null}.</div>}
      {q.error && !unserved && <ErrorBox error={q.error} />}
      {d && (
        <div className="col gap-12">
          <div className="audit-head">
            <div><div className="big-num"><Num n={d.total} /></div><div className="tiny faint">events</div></div>
            <div className="audit-head__hash">
              <div className="tiny faint">head hash</div>
              <code className="hash" title={d.headHash ?? ''} data-testid="audit-head">{shortHash(d.headHash, 16)}</code>
            </div>
            <button className="btn btn--sm btn--primary" disabled={verify.busy} onClick={() => verify.run()} data-testid="audit-verify"><RefreshCw /> Verify</button>
          </div>
          {v && (
            <div className={`callout ${v.ok ? 'callout--green' : 'callout--red'} row gap-8`} style={{ alignItems: 'center' }} data-testid="audit-verify-result">
              {v.ok ? <CheckCircle2 style={{ width: 14, height: 14, flex: '0 0 14px' }} /> : <AlertTriangle style={{ width: 14, height: 14, flex: '0 0 14px' }} />}
              <span>{v.ok ? <>Chain intact: {v.events} events re-hashed from <code>genesis</code> to the head.</> : <>Chain broken at event #{v.brokenAt ?? '?'} — a stored hash no longer matches its content.</>} <span className="faint">Checked {v.verifiedAt.replace('T', ' ').slice(0, 16)}</span></span>
            </div>
          )}
          <div>
            <div className="section-title row gap-6"><Link2 style={{ width: 12, height: 12 }} /> Recent events</div>
            <div className="audit-list">
              {events.map((e) => (
                <div className="audit-ev" key={e.id}>
                  <span className="audit-ev__when">{e.at.replace('T', ' ').slice(0, 16)}</span>
                  <span className="audit-ev__kind"><Pill variant="outline" sm>{e.kind}</Pill></span>
                  <span className="audit-ev__sum">{e.summary}{e.refTable && <span className="tiny faint"> · {e.refTable}{e.refId !== null ? ` #${e.refId}` : ''}</span>}</span>
                  <code className="hash hash--sm" title={`hash ${e.hash}\nprev ${e.prevHash}`}>{shortHash(e.hash, 6)}</code>
                </div>
              ))}
              {d.events.length === 0 && <div className="rail__empty">No audit events yet.</div>}
            </div>
            {d.events.length > 6 && <button className="link mt-8" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show fewer' : `Show all ${d.events.length} loaded`}</button>}
          </div>
          <div>
            <div className="section-title row gap-6"><Anchor style={{ width: 12, height: 12 }} /> Daily anchors</div>
            {d.anchors.length === 0 ? <div className="tiny faint">No anchors yet; one is computed per day with events.</div> : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <thead><tr><th>Day</th><th>Merkle root</th><th className="num">Events</th><th>Status</th></tr></thead>
                  <tbody>
                    {d.anchors.slice(0, showAll ? undefined : 5).map((a) => (
                      <tr key={a.date} title={a.note}>
                        <td className="muted num">{dateLong(a.date)}</td>
                        <td><code className="hash hash--sm" title={a.root}>{shortHash(a.root, 8)}</code></td>
                        <td className="num"><Num n={a.events} /></td>
                        <td><Pill variant={a.status === 'published' ? 'verified' : 'outline'} sm title={a.note}>{a.status}</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="note row gap-8" style={{ alignItems: 'flex-start' }}><Lock style={{ width: 12, height: 12, flex: '0 0 12px', marginTop: 2 }} /><span>{d.explanation}</span></div>
        </div>
      )}
      {served && !d && !q.error && <div className="faint small">Loading…</div>}
    </Card>
  );
}

export default function EarningsPage() {
  const q = useApi<ParticipantLedger>('/participant/ledger');
  const [revoking, setRevoking] = useState<LedgerRow | null>(null);
  const revoke = useAction(async (row: LedgerRow) => { await api.post(`/participant/licenses/${row.licenseId}/revoke`); setRevoking(null); }, { success: 'License revoked (forward-only)' });
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const fees = d.entries.filter((e) => e.kind === 'license_fee').length;
  const contribs = d.entries.filter((e) => e.kind === 'contribution_payment').length;
  const microIds = new Set((d.groups ?? []).flatMap((g) => g.entryIds));
  const micro = d.entries.filter((e) => microIds.has(e.id)).length;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Earnings & Asset Ledger</h1><div className="sub">Every license, contribution and logging reward is a ledger row. Amounts shown are net to you.</div></div>
      </div>
      <div className="grid grid--4">
        <StatTile label="Lifetime earnings" icon={<Wallet />} iconTone="purple" value={<Money cents={d.lifetimeEarningsCents} exact />} delta={`${fees} license fees · ${contribs - micro} contribution payments${micro > 0 ? ` · ${micro} micro rewards` : ''}`} />
        <StatTile label="Active licenses" icon={<ShieldCheck />} iconTone="green" value={<Num n={d.activeLicenses} />} delta="in term today" />
        <StatTile label="Licensed uses" icon={<FlaskConical />} value={<Num n={d.licensedUses} />} delta={typeof d.rewardsToday === 'number' && d.rewardsToday > 0 ? <>studies that licensed your data · +<Money cents={d.rewardsToday} exact /> logging today</> : 'studies that licensed your data'} />
        <StatTile label="Your share" icon={<Percent />} iconTone="amber" value={`${Math.round(d.split.participant * 100)}%`} delta={`platform keeps ${Math.round(d.split.platform * 100)}% of the gross fee`} />
      </div>
      <div className="grid grid--2 gap-16">
        <LoggingRewardsCard served={d.rewardsToday !== undefined} summaryToday={d.rewardsToday} />
        <AuditCard served={d.audit !== undefined} summary={d.audit} />
      </div>
      <Card title="Asset ledger" sub={`Click a row for the full terms. Revoke is available on licenses still in term.${d.groups && d.groups.length > 0 ? ' Micro rewards are grouped per day; click a day to expand.' : ''}`}>
        <LedgerTable entries={d.entries} onRevoke={setRevoking} expandable groups={d.groups} />
      </Card>
      <RevokeDialog open={!!revoking} licenseNumber={revoking?.licenseNumber?.replace('#', '') ?? null} orgName={revoking?.orgName} studyName={revoking?.studyName} busy={revoke.busy} onConfirm={() => revoking && revoke.run(revoking)} onCancel={() => setRevoking(null)} />
    </div>
  );
}
