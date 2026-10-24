// P8 Asset Ledger: lifetime earnings + active licenses tiles and the who/what/purpose/period/compensation table with Revoke.
import { useState } from 'react';
import { Wallet, ShieldCheck, FlaskConical, Percent } from 'lucide-react';
import type { ParticipantLedger, LedgerRow } from '@shared/api-types';
import { useApi } from '../hooks';
import { api } from '../api';
import { useAction } from '../useAction';
import { Card, StatTile, LedgerTable, RevokeDialog, ErrorBox, Money, Num } from '../components';

export default function EarningsPage() {
  const q = useApi<ParticipantLedger>('/participant/ledger');
  const [revoking, setRevoking] = useState<LedgerRow | null>(null);
  const revoke = useAction(async (row: LedgerRow) => { await api.post(`/participant/licenses/${row.licenseId}/revoke`); setRevoking(null); }, { success: 'License revoked (forward-only)' });
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const fees = d.entries.filter((e) => e.kind === 'license_fee').length;
  const contribs = d.entries.filter((e) => e.kind === 'contribution_payment').length;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Earnings & Asset Ledger</h1><div className="sub">Every license and every verified contribution is a ledger row. Amounts shown are net to you.</div></div>
      </div>
      <div className="grid grid--4">
        <StatTile label="Lifetime earnings" icon={<Wallet />} iconTone="purple" value={<Money cents={d.lifetimeEarningsCents} exact />} delta={`${fees} license fees · ${contribs} contribution payments`} />
        <StatTile label="Active licenses" icon={<ShieldCheck />} iconTone="green" value={<Num n={d.activeLicenses} />} delta="in term today" />
        <StatTile label="Licensed uses" icon={<FlaskConical />} value={<Num n={d.licensedUses} />} delta="studies that licensed your data" />
        <StatTile label="Your share" icon={<Percent />} iconTone="amber" value={`${Math.round(d.split.participant * 100)}%`} delta={`platform keeps ${Math.round(d.split.platform * 100)}% of the gross fee`} />
      </div>
      <Card title="Asset ledger" sub="Click a row for the full terms. Revoke is available on licenses still in term.">
        <LedgerTable entries={d.entries} onRevoke={setRevoking} expandable />
      </Card>
      <RevokeDialog open={!!revoking} licenseNumber={revoking?.licenseNumber?.replace('#', '') ?? null} orgName={revoking?.orgName} studyName={revoking?.studyName} busy={revoke.busy} onConfirm={() => revoking && revoke.run(revoking)} onCancel={() => setRevoking(null)} />
    </div>
  );
}
