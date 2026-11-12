// P6 Research Opportunities: Available / In Progress / Past tabs with study cards. In vault mode the list is empty and
// the API says why (`disabledReason`, additive on ParticipantOpportunities); the page shows that reason instead of cards.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Database, Sparkles, Clock, Vault } from 'lucide-react';
import type { ParticipantOpportunities, OpportunityCard, OpportunityTab, ParticipantPermissions } from '@shared/api-types';
import { useApi } from '../hooks';
import { api } from '../api';
import { useAction } from '../useAction';
import { Card, Tabs, Pill, ErrorBox, EmptyState, Illustrative, money } from '../components';
import { dateLong as fmtDate } from '@shared/fmt';

/** Additive (proposed for shared/api-types): why the list is empty, e.g. 'vault mode'. Read defensively until the contract carries it. */
type OpportunitiesPayload = ParticipantOpportunities & { disabledReason?: string | null };

const SPONSOR_COLOR: Record<OpportunityCard['sponsorType'], string> = { pharma: '#d64545', biotech: '#1397a8', academic: '#1d6ef5', other: '#5b6b85' };

export function SponsorPill({ name, type }: { name: string; type: OpportunityCard['sponsorType'] }) {
  return <span className="opp-card__sponsor"><span className="opp-card__sponsor-dot" style={{ background: SPONSOR_COLOR[type] }}>{name[0]}</span>{name}</span>;
}

function statusPill(o: OpportunityCard) {
  switch (o.status) {
    case 'paid': case 'verified': return <Pill variant="verified" sm icon>Completed</Pill>;
    case 'declined': return <Pill variant="neutral" sm>Declined</Pill>;
    case 'withdrawn': return <Pill variant="missing" sm>Withdrawn</Pill>;
    case 'expired': return <Pill variant="neutral" sm>Expired</Pill>;
    case 'rejected': return <Pill variant="missing" sm>Rejected</Pill>;
    case 'accepted': case 'in_progress': case 'submitted': return <Pill variant="accent" sm>In progress</Pill>;
    case 'reviewed': return <Pill variant="purple" sm>Reviewed</Pill>;
    case 'viewed': return <Pill variant="outline" sm>Viewed</Pill>;
    default: return <Pill variant="opportunity" sm>New</Pill>;
  }
}

function OppCard({ o }: { o: OpportunityCard }) {
  const navigate = useNavigate();
  // Best effort: record the view, then open the review screen even if the view endpoint is unavailable.
  const interested = useAction(async () => {
    if (o.status === 'offered') await api.post(`/participant/opportunities/${o.id}/view`).catch(() => undefined);
    navigate(`/p/opportunities/${o.id}`);
  });
  const done = o.contributions.filter((c) => c.status === 'verified').length;
  return (
    <Card className="opp-card">
      <div className="row row--between row--top">
        <div className="opp-card__title">{o.title}</div>
        {statusPill(o)}
      </div>
      <div className="row gap-8" style={{ alignItems: 'baseline' }}>
        <span className="opp-card__comp">{o.compIsMax ? 'Up to ' : ''}{money(o.compCents)}</span>
        <SponsorPill name={o.sponsor} type={o.sponsorType} />
      </div>
      <Illustrative className="illus--tight" />
      <div className="small muted">{o.purpose}</div>
      <div className="checklist">
        {o.requirements.map((r) => <div className="checklist__item checklist__item--ok" key={r}><Check strokeWidth={3} />{r}</div>)}
        {o.reused.length > 0 && <div className="checklist__item checklist__item--reuse"><Database />Uses your {o.reused.join(', ')}</div>}
        {o.likelyMatch && o.tab === 'available' && <div className="checklist__item checklist__item--match"><Sparkles />Likely match based on your profile</div>}
      </div>
      {o.tab === 'in_progress' && o.contributions.length > 0 && (
        <div className="small muted row gap-6"><Clock size={11} /> {done} of {o.contributions.length} tasks verified</div>
      )}
      {o.tab === 'past' && (
        <div className="tiny faint">Offered {fmtDate(o.offeredAt)}{o.completedAt ? ` · completed ${fmtDate(o.completedAt)}` : ''}</div>
      )}
      <div className="opp-card__actions">
        <Link className="link" to={`/p/opportunities/${o.id}`}>View details</Link>
        {o.tab === 'available' && <button className="btn btn--sm btn--primary" disabled={interested.busy} onClick={() => interested.run()}>I'm interested</button>}
        {o.tab === 'in_progress' && <Link className="btn btn--sm btn--primary" to={`/p/opportunities/${o.id}`}>Continue</Link>}
      </div>
    </Card>
  );
}

export default function OpportunitiesPage() {
  const [tab, setTab] = useState<OpportunityTab>('available');
  const q = useApi<OpportunitiesPayload>(`/participant/opportunities?tab=${tab}`);
  // Older APIs leave the list empty without a reason in vault mode; the permissions flag (already served) is the fallback.
  const perms = useApi<ParticipantPermissions>('/participant/permissions');
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  const vaultReason = d?.disabledReason ?? (perms.data?.vaultOnly ? 'Vault mode is on: no research opportunities are offered while your data is used purely as a vault.' : null);
  const vaultEmpty = !!vaultReason && (d?.items.filter((o) => o.tab === tab).length ?? 0) === 0;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Earn by contributing to research</h1><div className="sub">You're invited to participate in these studies. You control what to share.</div></div>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ key: 'available', label: 'Available', count: d?.counts.available ?? null }, { key: 'in_progress', label: 'In Progress', count: d?.counts.in_progress ?? null }, { key: 'past', label: 'Past', count: d?.counts.past ?? null }]} />
      {vaultEmpty ? (
        <Card>
          <EmptyState
            icon={<Vault />}
            title="Vault mode — nothing is offered"
            body={<span data-testid="vault-reason">{vaultReason} Everything you log is still filed and verified; switch vault mode off to see opportunities and earn again.</span>}
            action={<Link className="btn btn--primary btn--sm mt-12" to="/p/permissions">Open Permissions</Link>}
          />
        </Card>
      ) : (
        <div className="grid grid--2 gap-16">
          {(d?.items ?? []).filter((o) => o.tab === tab).map((o) => <OppCard key={o.id} o={o} />)}
          {d && d.items.filter((o) => o.tab === tab).length === 0 && <div className="rail__empty">Nothing here yet.</div>}
        </div>
      )}
    </div>
  );
}
