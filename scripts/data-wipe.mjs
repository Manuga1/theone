// Deletes the local database (data/pglite). All local synthetic data lives in ./data and nowhere else.
// A remote database (Supabase) is never touched here: reseed it with `npm run seed` (DATABASE_URL set) or Reset demo.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data');
let n = 0;
if (existsSync(dir)) {
  for (const f of readdirSync(dir)) {
    if (f === '.gitkeep') continue;
    rmSync(path.join(dir, f), { recursive: true, force: true });
    n++;
  }
}
console.log(`[data:wipe] removed ${n} item(s) from data/. Run \`npm run seed\` to regenerate.`);
