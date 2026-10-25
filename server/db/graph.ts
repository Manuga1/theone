// The health graph database: pseudonymous participants, ontology, observations, consent, licenses, ledger, marketplace.
// Contains NO direct identifiers. Buyer routes may import this module only.
import { Db } from './driver';
import { GRAPH_PATH } from './paths';
import { ensureWritableCopy } from './bootstrap';

let instance: Db | null = null;

export function graph(): Db {
  if (!instance) {
    ensureWritableCopy(GRAPH_PATH);
    instance = new Db(GRAPH_PATH);
  }
  return instance;
}
/** Tests and the seed inject their own handle. */
export function useGraph(db: Db | null): void {
  instance = db;
}
