// Minimal typed page stub: fetch an endpoint via useApi and render the JSON. The screens stage replaces each use.
import { useApi } from '../hooks';
import { ErrorBox } from './EmptyState';

export function JsonStub<T>({ url, title, note }: { url: string | null; title: string; note?: string }) {
  const q = useApi<T>(url);
  return (
    <div>
      <div className="page-head">
        <h1 className="h1">{title}</h1>
        <div className="sub">{note ?? `Stub — GET /api${url ?? ''}`}</div>
      </div>
      {q.error && <ErrorBox error={q.error} />}
      {q.loading && !q.data && <div className="faint small">Loading…</div>}
      {q.data && <pre className="pre">{JSON.stringify(q.data, null, 2)}</pre>}
    </div>
  );
}
