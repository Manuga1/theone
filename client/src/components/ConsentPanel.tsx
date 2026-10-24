// P7 Review & Consent: what the sponsor receives / does not receive, term, reuse, recontact and compensation.
import { Check, X } from 'lucide-react';
import type { OpportunityDetail } from '@shared/api-types';
import { money } from '@shared/fmt';

export type ConsentPanelProps = { consent: OpportunityDetail['consent']; compact?: boolean };

export function ConsentPanel({ consent, compact }: ConsentPanelProps) {
  return (
    <div className="consent">
      <div className="consent__box consent__box--ok">
        <div className="consent__box-title">{consent.organization} receives</div>
        <div className="checklist">
          {consent.receive.map((r) => (
            <div className="checklist__item checklist__item--ok" key={r}><Check strokeWidth={3} />{r}</div>
          ))}
          {consent.receive.length === 0 && <div className="faint small">Nothing selected.</div>}
        </div>
      </div>
      <div className="consent__box consent__box--no">
        <div className="consent__box-title">Does not receive</div>
        <div className="checklist">
          {consent.doNotReceive.map((r) => (
            <div className="checklist__item checklist__item--no" key={r}><X strokeWidth={3} />{r}</div>
          ))}
        </div>
      </div>
      <div className="consent__terms">
        <div className="consent__term"><div className="consent__term-k">Purpose</div><div className="consent__term-v">{consent.purpose}</div></div>
        <div className="consent__term"><div className="consent__term-k">License term</div><div className="consent__term-v">{consent.licenseTermMonths} months</div></div>
        <div className="consent__term"><div className="consent__term-k">Future reuse</div><div className="consent__term-v">{consent.futureReuse ? 'Allowed' : 'Not allowed without new consent'}</div></div>
        <div className="consent__term"><div className="consent__term-k">Recontact</div><div className="consent__term-v">{consent.recontact === 'platform_only' ? 'Only via the platform' : consent.recontact}</div></div>
        <div className="consent__term"><div className="consent__term-k">Compensation</div><div className="consent__term-v">{money(consent.compCents)} total</div></div>
        <div className="consent__term"><div className="consent__term-k">Already-held data</div><div className="consent__term-v">{money(consent.reusedCompCents)} reuse fee</div></div>
      </div>
      {!compact && consent.perTask.length > 0 && (
        <div className="consent__tasks">
          <div className="section-title">Per-task compensation</div>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr><th>Task</th><th>Method</th><th className="num">Duration</th><th className="num">Compensation</th></tr></thead>
              <tbody>
                {consent.perTask.map((t) => (
                  <tr key={t.conceptSlug}>
                    <td>{t.name}</td>
                    <td className="muted">{t.method}</td>
                    <td className="num">{t.durationDays > 0 ? `${t.durationDays} d` : '—'}</td>
                    <td className="num strong">{money(t.compCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
