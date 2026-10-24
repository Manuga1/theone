import type { Db } from '../db/driver';
import type { Rng } from '@shared/rng';

export type SeedCtx = {
  graph: Db;
  vault: Db;
  rng: Rng;
  scale: number;
  /** concept slug → id */
  concepts: Map<string, number>;
  log: (msg: string) => void;
  /** Filled by seedAlex */
  alexId: number;
  /** Filled by seedAlex: study / campaign ids the marketplace stage builds on */
  studies: Record<string, number>;
  campaigns: Record<string, number>;
  orgs: Record<string, number>;
};

export function concept(ctx: SeedCtx, slug: string): number {
  const id = ctx.concepts.get(slug);
  if (!id) throw new Error(`unknown concept slug: ${slug}`);
  return id;
}

/** Exactly k ones among n positions, deterministic. */
export function pickExactly(rng: Rng, n: number, k: number): Uint8Array {
  const out = new Uint8Array(n);
  if (k <= 0) return out;
  if (k >= n) { out.fill(1); return out; }
  // partial Fisher–Yates over an index array
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng.next() * (n - i));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
    out[idx[i]] = 1;
  }
  return out;
}
/** Exactly k ones among the positions listed in `candidates`. */
export function pickExactlyAmong(rng: Rng, n: number, candidates: number[], k: number): Uint8Array {
  const out = new Uint8Array(n);
  const chosen = pickExactly(rng, candidates.length, Math.min(k, candidates.length));
  for (let i = 0; i < candidates.length; i++) if (chosen[i]) out[candidates[i]] = 1;
  return out;
}
