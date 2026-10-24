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
    // The API's catch-all 404 says exactly 'not found' (no code); a missing record says '<thing> not found' with code not_found.
    const unserved = error.status === 404 && error.message.trim().toLowerCase() === 'not found' && error.code !== 'not_found';
    const what = error.status === 404 ? (unserved ? 'Not available' : 'Not found') : error.status === 403 ? 'Refused' : error.status === 503 ? 'Not ready' : `HTTP ${error.status}`;
    return (
      <div className="error-box">
        <strong>{what}</strong> — {error.message}
        {error.url && <span className="faint" style={{ wordBreak: 'break-all' }}> · /api{error.url}</span>}
        {unserved && <div className="tiny mt-8">This endpoint is not served by the API yet; the page renders its empty state until it is.</div>}
        {error.status === 404 && !unserved && <div className="tiny mt-8">No record with this id. It may have been removed by a demo reset — go back and pick one from the list.</div>}
      </div>
    );
  }
  return <div className="error-box">{typeof error === 'string' ? error : error.message}</div>;
}
