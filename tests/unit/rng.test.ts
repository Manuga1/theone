import { describe, expect, it } from 'vitest';
import { Rng, DEFAULT_SEED } from '../../shared/rng';

describe('rng determinism', () => {
  it('same seed → same stream', () => {
    const a = new Rng('seed-1');
    const b = new Rng('seed-1');
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
  });
  it('fork(purpose) is independent of consumption order and of the parent', () => {
    const p1 = new Rng(DEFAULT_SEED);
    p1.next(); p1.next();
    const p2 = new Rng(DEFAULT_SEED);
    expect(p1.fork('alex').next()).toBe(p2.fork('alex').next());
    expect(p2.fork('alex').next()).not.toBe(p2.fork('population').next());
  });
  it('helpers stay in range and sampleIndices is a k-subset', () => {
    const r = new Rng('x');
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      const f = r.float(-1, 1);
      expect(Math.abs(f)).toBeLessThanOrEqual(1);
    }
    const idx = r.sampleIndices(100, 10);
    expect(new Set(idx).size).toBe(10);
    expect(Math.max(...idx)).toBeLessThan(100);
    expect(r.pick(['a'])).toBe('a');
  });
  it('normal() has roughly the requested mean', () => {
    const r = new Rng('n');
    let s = 0;
    for (let i = 0; i < 4000; i++) s += r.normal(10, 2);
    expect(Math.abs(s / 4000 - 10)).toBeLessThan(0.2);
  });
});
