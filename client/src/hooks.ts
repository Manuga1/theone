import { useCallback, useEffect, useRef, useState } from 'react';
import { api, onChanged, onPersonaChange, getPersona } from './api';
import type { Persona } from '@shared/api-types';

export type ApiState<T> = { data: T | null; error: Error | null; loading: boolean; reload: () => void };

/** GET `url` on mount, keep previous data while refetching, refetch on any mutation or persona change. */
export function useApi<T>(url: string | null, deps: unknown[] = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!!url);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    api
      .get<T>(url)
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => {
        if (mine !== seq.current) return;
        setError(e);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);

  useEffect(() => onChanged(reload), [reload]);
  return { data, error, loading, reload };
}

export function usePersona(): [Persona, (p: Persona) => void] {
  const [p, setP] = useState<Persona>(getPersona());
  useEffect(() => onPersonaChange(setP), []);
  const set = useCallback((n: Persona) => {
    import('./api').then((m) => m.setPersona(n));
  }, []);
  return [p, set];
}
