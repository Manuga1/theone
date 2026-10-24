// Tiny toast bus: any module can push a toast; the Shell renders <Toasts/>. Errors from mutations land here.
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { ApiRequestError } from './api';

export type Toast = { id: number; kind: 'error' | 'success' | 'info'; text: string };
const listeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
let nextId = 1;

function emit() {
  listeners.forEach((l) => l(toasts));
}
export function pushToast(kind: Toast['kind'], text: string, ttlMs = kind === 'error' ? 7000 : 3500): void {
  const t: Toast = { id: nextId++, kind, text };
  toasts = [...toasts, t].slice(-4);
  emit();
  setTimeout(() => dismissToast(t.id), ttlMs);
}
export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
export function toastError(e: unknown, prefix?: string): void {
  let msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ApiRequestError) {
    const what = e.status === 404 ? 'Not available yet' : e.status === 403 ? 'Refused' : e.status === 409 ? 'Not allowed in this state' : `HTTP ${e.status}`;
    msg = `${what} (${e.status}) — ${e.message}${e.url ? ` · /api${e.url}` : ''}`;
  }
  pushToast('error', prefix ? `${prefix}: ${msg}` : msg);
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          {t.kind === 'error' ? <AlertTriangle /> : t.kind === 'success' ? <CheckCircle2 /> : <Info />}
          <span className="toast__text">{t.text}</span>
          <button className="toast__close" onClick={() => dismissToast(t.id)} aria-label="Dismiss"><X /></button>
        </div>
      ))}
    </div>
  );
}
