import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
export const GRAPH_PATH = process.env.GRAPH_DB ?? path.join(DATA_DIR, 'graph.sqlite');
export const VAULT_PATH = process.env.VAULT_DB ?? path.join(DATA_DIR, 'vault.sqlite');
