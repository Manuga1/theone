// P3 Data Node Detail: header + Verified pill + tabs (Overview / Timeline / History / Data Lineage / Research Use).
// The overview renderer follows the leaf's valueKind: continuous/float → chart, boolean → strip, text → log,
// one_time → fact card (+ History tab with versions), categorical → variant breakdown; file/photo → artifact summary.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Database, ShieldCheck, FlaskConical, Users, ChevronRight, GitBranch } from 'lucide-react';
import type { NodeDetail, ValueKind } from '@shared/api-types';
import { PROVENANCE_LABEL } from '@shared/provenance';
import { useApi } from '../hooks';
import {
  Card, Tabs, StatePill, Pill, LazyBPChart, LineageChain, TimelineRail, ErrorBox, Money, Num, money,
  ValueKindGlyph, VALUE_KIND_LABEL, BooleanStrip, TextLog, FactCard, HistoryTable, VariantBreakdown, ClassifiedLine,
} from '../components';
import { dateLong as fmtDate } from '@shared/fmt';

type Tab = 'overview' | 'timeline' | 'history' | 'lineage' | 'research';

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

/** Which renderer the overview uses. Unknown valueKind (older API) → the series chart when there is one. */
function rendererFor(d: NodeDetail): ValueKind | 'series' {
  const k = d.valueKind;
  if (!k) return 'series';
  if (k === 'continuous' || k === 'float') return 'series';
  return k;
}

function MainView({ d }: { d: NodeDetail }) {
  const mode = rendererFor(d);
  const hasSeries = d.series.points.length > 0;
  const empty = (
    <div className="rail__empty">
      {d.state === 'missing' ? 'No observations yet for this variable.' : `${d.summary.nObs} observations between ${d.summary.firstAt ? fmtDate(d.summary.firstAt) : '—'} and ${d.summary.lastAt ? fmtDate(d.summary.lastAt) : '—'} (no time series view).`}
    </div>
  );
  if (mode === 'series') return hasSeries ? <LazyBPChart series={d.series} title={d.name} unit={d.unit} yDomain="auto" /> : empty;
  if (mode === 'boolean') return <><div className="card__title mb-8">Daily yes / no</div>{d.booleanStrip && d.booleanStrip.length > 0 ? <BooleanStrip cells={d.booleanStrip} /> : empty}</>;
  if (mode === 'text') return <><div className="card__title mb-8">Notes, newest first</div>{d.textLog && d.textLog.length > 0 ? <TextLog items={d.textLog} /> : empty}</>;
  if (mode === 'one_time') return <><div className="card__title mb-8">Current value</div><FactCard history={d.history ?? []} unit={d.unit} /><div className="tiny faint mt-8">Updates append a new version and close the previous one; the History tab lists every version.</div></>;
  if (mode === 'categorical') {
    const total = (d.variants ?? []).reduce((a, v) => a + v.nObs, 0);
    return (
      <>
        <div className="card__title mb-8 row gap-6"><GitBranch style={{ width: 13, height: 13, color: 'var(--text-3)' }} /> Sub-branches</div>
        <VariantBreakdown variants={d.variants ?? []} total={total} />
        {d.textLog && d.textLog.length > 0 && <><div className="card__title mt-16 mb-8">Recent entries</div><TextLog items={d.textLog.slice(0, 8)} /></>}
        {hasSeries && <div className="mt-16"><LazyBPChart series={d.series} title={d.name} unit={d.unit} yDomain="auto" /></div>}
      </>
    );
  }
  // file / photo: artifacts summary (files themselves stay on the device)
  return (
    <>
      <div className="card__title mb-8">{mode === 'photo' ? 'Photos' : 'Files'}</div>
      <div className="grid grid--3">
        <Card soft tight><div className="tiny faint" style={{ fontWeight: 600 }}>Artifacts</div><div className="big-num"><Num n={d.rawVsDerived.artifactCount} /></div></Card>
        <Card soft tight><div className="tiny faint" style={{ fontWeight: 600 }}>Derived observations</div><div className="big-num"><Num n={d.rawVsDerived.derivedCount} /></div></Card>
        <Card soft tight><div className="tiny faint" style={{ fontWeight: 600 }}>Latest</div><div className="strong">{d.summary.lastAt ? fmtDate(d.summary.lastAt) : '—'}</div></Card>
      </div>
      {d.textLog && d.textLog.length > 0 && <div className="mt-12"><TextLog items={d.textLog} /></div>}
      {hasSeries && <div className="mt-16"><LazyBPChart series={d.series} title={d.name} unit={d.unit} yDomain="auto" /></div>}
    </>
  );
}

