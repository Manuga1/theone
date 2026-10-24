// P3 Data Node Detail: header + Verified pill + tabs (Overview / Timeline / Data Lineage / Research Use).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Database, ShieldCheck, FlaskConical, Users, ChevronRight } from 'lucide-react';
import type { NodeDetail } from '@shared/api-types';
import { PROVENANCE_LABEL } from '@shared/provenance';
import { useApi } from '../hooks';
import { Card, Tabs, StatePill, Pill, LazyBPChart, LineageChain, TimelineRail, ErrorBox, Money, Num, money } from '../components';
import { dateLong as fmtDate } from '@shared/fmt';

type Tab = 'overview' | 'timeline' | 'lineage' | 'research';

function SourceCards({ d }: { d: NodeDetail }) {
  return (
    <div className="grid grid--2">
      <Card soft tight>
        <div className="row gap-8"><span className="list__icon"><Database /></span><div><div className="tiny faint" style={{ fontWeight: 600 }}>Source</div><div className="strong">{d.summary.sourceLabel ?? 'No source yet'}</div><div className="small muted">{d.summary.acquisition ?? '—'}</div></div></div>
      </Card>
      <Card soft tight>
        <div className="row gap-8"><span className="list__icon list__icon--green"><ShieldCheck /></span><div><div className="tiny faint" style={{ fontWeight: 600 }}>Verification</div><div className="strong">{d.summary.verification}</div><div className="small muted">{d.summary.lastSyncRelative ? `Last synced: ${d.summary.lastSyncRelative}` : d.summary.provenanceClass ? PROVENANCE_LABEL[d.summary.provenanceClass] : '—'}</div></div></div>
      </Card>
    </div>
  );
}

function ResearchCards({ d }: { d: NodeDetail }) {
  // Stacked: these live in the 360px aside, where two columns wrap every label onto three lines.
  return (
    <div className="col gap-8">
      <Card soft tight>
        <div className="row gap-8"><span className="list__icon list__icon--purple"><FlaskConical /></span><div><div className="strong">Licensed in {d.research.licenses} {d.research.licenses === 1 ? 'study' : 'studies'}</div><div className="small muted">Lifetime earnings: <strong><Money cents={d.research.earningsCents} /></strong></div></div></div>
      </Card>
      <Card soft tight>
        <div className="row gap-8"><span className="list__icon list__icon--amber"><Users /></span><div><div className="strong">Currently requested by {d.research.requestedBy} research {d.research.requestedBy === 1 ? 'cohort' : 'cohorts'}</div><div className="small"><Link to="/p/opportunities">View details <ChevronRight size={10} /></Link></div></div></div>
      </Card>
    </div>
  );
}

