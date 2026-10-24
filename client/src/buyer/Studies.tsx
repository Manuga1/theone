// My Studies: list with status and counters.
import { Link } from 'react-router-dom';
import type { StudySummary } from '@shared/api-types';
import { useApi } from '../hooks';
import { Card, Pill, ErrorBox, kfloor } from '../components';

export function studyStatusPill(s: StudySummary['status']) {
  return <Pill variant={s === 'active' ? 'verified' : s === 'completed' ? 'accent' : s === 'closed' ? 'outline' : 'neutral'} sm>{s}</Pill>;
}

export default function StudiesPage() {
  const q = useApi<{ studies: StudySummary[] } | StudySummary[]>('/buyer/studies');
  const studies = Array.isArray(q.data) ? q.data : q.data?.studies ?? [];
  return (
    <div className="col gap-16">
      <div className="page-head--row" style={{ marginBottom: 0 }}>
        <div><h1 className="h1">My Studies</h1><div className="sub">Studies created from your cohorts. Counters are grouped by opportunity status and k-floored.</div></div>
        <Link className="btn btn--primary" to="/b/cohorts/new">New cohort</Link>
      </div>
      {q.error && <ErrorBox error={q.error} />}
      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Study</th><th>Status</th><th>Purpose</th><th className="num">Target</th><th className="num">Invited</th><th className="num">Accepted</th><th className="num">Completed</th><th className="num">Quality</th><th>Dataset</th></tr></thead>
            <tbody>
              {studies.map((s) => (
                <tr key={s.id}>
                  <td><Link to={`/b/studies/${s.id}`} className="strong">{s.name}</Link></td>
                  <td>{studyStatusPill(s.status)}</td>
                  <td className="muted" style={{ maxWidth: 260 }}>{s.purpose}</td>
                  <td className="num">{kfloor(s.targetN)}</td>
                  <td className="num">{kfloor(s.counters.invited)}</td>
                  <td className="num">{kfloor(s.counters.accepted)}</td>
                  <td className="num">{kfloor(s.counters.completed)}</td>
                  <td className="num">{kfloor(s.counters.qualityAccepted)}</td>
                  <td>{s.datasetId ? <Link to={`/b/datasets/${s.datasetId}`}>Open dataset</Link> : <span className="faint">—</span>}</td>
                </tr>
              ))}
              {!q.loading && studies.length === 0 && <tr><td colSpan={9} className="faint center">No studies yet{q.error ? ' (endpoint unavailable)' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
