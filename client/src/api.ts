// Fetch wrapper: adds the demo persona header, parses JSON errors, and broadcasts a `changed` signal after mutations
// so mounted hooks refetch. Persona is kept in localStorage so a reload stays on the same side.
import { PERSONA_HEADER, type Persona, type ApiError } from '@shared/api-types';

const PERSONA_KEY = 'hda.persona';
const listeners = new Set<() => void>();
const personaListeners = new Set<(p: Persona) => void>();

export function getPersona(): Persona {
  try {
    return (localStorage.getItem(PERSONA_KEY) as Persona) || 'participant';
  } catch {
    return 'participant';
  }
}
export function setPersona(p: Persona): void {
  try {
    localStorage.setItem(PERSONA_KEY, p);
  } catch {
    /* ignore */
  }
  personaListeners.forEach((l) => l(p));
  emitChanged();
}
export function onPersonaChange(l: (p: Persona) => void): () => void {
  personaListeners.add(l);
  return () => personaListeners.delete(l);
}
export function onChanged(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function emitChanged(): void {
  listeners.forEach((l) => l());
}

export class ApiRequestError extends Error {
  constructor(public status: number, message: string, public code?: string, public url?: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', [PERSONA_HEADER]: getPersona() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (data ?? {}) as ApiError;
    throw new ApiRequestError(res.status, e.error ?? res.statusText, e.code, url);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  /** POST that only reads (preview / estimate): no `changed` broadcast, so live previews never trigger page-wide refetches. */
  query: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  post: async <T>(url: string, body?: unknown) => {
    const r = await request<T>('POST', url, body ?? {});
    emitChanged();
    return r;
  },
  put: async <T>(url: string, body?: unknown) => {
    const r = await request<T>('PUT', url, body ?? {});
    emitChanged();
    return r;
  },
  del: async <T>(url: string) => {
    const r = await request<T>('DELETE', url);
    emitChanged();
    return r;
  },
};
