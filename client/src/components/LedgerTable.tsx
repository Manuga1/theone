// P8 Asset ledger: who / what / purpose / period / participant compensation / platform fee, with Revoke.
// `expandable` adds a detail row (gross split, scope, term) toggled by clicking the row.
import { Fragment, useState } from 'react';
import type { LedgerRow } from '@shared/api-types';
import { money, dateLong } from '@shared/fmt';
import { Pill } from './Pill';

export type LedgerTableProps = { entries: LedgerRow[]; onRevoke?: (row: LedgerRow) => void; onOpenLicense?: (row: LedgerRow) => void; expandable?: boolean };

function statusPill(s: LedgerRow['licenseStatus']) {
  if (s === 'active') return <Pill variant="verified" sm>Active</Pill>;
  if (s === 'expired') return <Pill variant="neutral" sm>Expired</Pill>;
  if (s === 'revoked') return <Pill variant="missing" sm>Revoked</Pill>;
  return <Pill variant="accent" sm>Paid</Pill>;
}

export function LedgerTable({ entries, onRevoke, expandable }: LedgerTableProps) {
  const [open, setOpen] = useState<number | null>(null);
  if (entries.length === 0) return <div className="rail__empty">No ledger entries yet.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>What</th>
            <th>Who</th>
            <th>Purpose</th>
            <th>Period</th>
            <th className="num">You received</th>
            <th className="num">Platform fee</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((r) => {
            const isOpen = expandable && open === r.id;
            return (
              <Fragment key={r.id}>
                <tr className={`${expandable ? 'row--click' : ''}${isOpen ? ' row--open' : ''}`} onClick={expandable ? () => setOpen(isOpen ? null : r.id) : undefined}>
                  <td className="muted num">{dateLong(r.date)}</td>
                  <td>
                    <div className="strong">{r.title}</div>
                    <div className="tiny faint">{r.kind === 'license_fee' ? `License ${r.licenseNumber ?? '—'} · ` : 'Contribution · '}{r.dataIncluded.join(', ')}</div>
                  </td>
                  <td>
                    <div>{r.orgName}</div>
                    <div className="tiny faint">{r.studyName}</div>
                  </td>
                  <td className="muted" style={{ maxWidth: 200 }}>{r.purpose}</td>
                  <td className="muted num">{r.termStart && r.termEnd ? `${dateLong(r.termStart)} – ${dateLong(r.termEnd)}` : '—'}</td>
                  <td className="num strong">{money(r.participantCents, { cents: true })}</td>
                  <td className="num muted">{money(r.platformCents, { cents: true })}</td>
                  <td>{statusPill(r.licenseStatus)}</td>
                  <td className="right">
                    {r.canRevoke && onRevoke && (
                      <button className="btn btn--sm btn--danger" onClick={(e) => { e.stopPropagation(); onRevoke(r); }}>Revoke</button>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="ledger-detail">
                    <td colSpan={9}>
                      <div className="kv-grid">
                        <div><span className="k">Gross fee</span><span className="v">{money(r.grossCents, { cents: true })}</span></div>
                        <div><span className="k">Your share</span><span className="v">{money(r.participantCents, { cents: true })} ({r.grossCents > 0 ? Math.round((r.participantCents / r.grossCents) * 100) : 0}%)</span></div>
                        <div><span className="k">Platform fee</span><span className="v">{money(r.platformCents, { cents: true })}</span></div>
                        <div><span className="k">Scope</span><span className="v">{r.dataIncluded.join(', ') || '—'}</span></div>
                        <div><span className="k">Purpose</span><span className="v">{r.purpose}</span></div>
                        <div><span className="k">{r.kind === 'license_fee' ? 'License term' : 'Paid on'}</span><span className="v">{r.termStart && r.termEnd ? `${dateLong(r.termStart)} → ${dateLong(r.termEnd)}` : dateLong(r.date)}</span></div>
                      </div>
                      {r.licenseStatus === 'revoked' && <div className="tiny faint mt-8">Revoked forward-only: analyses already performed were not undone and this payment stays in your ledger.</div>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
