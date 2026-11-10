// P8 Asset ledger: who / what / purpose / period / participant compensation / platform fee, with Revoke.
// `expandable` adds a detail row (gross split, scope, term) toggled by clicking the row. `groups` (LedgerExtras.groups)
// collapses the micro rewards of one day into a single day row that expands to the individual payments.
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import type { LedgerRow, LedgerExtras } from '@shared/api-types';
import { money, dateLong } from '@shared/fmt';
import { Pill } from './Pill';

export type LedgerGroup = NonNullable<LedgerExtras['groups']>[number];
export type LedgerTableProps = { entries: LedgerRow[]; onRevoke?: (row: LedgerRow) => void; onOpenLicense?: (row: LedgerRow) => void; expandable?: boolean; groups?: LedgerGroup[] };

type Block = { kind: 'row'; row: LedgerRow } | { kind: 'group'; group: LedgerGroup; rows: LedgerRow[] };

/** Keep the ledger order; the first entry of a group is where its day row goes, the rest fold into it. */
export function blocksOf(entries: LedgerRow[], groups: LedgerGroup[] = []): Block[] {
  const byId = new Map<number, LedgerGroup>();
  for (const g of groups) for (const id of g.entryIds) byId.set(id, g);
  const placed = new Set<string>();
  const out: Block[] = [];
  for (const row of entries) {
    const g = byId.get(row.id);
    if (!g) { out.push({ kind: 'row', row }); continue; }
    if (placed.has(g.date)) continue;
    placed.add(g.date);
    const ids = new Set(g.entryIds);
    out.push({ kind: 'group', group: g, rows: entries.filter((e) => ids.has(e.id)) });
  }
  return out;
}

function statusPill(s: LedgerRow['licenseStatus']) {
  if (s === 'active') return <Pill variant="verified" sm>Active</Pill>;
  if (s === 'expired') return <Pill variant="neutral" sm>Expired</Pill>;
  if (s === 'revoked') return <Pill variant="missing" sm>Revoked</Pill>;
  return <Pill variant="accent" sm>Paid</Pill>;
}

export function LedgerTable({ entries, onRevoke, expandable, groups }: LedgerTableProps) {
  const [open, setOpen] = useState<number | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  if (entries.length === 0) return <div className="rail__empty">No ledger entries yet.</div>;
  const toggleDay = (date: string) => setOpenDays((s) => { const n = new Set(s); if (n.has(date)) n.delete(date); else n.add(date); return n; });
  const blocks = blocksOf(entries, groups);
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
          {blocks.map((b) => {
            if (b.kind === 'group') {
              const g = b.group;
              const dayOpen = openDays.has(g.date);
              return (
                <Fragment key={`day-${g.date}`}>
                  <tr className={`row--click ledger-day${dayOpen ? ' row--open' : ''}`} onClick={() => toggleDay(g.date)} data-testid="ledger-day" aria-expanded={dayOpen}>
                    <td className="muted num">{dateLong(g.date)}</td>
                    <td colSpan={4}>
                      <div className="strong row gap-6">{dayOpen ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}<span className="list__icon list__icon--green" style={{ width: 18, height: 18 }}><Zap /></span>{g.label}</div>
                      <div className="tiny faint">{g.count} micro reward{g.count === 1 ? '' : 's'} · logs, photos and check-ins filed that day · click to {dayOpen ? 'collapse' : 'expand'}</div>
                    </td>
                    <td className="num strong">{money(g.cents, { cents: true })}</td>
                    <td className="num muted">{money(b.rows.reduce((a, r) => a + r.platformCents, 0), { cents: true })}</td>
                    <td><Pill variant="accent" sm>{g.count} paid</Pill></td>
                    <td />
                  </tr>
                  {dayOpen && b.rows.map((r) => renderRow(r, true))}
                </Fragment>
              );
            }
            return renderRow(b.row, false);
          })}
        </tbody>
      </table>
    </div>
  );

  function renderRow(r: LedgerRow, micro: boolean) {
            const isOpen = expandable && open === r.id;
            return (
              <Fragment key={r.id}>
                <tr className={`${expandable ? 'row--click' : ''}${isOpen ? ' row--open' : ''}${micro ? ' ledger-micro' : ''}`} onClick={expandable ? () => setOpen(isOpen ? null : r.id) : undefined}>
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
  }
}
