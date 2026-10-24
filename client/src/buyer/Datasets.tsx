// Licensed datasets: built versions per study.
import { Link } from 'react-router-dom';
import type { DatasetSummary } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, Pill, ErrorBox, kfloor } from '../components';
import { dateLong } from '@shared/fmt';

export default function DatasetsPage() {
  const q = useApi<{ datasets: DatasetSummary[] } | DatasetSummary[]>('/buyer/datasets');
  const datasets = Array.isArray(q.data) ? q.data : q.data?.datasets ?? [];
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">Licensed Datasets</h1><div className="sub">Each version is a snapshot of licensed members; members are never removed during their license term.</div></div>
      </div>
      {q.error && <ErrorBox error={q.error} />}
      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Dataset</th><th>Study</th><th className="num">Version</th><th>Built</th><th className="num">Members</th><th>Status</th></tr></thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id}>
                  <td><Link className="strong" to={`/b/datasets/${d.id}`}>{d.studyName} dataset</Link></td>
                  <td><Link to={`/b/studies/${d.studyId}`}>{d.studyName}</Link></td>
                  <td className="num">v{d.version}</td>
                  <td className="muted">{dateLong(d.builtAt)}</td>
                  <td className="num">{kfloor(d.memberCount)}</td>
                  <td><Pill variant={d.status === 'current' ? 'verified' : 'outline'} sm>{d.status}</Pill></td>
                </tr>
              ))}
              {!q.loading && datasets.length === 0 && <tr><td colSpan={6} className="faint center">No datasets yet{q.error ? ' (endpoint unavailable)' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
