import { createHash } from 'node:crypto';
import type { CohortCriteria } from '@shared/criteria';

/** Stable hash of a criteria object (keys sorted) — used for saved cohorts and the preview cache. */
export function criteriaHash(criteria: CohortCriteria, extra: unknown = null): string {
  return createHash('sha256').update(stableStringify({ criteria, extra })).digest('hex').slice(0, 24);
}
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
