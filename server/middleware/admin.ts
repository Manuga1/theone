// Guard for the destructive demo endpoints (POST /api/demo/reset, POST /api/buyer/studies/:id/advance).
// Locally (not hosted) they work without a token. On a hosted deployment the request must carry the header
// ADMIN_HEADER equal to process.env.DEMO_ADMIN_TOKEN; when that variable is unset every request is refused.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { ADMIN_HEADER } from '@shared/brand';
import { isHosted } from '../db/paths';
import { HttpError } from '../errors';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

/** null when the request may proceed, else the refusal message. */
export function adminRefusal(presented: string | undefined): string | null {
  if (!isHosted()) return null;
  const expected = process.env.DEMO_ADMIN_TOKEN;
  if (!expected) return 'This action is switched off on the hosted demo: no admin token is configured on the server.';
  if (!presented) return `This action needs the admin token on the hosted demo (header ${ADMIN_HEADER}).`;
  // compare digests: constant time, and no length leak
  return timingSafeEqual(digest(presented), digest(expected)) ? null : 'The admin token is not valid.';
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const refusal = adminRefusal(req.header(ADMIN_HEADER));
  next(refusal ? new HttpError(403, refusal, 'admin_required') : undefined);
}
