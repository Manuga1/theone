// P7 Review & Consent: what the sponsor receives / does not receive, terms, per-task compensation; Decline / Review consent /
// Accept (Accept is enabled only after the full terms were reviewed). For accepted studies: contribution tasks + Withdraw.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, RefreshCw, Upload, LogOut, FileText } from 'lucide-react';
import type { OpportunityDetail, ContributionItem } from '@shared/api-types';
import { useApi } from '../hooks';
import { api } from '../api';
import { useAction } from '../useAction';
import { Card, ConsentPanel, Pill, ErrorBox, money } from '../components';
import { SponsorPill } from './Opportunities';

function contribStatus(c: ContributionItem) {
  if (c.status === 'verified') return <Pill variant="verified" sm icon>Verified</Pill>;
  if (c.status === 'submitted') return <Pill variant="accent" sm>Submitted</Pill>;
  if (c.status === 'rejected') return <Pill variant="missing" sm>Rejected</Pill>;
  return <Pill variant="neutral" sm>Pending</Pill>;
}

function ContributionRow({ c }: { c: ContributionItem }) {
  const sim = useAction(async () => api.post(`/participant/contributions/${c.id}/simulate`), { success: `${c.name} submitted and verified` });
  const isDevice = c.method === 'device' || c.method === 'protocol' || c.method === 'kit';
  return (
    <tr>
      <td className="strong">{c.name}</td>
      <td className="muted">{c.method}{c.durationDays > 1 ? ` · ${c.durationDays} days` : ''}</td>
      <td className="num">{c.observationCount}</td>
      <td className="num strong">{money(c.compCents)}</td>
      <td>{contribStatus(c)}</td>
      <td className="right">
        {(c.status === 'pending' || c.status === 'rejected') && (
          <button className="btn btn--sm btn--primary" disabled={sim.busy} onClick={() => sim.run()}>
            {isDevice ? <><RefreshCw /> Sync data</> : <><Upload /> Submit</>}
          </button>
        )}
        {c.status === 'submitted' && <button className="btn btn--sm" disabled={sim.busy} onClick={() => sim.run()}><Check /> Verify</button>}
      </td>
    </tr>
  );
}

export default function OpportunityReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useApi<OpportunityDetail>(id ? `/participant/opportunities/${id}` : null);
  const [reviewedLocally, setReviewedLocally] = useState(false);

  const review = useAction(async () => { await api.post(`/participant/opportunities/${id}/review`); setReviewedLocally(true); });
  const accept = useAction(async () => { await api.post(`/participant/opportunities/${id}/accept`); }, { success: 'Consent recorded — license created and tasks ready' });
  const decline = useAction(async () => { await api.post(`/participant/opportunities/${id}/decline`); navigate('/p/opportunities'); }, { success: 'Opportunity declined' });
  const withdraw = useAction(async (enrollmentId: number) => { await api.post(`/participant/enrollments/${enrollmentId}/withdraw`); }, { success: 'Withdrawn — license revoked forward-only' });

  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const reviewed = d.reviewed || reviewedLocally;
  const open = d.tab === 'available' && ['offered', 'viewed', 'reviewed'].includes(d.status);
  const active = d.tab === 'in_progress';
  const allVerified = d.contributions.length > 0 && d.contributions.every((c) => c.status === 'verified');

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div>
          <div className="breadcrumb"><Link to="/p/opportunities" className="row gap-4"><ArrowLeft size={11} /> Opportunities</Link></div>
          <h1 className="h1">{d.title}</h1>
          <div className="sub row gap-8" style={{ marginTop: 6 }}><SponsorPill name={d.sponsor} type={d.sponsorType} /><span>{d.purpose}</span></div>
        </div>
        <div className="right">
          <div className="opp-card__comp">{d.compIsMax ? 'Up to ' : ''}{money(d.compCents)}</div>
          <div className="tiny faint">net to you · platform fee is added on top</div>
        </div>
      </div>

      <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
        <div className="col gap-16">
          <Card title="Review & consent" sub={`What ${d.consent.organization} receives, for how long, and what you get.`} right={reviewed ? <Pill variant="verified" sm icon>Terms reviewed</Pill> : <Pill variant="partial" sm>Not yet reviewed</Pill>}>
            <ConsentPanel consent={d.consent} />
          </Card>
          {(active || d.tab === 'past') && d.contributions.length > 0 && (
            <Card title="Your tasks" sub={active ? 'Sync or submit each task; verification happens automatically and pays into your ledger.' : 'Completed tasks.'}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Task</th><th>Method</th><th className="num">Observations</th><th className="num">Compensation</th><th>Status</th><th /></tr></thead>
                  <tbody>{d.contributions.map((c) => <ContributionRow key={c.id} c={c} />)}</tbody>
                </table>
              </div>
              {allVerified && <div className="callout callout--green mt-12">All tasks verified — this study is complete and your license scope now includes the collected data.</div>}
            </Card>
          )}
        </div>
        <div className="col gap-16">
          <Card title="Your decision">
            {open && (
              <div className="col gap-8">
                <button className="btn btn--block" disabled={review.busy} onClick={() => review.run()}><FileText /> {reviewed ? 'Terms reviewed' : 'Review consent'}</button>
                <button className="btn btn--primary btn--block" disabled={!reviewed || accept.busy} title={reviewed ? undefined : 'Review the full consent terms first'} onClick={() => accept.run()}><Check /> Accept</button>
                <button className="btn btn--ghost btn--block" disabled={decline.busy} onClick={() => decline.run()}>Decline</button>
                <div className="tiny faint">Accept is enabled only after you review the terms. Accepting creates the license and your ledger row; no license exists before that.</div>
              </div>
            )}
            {active && (
              <div className="col gap-8">
                <div className="small"><Pill variant="accent" sm>In progress</Pill></div>
                <div className="small muted">You can withdraw at any time. Your license is revoked forward-only: analyses already performed are not undone and payments stay in your ledger.</div>
                {d.enrollmentId && <button className="btn btn--danger btn--block" disabled={withdraw.busy} onClick={() => withdraw.run(d.enrollmentId!)}><LogOut /> Withdraw from study</button>}
              </div>
            )}
            {!open && !active && (
              <div className="small muted">This opportunity is {d.status.replace('_', ' ')}. {d.status === 'paid' || d.status === 'verified' ? 'See your Earnings for the payment rows.' : ''}</div>
            )}
          </Card>
          <Card title="Requirements" soft>
            <div className="checklist">
              {d.requirements.map((r) => <div className="checklist__item checklist__item--ok" key={r}><Check strokeWidth={3} />{r}</div>)}
              {d.reused.map((r) => <div className="checklist__item checklist__item--reuse" key={r}><Check strokeWidth={3} />Reuses your {r}</div>)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