export default function NodeDetailPage() {
  const { slug } = useParams();
  const q = useApi<NodeDetail>(slug ? `/participant/nodes/${slug}` : null);
  const [tab, setTab] = useState<Tab>('overview');
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const hasSeries = d.series.points.length > 0;

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div>
          <div className="breadcrumb"><Link to="/p/signature">Signature</Link>{d.path.slice(0, -1).map((p) => <span key={p}>› {p}</span>)}</div>
          <h1 className="h1">{d.name}</h1>
          <div className="sub">
            {d.summary.spanLabel}{d.summary.nObs > 0 && <> · <Num n={d.summary.nObs} /> measurements</>}{d.unit ? ` · ${d.unit}` : ''}
          </div>
        </div>
        <div className="row gap-6">
          {d.overlay.demand && <Pill variant="demand" icon>Requested by research</Pill>}
          {d.overlay.opportunity && <Pill variant="opportunity" />}
          <StatePill state={d.state} />
        </div>
      </div>
      <Tabs variant="underline" value={tab} onChange={setTab} items={[{ key: 'overview', label: 'Overview' }, { key: 'timeline', label: 'Timeline', count: d.events.length }, { key: 'lineage', label: 'Data Lineage' }, { key: 'research', label: 'Research Use' }]} />

      {tab === 'overview' && (
        <div className="grid grid--main-aside gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
          <div className="col gap-16">
            <Card className="chart-card">
              {hasSeries ? (
                <LazyBPChart series={d.series} title={d.name} unit={d.unit} yDomain="auto" />
              ) : (
                <div className="rail__empty">
                  {d.state === 'missing' ? 'No observations yet for this variable.' : `${d.summary.nObs} observations between ${d.summary.firstAt ? fmtDate(d.summary.firstAt) : '—'} and ${d.summary.lastAt ? fmtDate(d.summary.lastAt) : '—'} (no time series view).`}
                </div>
              )}
            </Card>
            <SourceCards d={d} />
            <Card title="Data lineage"><LineageChain steps={d.lineage} /><div className="tiny faint mt-8">{d.rawVsDerived.note}</div></Card>
          </div>
          <div className="col gap-16">
            <Card title="Research use"><ResearchCards d={d} /></Card>
            <Card title="Summary" soft>
              <div className="kv-grid">
                <div><span className="k">State</span><span className="v" style={{ textTransform: 'capitalize' }}>{d.state}</span></div>
                <div><span className="k">Provenance</span><span className="v">{d.summary.provenanceClass ? PROVENANCE_LABEL[d.summary.provenanceClass] : '—'}</span></div>
                <div><span className="k">First</span><span className="v">{d.summary.firstAt ? fmtDate(d.summary.firstAt) : '—'}</span></div>
                <div><span className="k">Latest</span><span className="v">{d.summary.lastAt ? fmtDate(d.summary.lastAt) : '—'}</span></div>
                <div><span className="k">Span</span><span className="v">{d.summary.spanDays} days</span></div>
                <div><span className="k">Raw / derived</span><span className="v"><Num n={d.rawVsDerived.rawCount} /> / <Num n={d.rawVsDerived.derivedCount} /></span></div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <Card title={`${d.name} on your timeline`} sub="Events linked to this variable.">
          <TimelineRail events={d.events} />
        </Card>
      )}

      {tab === 'lineage' && (
        <div className="col gap-16">
          <Card title="Data lineage" sub="How each value travels from the source to the standardized observation and derived summaries.">
            <LineageChain steps={d.lineage} />
          </Card>
          <div className="grid grid--3">
            <Card soft tight><div className="tiny faint" style={{ fontWeight: 600 }}>Raw records</div><div className="big-num"><Num n={d.rawVsDerived.rawCount} /></div></Card>
            <Card soft tight><div className="tiny faint" style={{ fontWeight: 600 }}>Derived rows</div><div className="big-num"><Num n={d.rawVsDerived.derivedCount} /></div></Card>
            <Card soft tight><div className="tiny faint" style={{ fontWeight: 600 }}>Source artifacts retained</div><div className="big-num"><Num n={d.rawVsDerived.artifactCount} /></div></Card>
          </div>
          <div className="note">{d.rawVsDerived.note} Raw files stay with you; studies receive standardized observations within their licensed scope.</div>
        </div>
      )}

      {tab === 'research' && (
        <div className="col gap-16">
          <ResearchCards d={d} />
          <Card title="License lines for this variable" sub="Each line is the share of a license fee attributed to this variable.">
            {d.research.lines.length === 0 ? <div className="rail__empty">Not licensed yet.</div> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>License</th><th>Study</th><th>Organisation</th><th>Date</th><th className="num">You received</th></tr></thead>
                  <tbody>
                    {d.research.lines.map((l) => (
                      <tr key={l.licenseNumber + l.date}><td className="strong">{l.licenseNumber}</td><td>{l.studyName}</td><td className="muted">{l.orgName}</td><td className="muted num">{fmtDate(l.date)}</td><td className="num strong">{money(l.cents)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={4}>Total</td><td className="num">{money(d.research.earningsCents)}</td></tr></tfoot>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
