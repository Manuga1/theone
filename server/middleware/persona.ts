import type { Request, Response, NextFunction } from 'express';
import { PERSONA_HEADER, type Persona } from '@shared/api-types';

export type PersonaInfo = { kind: 'participant' } | { kind: 'buyer'; orgId: number };

declare module 'express-serve-static-core' {
  interface Request {
    persona: PersonaInfo;
  }
}

export function parsePersona(raw: string | undefined): PersonaInfo {
  const v = (raw ?? 'participant') as Persona;
  if (v.startsWith('buyer:')) {
    const id = Number(v.slice('buyer:'.length));
    return { kind: 'buyer', orgId: Number.isFinite(id) && id > 0 ? id : 1 };
  }
  return { kind: 'participant' };
}

export function persona(req: Request, _res: Response, next: NextFunction): void {
  req.persona = parsePersona(req.header(PERSONA_HEADER));
  next();
}
