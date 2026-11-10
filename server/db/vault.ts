// The identity vault: legal name, email, phone, dob (the `identity` table). Imported ONLY by routes/participant.ts and the
// seed — a unit test asserts no buyer-side module imports this file. It lives in the same Postgres database as the graph;
// the separation is enforced at the API layer (buyer responses pass the identity guard and never touch this module).
import type { Db } from './driver';
import { graph } from './graph';

let override: Db | null = null;

export function vault(): Db {
  return override ?? graph();
}
export function useVault(db: Db | null): void {
  override = db;
}
