// B8 Dataset Access: variables table + six tabs, Analyze in workspace, Request approved export, Request additional variable.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, FlaskConical, PlusCircle, RefreshCw } from 'lucide-react';
import type { Dataset, DatasetTab } from '@shared/api-types';
import { PROVENANCE_LABEL } from '@shared/provenance';
import { dateLong } from '@shared/fmt';
import { api } from '../api';
import { useApi } from '../hooks';
import { useAction } from '../useAction';
import { Card, Tabs, Pill, ErrorBox, KNum, kfloor, ConceptTree, BarRow } from '../components';

const TABS: { key: DatasetTab; label: string }[] = [
  { key: 'variables', label: 'Variables' }, { key: 'documentation', label: 'Documentation' }, { key: 'provenance', label: 'Provenance' },
  { key: 'missingness', label: 'Missingness' }, { key: 'longitudinal', label: 'Longitudinal' }, { key: 'ontology', label: 'Ontology' },
];
const TYPE_VARIANT: Record<Dataset['variables'][number]['type'], 'neutral' | 'accent' | 'purple' | 'dark'> = { Structured: 'neutral', 'Time series': 'accent', 'File/variants': 'purple', DICOM: 'dark' };

export default function DatasetPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<DatasetTab>('variables');
  const q = useApi<Dataset>(id ? `/buyer/datasets/${id}?tab=${tab}` : null);
  const exportReq = useAction(async () => api.post(`/buyer/datasets/${id}/export-request`, { variables: q.data?.variables.map((v) => v.slug) ?? [] }), { success: 'Export request submitted for approval' });
  const refresh = useAction(async () => api.post(`/buyer/datasets/${id}/refresh`), { success: 'Dataset refreshed' });
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  if (!d) return <div className="faint small">Loading…</div>;
  // useApi keeps the previous payload while refetching; a tab-specific section of another tab's payload is empty, so
  // render a loading row until the response for THIS tab arrives (the server echoes `tab`).
  const stale = q.loading && d.tab !== undefined && d.tab !== tab;
  const loadingRow = <div className="faint small">Loading…</div>;

  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div>
          <div className="breadcrumb"><Link to="/b/datasets">Datasets</Link><span>›</span><Link to={`/b/studies/${d.studyId}`}>{d.studyName}</Link></div>
          <h1 className="h1 row gap-8">Cohort dataset <Pill variant={d.status === 'current' ? 'verified' : 'outline'} sm>v{d.version} · {d.status}</Pill></h1>
          <div className="sub">Access your approved dataset in a secure environment. Built {dateLong(d.builtAt)} · <KNum n={d.memberCount} /> members · row-level <KNum n={d.rowLevelN} /> · summary-only <KNum n={d.summaryOnlyN} /></div>
        </div>
        <div className="row gap-6">
          <button className="btn" disabled={refresh.busy} onClick={() => refresh.run()}><RefreshCw /> Refresh</button>
          <Link className="btn btn--primary" to={`/b/datasets/${d.id}/workspace`}><FlaskConical /> Analyze in workspace</Link>
          <button className="btn" disabled={exportReq.busy} onClick={() => exportReq.run()}><Download /> Request approved export</button>
        </div>
      </div>
      <Tabs variant="underline" value={tab} onChange={setTab} items={TABS} />
      <div className="grid gap-16" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
        <Card>
          {stale && loadingRow}
          {!stale && tab === 'variables' && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Variable</th><th>Type</th><th className="num">Members with data</th><th className="num">Missingness</th></tr></thead>
                <tbody>
                  {d.variables.map((v) => (
                    <tr key={v.slug}><td className="strong">{v.label}</td><td><Pill variant={TYPE_VARIANT[v.type]} sm>{v.type}</Pill></td><td className="num">{kfloor(v.n)}</td><td className="num">{Math.round(v.missingPct)}%</td></tr>
                  ))}
                  {d.variables.length === 0 && <tr><td colSpan={4} className="faint center">No variables.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {!stale && tab === 'documentation' && (
            <div className="col gap-12">
              {d.documentation.map((s) => <div key={s.title}><div className="h3">{s.title}</div><div className="why mt-8" style={{ whiteSpace: 'pre-line' }}>{s.body}</div></div>)}
              {d.documentation.length === 0 && <div className="rail__empty">No documentation.</div>}
            </div>
          )}
          {!stale && tab === 'provenance' && (
            <div className="col gap-12">
              {d.provenance.map((v) => (
                <div key={v.slug}>
                  <div className="h3 mb-8">{v.label}</div>
                  <div className="col gap-6">{v.classes.map((c) => <BarRow key={c.cls} label={PROVENANCE_LABEL[c.cls]} value={c.pct} labelWidth={150} tone={c.cls === 'self_report' ? 'amber' : 'green'} />)}</div>
                </div>
              ))}
              {d.provenance.length === 0 && <div className="rail__empty">No provenance breakdown.</div>}
            </div>
          )}
          {!stale && tab === 'missingness' && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Variable</th><th className="num">Missing overall</th>{d.missingness[0]?.byGroup.map((g) => <th key={g.label} className="num">{g.label}</th>)}</tr></thead>
                <tbody>{d.missingness.map((v) => <tr key={v.slug}><td className="strong">{v.label}</td><td className="num">{Math.round(v.missingPct)}%</td>{v.byGroup.map((g) => <td key={g.label} className="num">{Math.round(g.missingPct)}%</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {!stale && tab === 'longitudinal' && (
            <div className="col gap-12">
              {d.longitudinal.map((v) => {
                const max = Math.max(1, ...v.buckets.map((b) => b.n));
                return <div key={v.slug}><div className="h3 mb-8">{v.label}</div><div className="col gap-6">{v.buckets.map((b) => <BarRow key={b.label} label={b.label} value={(b.n / max) * 100} display={kfloor(b.n)} labelWidth={110} />)}</div></div>;
              })}
              {d.longitudinal.length === 0 && <div className="rail__empty">No longitudinal summary.</div>}
            </div>
          )}
          {!stale && tab === 'ontology' && (d.ontology.length ? <ConceptTree domains={d.ontology} showLegend={false} /> : <div className="rail__empty">No ontology slice.</div>)}
        </Card>
        <div className="col gap-16">
          <Card title="About this dataset" soft><div className="why"><p>{d.description}</p></div></Card>
          <Card title="Need another variable?">
            <div className="small muted mb-8">Request a variable the members do not hold yet. The platform runs a child campaign over members and matching participants; the dataset gains the row when they complete.</div>
            <Link className="btn btn--primary btn--block" to={`/b/studies/${d.studyId}/request-variable`}><PlusCircle /> Request additional variable</Link>
          </Card>
          <Card title="Export requests" soft>
            <div className="list">
              {d.exportRequests.map((e) => <div className="list__item" key={e.id}><span className="list__text">{e.variables.length} variables · {dateLong(e.createdAt)}</span><Pill variant={e.status === 'approved' ? 'verified' : 'neutral'} sm>{e.status}</Pill></div>)}
              {d.exportRequests.length === 0 && <div className="rail__empty">None yet.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
