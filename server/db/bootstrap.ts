// On a read-only host the seeded databases are shipped with the bundle; copy them to the writable data dir on first open.
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { SEED_DATA_DIR } from './paths';

export function ensureWritableCopy(targetPath: string): void {
  if (!SEED_DATA_DIR || existsSync(targetPath)) return;
  const source = path.join(SEED_DATA_DIR, path.basename(targetPath));
  if (!existsSync(source)) return; // schema-only deployments start empty
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.copying`;
  copyFileSync(source, tmp);
  // rename is atomic, so a concurrent opener never sees a half-copied file
  renameSync(tmp, targetPath);
}
