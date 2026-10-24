// Buyer responses must never carry identity or quasi-identifier keys. Applied to every /api/buyer route.
import type { Request, Response, NextFunction } from 'express';

export const FORBIDDEN_KEYS = ['legal_name', 'legalName', 'email', 'phone', 'dob', 'identity_id', 'identityId', 'birth_year', 'birthYear', 'region', 'pseudonym', 'address'];

export function findForbiddenKey(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findForbiddenKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.includes(k)) return `${path}.${k}`;
      const hit = findForbiddenKey(v, `${path}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function noIdentity(_req: Request, res: Response, next: NextFunction): void {
  const original = res.json.bind(res);
  res.json = ((body: unknown) => {
    const hit = findForbiddenKey(body);
    if (hit) {
      res.status(500);
      return original({ error: `identity guard: forbidden key in buyer response at ${hit}`, code: 'identity_guard' });
    }
    return original(body);
  }) as Response['json'];
  next();
}
