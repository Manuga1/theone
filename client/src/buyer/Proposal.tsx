// Proposal: the draft campaign (variables, modes, requirements, cost lines, term, 90/10 disclosure) with
// Request proposal / Launch pilot. Launch offers opportunities; no license exists until a participant accepts.
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { FileCheck, Rocket } from 'lucide-react';
import type { Campaign } from '@shared/api-types';
import { api } from '../api';
import { useApi } from '../hooks';
import { useAction } from '../useAction';
import { Card, Pill, ErrorBox, KNum, Money, MoneyK, money } from '../components';
import { CohortStepBar, CohortSubNav, MODE_LABEL, requirementLabel } from './shared';

const STATUS: Record<Campaign['status'], { label: string; variant: 'neutral' | 'accent' | 'verified' | 'outline' }> = {
  draft: { label: 'Draft', variant: 'neutral' }, proposal_requested: { label: 'Proposal requested', variant: 'accent' }, active: { label: 'Active', variant: 'verified' }, closed: { label: 'Closed', variant: 'outline' },
};

export default function ProposalPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const list = useApi<{ campaigns: Campaign[] } | Campaign[]>('/buyer/campaigns');
  const campaigns = Array.isArray(list.data) ? list.data : list.data?.campaigns ?? [];
  const wanted = params.get('campaign');
  const c = campaigns.find((x) => String(x.id) === wanted) ?? campaigns.filter((x) => String(x.cohortId) === id).sort((a, b) => b.id - a.id)[0] ?? null;
  const request = useAction(async () => api.post(`/buyer/campaigns/${c!.id}/request-proposal`), { success: 'Proposal requested' });
  const launch = useAction(async () => { await api.post(`/buyer/campaigns/${c!.id}/launch`); navigate(`/b/studies/${c!.studyId}`); }, { success: 'Pilot launched — opportunities offered to participants' });

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Proposal</h1><div className="sub">Review the campaign and launch a pilot. Licenses are created only when participants accept.</div></div>
        <CohortStepBar id={id} active="proposal" />
      </div>
      {id && <CohortSubNav id={id} active="proposal" />}
      {list.error && <ErrorBox error={list.error} />}
      {!list.loading && !c && (
        <Card><div className="rail__empty">No campaign drafted for this cohort yet. <Link to={`/b/cohorts/${id}/expand`}>Create one from the Expand step.</Link></div></Card>
      )}
      {c && (
        <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px' }}>
          <div className="col gap-16">
            <Card title={c.name} sub={`Target complete N ${c.targetN.toLocaleString('en-US')} · ${c.licenseTermMonths}-month license · created ${c.createdAt.slice(0, 10)}`} right={<Pill variant={STATUS[c.status].variant}>{STATUS[c.status].label}</Pill>}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Variable</th><th>Mode</th><th>Requirement</th><th className="num">Participant comp / fee</th><th className="num">Device / test</th></tr></thead>
                  <tbody>
                    {c.variables.map((v) => (
                      <tr key={v.conceptSlug}><td className="strong">{v.name}</td><td className="muted">{MODE_LABEL[v.mode]}</td><td className="muted">{requirementLabel(v)}</td><td className="num">{v.compCents > 0 ? <>{money(v.compCents)}<div className="tiny faint">{v.mode === 'reuse' ? 'reuse fee' : 'comp'}</div></> : <span className="faint">—</span>}</td><td className="num">{v.deviceCostCents ? money(v.deviceCostCents) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="tiny faint mt-8">Modes: “Reuse” licenses data the participant already holds (a reuse fee, no new collection) · “Collect if missing” collects only where absent · “Collect for all” re-measures ready-now members too.</div>
            </Card>
            <Card title="Terms" soft>
              <div className="why">
                <p><strong>Participant is the principal.</strong> Each invited participant reviews what you receive and what you do not, the purpose, the {c.licenseTermMonths}-month term, no reuse without new consent, and recontact only via the platform. Accepting creates a license and a ledger row; nothing is licensed at launch.</p>
                <p><strong>90 / 10 split.</strong> Compensation shown to participants is net; gross = net ÷ 0.9. The platform's 10 % is disclosed on every ledger row.</p>
                <p><strong>Forward-only revocation.</strong> A participant may withdraw at any time; the next dataset refresh drops them, analyses already performed are not undone.</p>
              </div>
            </Card>
          </div>
          <div className="col gap-16">
            <Card title="Estimate">
              <div className="estimate-rows">
                <div><span>Participants to contact</span><span className="v"><KNum n={c.estimate.contacts} /></span></div>
                <div><span>Expected acceptance</span><span className="v"><KNum n={c.estimate.accepted} /></span></div>
                <div><span>Expected completion</span><span className="v"><KNum n={c.estimate.completed} /></span></div>
                <div><span>Timeline</span><span className="v">{c.estimate.weeksLow}–{c.estimate.weeksHigh} weeks</span></div>
                {c.estimate.costLines.map((l) => <div key={l.key}><span>{l.label}</span><span className="v"><MoneyK cents={l.cents} /></span></div>)}
                <div><span className="strong">Total</span><span className="v v--total"><Money cents={c.estimate.totalCents} /></span></div>
              </div>
            </Card>
            <Card title="Actions">
              <div className="col gap-8">
                <button className="btn btn--block" disabled={c.status !== 'draft' || request.busy} onClick={() => request.run()}><FileCheck /> Request proposal</button>
                <button className="btn btn--primary btn--block" disabled={!['draft', 'proposal_requested'].includes(c.status) || launch.busy} onClick={() => launch.run()}><Rocket /> Launch pilot</button>
                {c.status === 'active' && <Link className="btn btn--ghost btn--block" to={`/b/studies/${c.studyId}`}>Open study</Link>}
              </div>
              <div className="tiny faint mt-8">Launching offers an opportunity to {c.estimate.contacts.toLocaleString('en-US')} recruitable participants.</div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
