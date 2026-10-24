// Deletes every generated database file. All synthetic data lives in ./data and nowhere else.
import { readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data');
let n = 0;
for (const f of readdirSync(dir)) {
  if (f === '.gitkeep') continue;
  rmSync(path.join(dir, f), { force: true });
  n++;
}
console.log(`[data:wipe] removed ${n} file(s) from data/. Run \`npm run seed\` to regenerate.`);
