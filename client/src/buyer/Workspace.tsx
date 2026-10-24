// Secure analysis workspace: per-variable summary statistics over the dataset (row-level members only).
import { Link, useParams } from 'react-router-dom';
import type { Workspace } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, ErrorBox, KNum, kfloor } from '../components';

const f = (x: number | null) => (x === null ? '—' : Math.abs(x) >= 100 ? Math.round(x).toLocaleString('en-US') : (Math.round(x * 10) / 10).toLocaleString('en-US'));

export default function WorkspacePage() {
  const { id } = useParams();
  const q = useApi<Workspace>(id ? `/buyer/datasets/${id}/workspace` : null);
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data;
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div>
          <div className="breadcrumb"><Link to="/b/datasets">Datasets</Link><span>›</span><Link to={`/b/datasets/${id}`}>Dataset #{id}</Link></div>
          <h1 className="h1">Analysis workspace</h1>
          <div className="sub">Summary statistics computed inside the platform. Raw rows never leave; exports require approval.</div>
        </div>
        {d && <span className="row gap-12 small muted">row-level <strong><KNum n={d.rowLevelN} /></strong> · summary-only <strong><KNum n={d.summaryOnlyN} /></strong></span>}
      </div>
      <Card>
        {!d ? <div className="faint small">Loading…</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Variable</th><th className="num">n</th><th className="num">Mean</th><th className="num">SD</th><th className="num">Min</th><th className="num">Max</th><th>Unit</th></tr></thead>
              <tbody>
                {d.variables.map((v) => <tr key={v.slug}><td className="strong">{v.label}</td><td className="num">{kfloor(v.n)}</td><td className="num">{f(v.mean)}</td><td className="num">{f(v.sd)}</td><td className="num">{f(v.min)}</td><td className="num">{f(v.max)}</td><td className="muted">{v.unit ?? '—'}</td></tr>)}
                {d.variables.length === 0 && <tr><td colSpan={7} className="faint center">No numeric variables.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
