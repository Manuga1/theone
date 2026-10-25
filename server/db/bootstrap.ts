// On a read-only host the seeded databases are shipped with the bundle; copy them to the writable data dir on first open.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { SEED_DATA_DIR } from './paths';

export function ensureWritableCopy(targetPath: string): void {
  if (!SEED_DATA_DIR || existsSync(targetPath)) return;
  const plain = path.join(SEED_DATA_DIR, path.basename(targetPath));
  const gz = `${plain}.gz`;
  if (!existsSync(plain) && !existsSync(gz)) return; // schema-only deployments start empty
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.copying`;
  if (existsSync(gz)) writeFileSync(tmp, gunzipSync(readFileSync(gz)));
  else copyFileSync(plain, tmp);
  // rename is atomic, so a concurrent opener never sees a half-copied file
  renameSync(tmp, targetPath);
}