export default function NodeDetailPage() {
  const { slug } = useParams();
  const q = useApi<NodeDetail>(slug ? `/participant/nodes/${slug}` : null);
  const [tab, setTab] = useState<Tab>('overview');
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  const history = d.history ?? [];
  const showHistory = d.valueKind === 'one_time' || history.length > 1;
  const variantCount = d.variants?.length ?? 0;

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div>
          <div className="breadcrumb"><Link to="/p/signature">Signature</Link>{d.path.slice(0, -1).map((p) => <span key={p}>› {p}</span>)}</div>
          <h1 className="h1 row gap-8">{d.valueKind && <ValueKindGlyph kind={d.valueKind} />}{d.name}</h1>
          <div className="sub">
            {d.valueKind && <>{VALUE_KIND_LABEL[d.valueKind]} · </>}
            {d.summary.spanLabel}{d.summary.nObs > 0 && <> · <Num n={d.summary.nObs} /> {d.valueKind === 'text' ? 'entries' : d.valueKind === 'one_time' ? 'versions' : 'measurements'}</>}{d.unit ? ` · ${d.unit}` : ''}
            {d.lastLoggedRelative && <> · last logged {d.lastLoggedRelative}</>}
            {variantCount > 0 && <> · {variantCount} sub-branch{variantCount === 1 ? '' : 'es'}</>}
          </div>
          <ClassifiedLine classified={d.classified} />
        </div>
        <div className="row gap-6">
          {d.overlay.demand && <Pill variant="demand" icon>Requested by research</Pill>}
          {d.overlay.opportunity && <Pill variant="opportunity" />}
          <StatePill state={d.state} />
        </div>
      </div>
      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'timeline', label: 'Timeline', count: d.events.length },
          ...(showHistory ? [{ key: 'history' as const, label: 'History', count: history.length }] : []),
          { key: 'lineage', label: 'Data Lineage' },
          { key: 'research', label: 'Research Use' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid grid--main-aside-360 gap-16">
          <div className="col gap-16">
            <Card className="chart-card"><MainView d={d} /></Card>
            <SourceCards d={d} />
            <Card title="Data lineage"><LineageChain steps={d.lineage} /><div className="tiny faint mt-8">{d.rawVsDerived.note}</div></Card>
          </div>
          <div className="col gap-16">
            <Card title="Research use"><ResearchCards d={d} /></Card>
            <Card title="Summary" soft>
              <div className="kv-grid">
                <div><span className="k">State</span><span className="v" style={{ textTransform: 'capitalize' }}>{d.state}</span></div>
                {d.valueKind && <div><span className="k">Data type</span><span className="v">{VALUE_KIND_LABEL[d.valueKind]}</span></div>}
                <div><span className="k">Provenance</span><span className="v">{d.summary.provenanceClass ? PROVENANCE_LABEL[d.summary.provenanceClass] : '—'}</span></div>
                <div><span className="k">First</span><span className="v">{d.summary.firstAt ? fmtDate(d.summary.firstAt) : '—'}</span></div>
                <div><span className="k">Latest</span><span className="v">{d.summary.lastAt ? fmtDate(d.summary.lastAt) : '—'}</span></div>
                <div><span className="k">Span</span><span className="v">{d.summary.spanDays} days</span></div>
                <div><span className="k">Raw / derived</span><span className="v"><Num n={d.rawVsDerived.rawCount} /> / <Num n={d.rawVsDerived.derivedCount} /></span></div>
                {d.classified && d.classified.n > 0 && <div><span className="k">Classified</span><span className="v"><Num n={d.classified.n} /> by {d.classified.classifier ?? '—'}{d.classified.meanConfidence !== null ? ` · ${Math.round(d.classified.meanConfidence * 100)}%` : ''}</span></div>}
              </div>
            </Card>
            {variantCount > 0 && d.valueKind !== 'categorical' && (
              <Card title="Sub-branches" sub="Created from your answers to follow-up questions."><VariantBreakdown variants={d.variants ?? []} total={(d.variants ?? []).reduce((a, v) => a + v.nObs, 0)} /></Card>
            )}
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <Card title={`${d.name} on your timeline`} sub="Events linked to this variable.">
          <TimelineRail events={d.events} />
        </Card>
      )}

      {tab === 'history' && (
        <Card title="Versions" sub="Every value ever recorded. A new value closes the previous row's validity; nothing is overwritten.">
          <HistoryTable history={history} unit={d.unit} />
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
