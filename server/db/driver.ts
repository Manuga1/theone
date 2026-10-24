// Thin wrapper over the built-in node:sqlite DatabaseSync. Only these methods are used anywhere,
// so swapping to better-sqlite3 later is a one-file change. Transactions are hand-rolled with
// SAVEPOINT nesting (DatabaseSync has no transaction helper).
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';

export type Row = Record<string, unknown>;
export type Param = SQLInputValue;

export class Db {
  private readonly raw: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();
  private depth = 0;
  /** Incremented on every committed write transaction; caches key on it. */
  writeVersion = 0;

  constructor(public readonly path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA foreign_keys = ON');
    if (path !== ':memory:') {
      this.raw.exec('PRAGMA busy_timeout = 5000');
      this.raw.exec('PRAGMA journal_mode = WAL');
      this.raw.exec('PRAGMA synchronous = NORMAL');
    }
    this.raw.exec('PRAGMA temp_store = MEMORY');
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
  exec(sql: string): void {
    this.raw.exec(sql);
  }
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.stmt(sql).all(...params) as T[];
  }
  run(sql: string, ...params: Param[]): { changes: number; lastId: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }
  /** Run fn atomically. Nested calls become SAVEPOINTs. Rolls back on throw. */
  tx<T>(fn: () => T): T {
    const outer = this.depth === 0;
    const sp = `sp${this.depth}`;
    if (outer) this.raw.exec('BEGIN');
    else this.raw.exec(`SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const out = fn();
      this.depth--;
      if (outer) {
        this.raw.exec('COMMIT');
        this.writeVersion++;
      } else this.raw.exec(`RELEASE ${sp}`);
      return out;
    } catch (e) {
      this.depth--;
      if (outer) this.raw.exec('ROLLBACK');
      else this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }
  /** Bulk-load mode for seeding: no journal, no fsync. Call `endBulk()` afterwards. */
  beginBulk(): void {
    if (this.path === ':memory:') return;
    this.raw.exec('PRAGMA journal_mode = OFF');
    this.raw.exec('PRAGMA synchronous = OFF');
  }
  endBulk(): void {
    if (this.path === ':memory:') return;
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA synchronous = NORMAL');
  }
  tableExists(name: string): boolean {
    return !!this.get('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?', 'table', name);
  }
  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}
