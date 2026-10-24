import type { ReactNode } from 'react';
import { Database } from 'lucide-react';
import { ApiRequestError } from '../api';

export function EmptyState({ title = 'No participant data', body, icon, action }: { title?: ReactNode; body?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon ?? <Database />}</div>
      <div className="empty__title">{title}</div>
      <div className="empty__body">{body ?? <>No synthetic data has been generated. Run <code>npm run seed</code> to populate the demo databases.</>}</div>
      {action}
    </div>
  );
}

export function ErrorBox({ error }: { error: Error | string }) {
  if (error instanceof ApiRequestError) {
    const what = error.status === 404 ? 'Not available' : error.status === 403 ? 'Refused' : error.status === 503 ? 'Not ready' : `HTTP ${error.status}`;
    return (
      <div className="error-box">
        <strong>{what}</strong> — {error.message}
        {error.url && <span className="faint" style={{ wordBreak: 'break-all' }}> · /api{error.url}</span>}
        {error.status === 404 && <div className="tiny mt-8">This endpoint is not served by the API yet; the page renders its empty state until it is.</div>}
      </div>
    );
  }
  return <div className="error-box">{typeof error === 'string' ? error : error.message}</div>;
}
