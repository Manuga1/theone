// B7 Active Study: cohort progress counters, per-variable coverage, replacement note, Advance 7 days / Recontact /
// View participants (study-scoped pseudonyms, k-floored).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FastForward, Users, RefreshCw, Database, PlusCircle } from 'lucide-react';
import type { StudyCounters, StudyDetail, StudyParticipants } from '@shared/api-types';
import { api } from '../api';
import { useApi } from '../hooks';
import { useAction } from '../useAction';
import { Card, BarRow, Pill, ErrorBox, KNum, kfloor } from '../components';
import { studyStatusPill } from './Studies';

export default function StudyPage() {
  const { id } = useParams();
  const q = useApi<StudyDetail>(id ? `/buyer/studies/${id}` : null);
  const [showParticipants, setShowParticipants] = useState(false);
  const parts = useApi<StudyParticipants>(showParticipants && id ? `/buyer/studies/${id}/participants` : null);
  const advance = useAction(async () => api.post(`/buyer/studies/${id}/advance`, { days: 7 }), { success: 'Advanced the study clock by 7 days' });
  const recontact = useAction(async () => api.post(`/buyer/studies/${id}/recontact`), { success: 'Replacement invitations sent' });
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const c = d.counters;
  const pct = (n: number) => (d.targetN > 0 ? Math.min(100, (n / d.targetN) * 100) : 0);
  // Per-campaign counters are additive on StudyDetail.campaigns; render the table only when the API serves them.
  type CampaignRow = StudyDetail['campaigns'][number] & { counters: StudyCounters };
  const withCounters = (d.campaigns as (Omit<StudyDetail['campaigns'][number], 'counters'> & { counters?: StudyCounters | null })[]).filter((cp): cp is CampaignRow => !!cp.counters);
  const campaignRows: CampaignRow[] = [...withCounters.filter((cp) => !cp.parentCampaignId), ...withCounters.filter((cp) => !!cp.parentCampaignId)];

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div>
          <div className="breadcrumb"><Link to="/b/studies">My Studies</Link><span>›</span></div>
          <h1 className="h1 row gap-8">{d.name} {studyStatusPill(d.status)}</h1>
          <div className="sub">{d.cohortSummary || d.purpose}</div>
        </div>
        <div className="row gap-6">
          <button className="btn" disabled={advance.busy} onClick={() => advance.run()}><FastForward /> Advance 7 days</button>
          <button className="btn" disabled={recontact.busy || c.needReplacement === 0} onClick={() => recontact.run()}><RefreshCw /> Recontact</button>
          <button className={`btn${showParticipants ? ' btn--primary' : ''}`} onClick={() => setShowParticipants((v) => !v)}><Users /> View participants</button>
        </div>
      </div>
      <div className="grid gap-16" style={{ gridTemplateColumns: '380px minmax(0, 1fr)' }}>
        <div className="col gap-16">
          <Card title="Cohort progress" sub={d.purpose}>
            <div className="counter-list">
              <div><span>Cohort target</span><span className="v"><KNum n={d.targetN} /></span></div>
              <div><span>Eligible</span><span className="v"><KNum n={c.eligible} /></span></div>
              <div><span>Invited</span><span className="v"><KNum n={c.invited} /></span></div>
              <div><span>Accepted</span><span className="v"><KNum n={c.accepted} /></span></div>
              <div><span>Collection started</span><span className="v"><KNum n={c.started} /></span></div>
              <div><span>Completed</span><span className="v"><KNum n={c.completed} /></span></div>
              <div><span>Quality accepted</span><span className="v"><KNum n={c.qualityAccepted} /></span></div>
            </div>
            <div className="mt-12"><BarRow label="To target" value={pct(c.qualityAccepted)} tone="green" labelWidth={64} /></div>
            {campaignRows.length > 0 && (
              <div className="mt-12">
                <div className="section-title" style={{ marginBottom: 6 }}>Per campaign</div>
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead><tr><th>Campaign</th><th className="num">Invited</th><th className="num">Accepted</th><th className="num">Completed</th><th className="num">Quality</th></tr></thead>
                    <tbody>
                      {campaignRows.map((cp) => (
                        <tr key={cp.id}>
                          <td className={cp.parentCampaignId ? 'muted' : 'strong'} style={cp.parentCampaignId ? { paddingLeft: 18 } : undefined}>{cp.parentCampaignId ? '↳ ' : ''}{cp.name}</td>
                          <td className="num">{kfloor(cp.counters.invited)}</td>
                          <td className="num">{kfloor(cp.counters.accepted)}</td>
                          <td className="num">{kfloor(cp.counters.completed)}</td>
                          <td className="num">{kfloor(cp.counters.qualityAccepted)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
          <Card title="Campaigns" soft>
            <div className="list">
              {d.campaigns.map((cp) => <div className="list__item" key={cp.id}><span className="list__text">{cp.name}{cp.parentCampaignId ? <span className="tiny faint"> · child of #{cp.parentCampaignId}</span> : null}</span><Pill variant={cp.status === 'active' ? 'verified' : 'neutral'} sm>{cp.status.replace('_', ' ')}</Pill></div>)}
              {d.campaigns.length === 0 && <div className="rail__empty">No campaigns.</div>}
            </div>
          </Card>
        </div>
        <div className="col gap-16">
          <Card title="Data coverage (completed)" sub="Verified ÷ collection started, per variable.">
            <div className="col gap-8">
              {d.coverage.map((v) => <BarRow key={v.slug} label={v.label} value={v.pct} display={`${Math.round(v.pct)}%`} tone={v.pct >= 90 ? 'green' : v.pct >= 60 ? 'accent' : 'amber'} labelWidth={160} />)}
              {d.coverage.length === 0 && <div className="rail__empty">No collection variables.</div>}
            </div>
            <div className={`callout mt-12 ${c.needReplacement === 0 ? 'callout--green' : 'callout--amber'}`}>{c.needReplacement === 0 ? (d.replacementNote || 'No participants need replacement or recontact right now.') : (d.replacementNote || `${kfloor(c.needReplacement)} participants need replacement / recontact.`)}</div>
          </Card>
          <div className="grid grid--2">
            <Card title="Dataset" soft>
              {d.datasetId ? <Link className="btn btn--primary" to={`/b/datasets/${d.datasetId}`}><Database /> Open dataset</Link> : <div className="small muted">A dataset is built once quality-accepted participants exist.</div>}
            </Card>
            <Card title="Need another variable?" soft>
              <Link className="btn" to={`/b/studies/${d.id}/request-variable`}><PlusCircle /> Request additional variable</Link>
              <div className="tiny faint mt-8">License term {d.licenseTermMonths} months · advanced {d.lastAdvancedDays} days so far</div>
            </Card>
          </div>
          {showParticipants && (
            <Card title="Participants" sub={parts.data ? `${parts.data.floored ? 'fewer than 20 — list withheld' : `${parts.data.n.toLocaleString('en-US')} members`} · study-scoped pseudonyms, age bands and country only` : 'Loading…'}>
              {parts.error && <ErrorBox error={parts.error} />}
              {parts.data && !parts.data.floored && (
                <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
                  <table className="table table--compact">
                    <thead><tr><th>Pseudonym</th><th>Age band</th><th>Country</th><th>Status</th>{parts.data.columns.map((col) => <th key={col.slug}>{col.label}</th>)}</tr></thead>
                    <tbody>
                      {parts.data.rows.map((r) => (
                        <tr key={r.memberPseudonym}><td><code>{r.memberPseudonym}</code></td><td>{r.ageBand}</td><td>{r.country}</td><td><Pill variant="outline" sm>{r.status}</Pill></td>{parts.data!.columns.map((col) => <td key={col.slug}><span className={`dot dot--${r.variables[col.slug] === 'complete' ? 'verified' : r.variables[col.slug] === 'pending' ? 'partial' : 'muted'}`} title={r.variables[col.slug]} /></td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {parts.data?.floored && <div className="rail__empty">Fewer than 20 participants — row-level listing is withheld (k-floor).</div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
