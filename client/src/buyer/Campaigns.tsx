// Collection Campaigns: every campaign for this organisation with status, target, estimate and live counters.
import { Link } from 'react-router-dom';
import type { Campaign } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, Pill, ErrorBox, kfloor, moneyK } from '../components';

const STATUS_VARIANT: Record<Campaign['status'], 'neutral' | 'accent' | 'verified' | 'outline'> = { draft: 'neutral', proposal_requested: 'accent', active: 'verified', closed: 'outline' };

export default function CampaignsPage() {
  const q = useApi<{ campaigns: Campaign[] } | Campaign[]>('/buyer/campaigns');
  const campaigns = Array.isArray(q.data) ? q.data : q.data?.campaigns ?? [];
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Collection Campaigns</h1><div className="sub">draft → proposal requested → active → closed. Launch offers opportunities; participants license on acceptance.</div></div>
      </div>
      {q.error && <ErrorBox error={q.error} />}
      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Campaign</th><th>Status</th><th className="num">Target N</th><th>Variables</th><th className="num">Contacts</th><th className="num">Invited</th><th className="num">Completed</th><th className="num">Budget</th><th>Study</th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td><Link className="strong" to={c.cohortId ? `/b/cohorts/${c.cohortId}/proposal?campaign=${c.id}` : `/b/studies/${c.studyId}`}>{c.name}</Link>{c.parentCampaignId ? <div className="tiny faint">child of #{c.parentCampaignId}</div> : null}</td>
                  <td><Pill variant={STATUS_VARIANT[c.status]} sm>{c.status.replace('_', ' ')}</Pill></td>
                  <td className="num">{kfloor(c.targetN)}</td>
                  <td className="muted">{c.variables.map((v) => v.name).join(', ')}</td>
                  <td className="num">{kfloor(c.estimate.contacts)}</td>
                  <td className="num">{c.counters ? kfloor(c.counters.invited) : '—'}</td>
                  <td className="num">{c.counters ? kfloor(c.counters.completed) : '—'}</td>
                  <td className="num">{moneyK(c.estimate.totalCents)}</td>
                  <td><Link to={`/b/studies/${c.studyId}`}>Study #{c.studyId}</Link></td>
                </tr>
              ))}
              {!q.loading && campaigns.length === 0 && <tr><td colSpan={9} className="faint center">No campaigns yet{q.error ? ' (endpoint unavailable)' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
