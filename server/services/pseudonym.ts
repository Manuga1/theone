// Buyers never see the global pseudonym. A study or dataset only ever sees sha256(pseudonym ‖ salt), so two studies
// cannot join their member lists, and a dataset version cannot be joined back to the study roster.
import { createHash } from 'node:crypto';

export function scopedPseudonym(pseudonym: string, salt: string, prefix = 'S'): string {
  return `${prefix}-${createHash('sha256').update(`${pseudonym}‖${salt}`).digest('hex').slice(0, 12)}`;
}

/** Deterministic salt for a new study / dataset (no wall clock, no Math.random). */
export function makeSalt(kind: string, id: number, extra = ''): string {
  return createHash('sha256').update(`${kind}:${id}:${extra}`).digest('hex').slice(0, 16);
}
