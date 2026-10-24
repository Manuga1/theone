// The identity vault: legal name, email, phone, dob. Imported ONLY by routes/participant.ts and the seed.
// A unit test asserts no buyer-side module imports this file.
import { Db } from './driver';
import { VAULT_PATH } from './paths';

let instance: Db | null = null;

export function vault(): Db {
  if (!instance) instance = new Db(VAULT_PATH);
  return instance;
}
export function useVault(db: Db | null): void {
  instance = db;
}
