// Async PostgreSQL driver. Two backends behind one small API (get / all / run / exec / tx):
//   • pg      — a node-postgres Pool against Supabase (DATABASE_URL / POSTGRES_URL), used when deployed;
//   • pglite  — in-process Postgres (WASM) for local dev (persisted under data/pglite) and tests (in memory).
// Queries keep SQLite-style `?` placeholders; they are rewritten to $1, $2, … once per statement text.
// Transactions are scoped with AsyncLocalStorage: every query issued inside `db.tx(fn)` — however deep the call
// stack — runs on the transaction's connection. Nested tx calls become SAVEPOINTs.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';
import type { PGlite } from '@electric-sql/pglite';

export type Row = Record<string, unknown>;
export type Param = string | number | bigint | boolean | null;

type QueryResult = { rows: Row[]; affectedRows: number };
/** One connection (or the pool, outside a transaction). */
type Conn = {
  query(sql: string, params: Param[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
  /** Bulk-load one table from COPY text format (`columns` in the order the data was written). */
  copyIn(table: string, columns: string[], data: Uint8Array): Promise<void>;
};
type TxScope = { conn: Conn; depth: number; dirty: boolean };

// int8 (COUNT, SUM) and numeric (AVG of integers) come back as strings by default; the app works in JS numbers.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
export const PGLITE_PARSERS = { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) };

/** Tables without an `id` column: INSERTs into them get no automatic `RETURNING id`. */
const NO_ID = new Set(['participant_coverage', 'consent_setting', 'app_meta']);
const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE)\b/i;

/**
 * Per-request scope (entered by server/index.ts for every API request): the shared write counter is read at most once
 * per request instead of once per cache lookup — each read is a network round trip to Supabase.
 */
export const requestScope = new AsyncLocalStorage<{ version?: number }>();

const sqlCache = new Map<string, string>();
/** `?` → `$n` outside string literals; `INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`; INSERTs return their id. */
export function toPg(sql: string): string {
  let out = sqlCache.get(sql);
  if (out !== undefined) return out;
  let n = 0;
  let inStr = false;
  let s = '';
  for (const ch of sql) {
    if (ch === "'") inStr = !inStr;
    s += ch === '?' && !inStr ? `$${++n}` : ch;
  }
  let ignore = false;
  s = s.replace(/^(\s*)INSERT\s+OR\s+IGNORE\s+INTO/i, (_m, ws: string) => { ignore = true; return `${ws}INSERT INTO`; });
  if (ignore) s = `${s.trimEnd()} ON CONFLICT DO NOTHING`;
  const ins = /^\s*INSERT\s+INTO\s+(?:\w+\.)?(\w+)/i.exec(s);
  if (ins && !NO_ID.has(ins[1].toLowerCase()) && !/\bRETURNING\b/i.test(s)) s = `${s.trimEnd()} RETURNING id`;
  out = s;
  if (sqlCache.size > 5000) sqlCache.clear();
  sqlCache.set(sql, out);
  return out;
}

export abstract class Db {
  abstract readonly kind: 'pg' | 'pglite';
  /** Human-readable location for logs (never contains credentials). */
  abstract readonly label: string;
  protected readonly scope = new AsyncLocalStorage<TxScope>();
  /** Last write counter this process saw (refreshed by `version()`); see app_meta.write_version. */
  private lastVersion = 0;

  protected abstract root(): Conn;
  /** Runs fn on a single dedicated connection inside BEGIN … COMMIT. */
  protected abstract withTxConn<T>(fn: (conn: Conn) => Promise<T>): Promise<T>;
  abstract close(): Promise<void>;

  private conn(): Conn {
    return this.scope.getStore()?.conn ?? this.root();
  }
  inTx(): boolean {
    return !!this.scope.getStore();
  }

  async exec(sql: string): Promise<void> {
    await this.conn().exec(sql);
  }
  async get<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined> {
    return (await this.conn().query(toPg(sql), params)).rows[0] as T | undefined;
  }
  async all<T = Row>(sql: string, ...params: Param[]): Promise<T[]> {
    return (await this.conn().query(toPg(sql), params)).rows as T[];
  }
  /** INSERT / UPDATE / DELETE (or DDL). `lastId` is the id of the last inserted row (0 when none). */
  async run(sql: string, ...params: Param[]): Promise<{ changes: number; lastId: number }> {
    const isWrite = WRITE_RE.test(sql);
    const s = this.scope.getStore();
    if (isWrite && !s) {
      // a lone write is its own transaction so the shared write counter moves with it
      return this.tx(() => this.run(sql, ...params));
    }
    const r = await this.conn().query(toPg(sql), params);
    if (isWrite && s) s.dirty = true;
    const last = r.rows.length ? Number(r.rows[r.rows.length - 1].id ?? 0) : 0;
    return { changes: r.affectedRows, lastId: last };
  }

  /** Run fn atomically. Nested calls become SAVEPOINTs. Rolls back on throw. A transaction that wrote bumps write_version. */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    const outer = this.scope.getStore();
    if (outer) {
      const sp = `sp${outer.depth}`;
      await outer.conn.exec(`SAVEPOINT ${sp}`);
      outer.depth++;
      try {
        const out = await fn();
        outer.depth--;
        await outer.conn.exec(`RELEASE SAVEPOINT ${sp}`);
        return out;
      } catch (e) {
        outer.depth--;
        await outer.conn.exec(`ROLLBACK TO SAVEPOINT ${sp}; RELEASE SAVEPOINT ${sp}`);
        throw e;
      }
    }
    let bumped: number | null = null;
    const out = await this.withTxConn(async (conn) => {
      const s: TxScope = { conn, depth: 1, dirty: false };
      const result = await this.scope.run(s, fn);
      if (s.dirty) {
        const r = await conn.query("UPDATE app_meta SET value = (value::bigint + 1)::text WHERE key = 'write_version' RETURNING value", []);
        bumped = r.rows.length ? Number(r.rows[0].value) : null;
      }
      return result;
    });
    if (bumped !== null) {
      this.lastVersion = bumped;
      const req = requestScope.getStore();
      if (req) req.version = bumped;
    }
    return out;
  }

  /** The shared write counter (all instances see the same value). Caches key on it; API responses echo it. */
  async version(): Promise<number> {
    const req = requestScope.getStore();
    if (req?.version !== undefined) return req.version;
    try {
      const r = await this.get<{ value: string }>("SELECT value FROM app_meta WHERE key = 'write_version'");
      this.lastVersion = r ? Number(r.value) : 0;
      if (req) req.version = this.lastVersion;
    } catch {
      /* schema not applied yet */
    }
    return this.lastVersion;
  }

  /** Bulk load (COPY … FROM) — used to publish a seed built in PGlite into the target database. */
  async copyIn(table: string, columns: string[], data: Uint8Array): Promise<void> {
    const s = this.scope.getStore();
    if (s) s.dirty = true;
    await this.conn().copyIn(table, columns, data);
  }

  /** Column names of a table in ordinal order (databases migrated from an older schema have added columns last). */
  async columns(table: string, schema = 'public'): Promise<string[]> {
    return (await this.all<{ c: string }>(
      'SELECT column_name AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position', schema, table)).map((r) => r.c);
  }

  async tableExists(name: string): Promise<boolean> {
    const r = await this.get<{ t: string | null }>('SELECT to_regclass(?) AS t', `public.${name}`);
    return !!r?.t;
  }
}

// ---------------------------------------------------------------- node-postgres (Supabase)

export class PgDb extends Db {
  readonly kind = 'pg' as const;
  readonly label: string;
  readonly pool: pg.Pool;
  constructor(connectionString: string, opts: { max?: number } = {}) {
    super();
    const url = new URL(connectionString);
    this.label = `postgres://${url.hostname}:${url.port || 5432}${url.pathname}`;
    // Supabase's sslmode=require means "encrypt, don't verify the chain" (libpq semantics); node-postgres would read it
    // as verify-full against the system store and reject Supabase's own CA. Local servers get no TLS.
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('supa');
    this.pool = new pg.Pool({
      connectionString: url.toString(),
      ssl: local ? undefined : { rejectUnauthorized: false },
      max: opts.max ?? 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
    });
    this.pool.on('error', (e) => console.error('[db] idle client error', e.message));
  }
  private wrap(c: pg.Pool | pg.PoolClient): Conn {
    return {
      query: async (sql, params) => {
        const r = await c.query({ text: sql, values: params as unknown[] });
        return { rows: r.rows as Row[], affectedRows: r.rowCount ?? 0 };
      },
      exec: async (sql) => { await c.query(sql); },
      copyIn: async (table, columns, data) => {
        if (c instanceof pg.Pool) throw new Error('copyIn needs a transaction');
        const stream = c.query(copyFrom(`COPY ${table} (${columns.join(', ')}) FROM STDIN`));
        await pipeline(Readable.from([Buffer.from(data)]), stream);
      },
    };
  }
  protected root(): Conn {
    return this.wrap(this.pool);
  }
  protected async withTxConn<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const conn = this.wrap(client);
    try {
      await client.query('BEGIN');
      const out = await fn(conn);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// ---------------------------------------------------------------- PGlite (local dev, tests, seeding)

export class PgliteDb extends Db {
  readonly kind = 'pglite' as const;
  readonly label: string;
  constructor(readonly pglite: PGlite, label: string) {
    super();
    this.label = label;
  }
  /** `dataDir` = a directory for a persistent database, or undefined for in-memory. */
  static async open(dataDir?: string): Promise<PgliteDb> {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = await PGlite.create(dataDir ? { dataDir, parsers: PGLITE_PARSERS } : { parsers: PGLITE_PARSERS });
    return new PgliteDb(db, dataDir ? `pglite:${dataDir}` : 'pglite:memory');
  }
  private wrap(c: Pick<PGlite, 'query' | 'exec'>): Conn {
    return {
      query: async (sql, params) => {
        const r = await c.query<Row>(sql, params as unknown[]);
        return { rows: r.rows, affectedRows: r.affectedRows ?? 0 };
      },
      exec: async (sql) => { await c.exec(sql); },
      copyIn: async (table, columns, data) => {
        await c.query(`COPY ${table} (${columns.join(', ')}) FROM '/dev/blob'`, [], { blob: new Blob([data]) });
      },
    };
  }
  /** COPY … TO in text format (the source side of a seed publish), columns in the given order. */
  async copyOut(table: string, columns: string[]): Promise<Uint8Array> {
    const r = await this.pglite.query(`COPY ${table} (${columns.join(', ')}) TO '/dev/blob'`);
    return r.blob ? new Uint8Array(await r.blob.arrayBuffer()) : new Uint8Array();
  }
  protected root(): Conn {
    return this.wrap(this.pglite);
  }
  protected withTxConn<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
    // PGlite's transaction() holds its exclusive lock, so concurrent requests queue instead of interleaving.
    return this.pglite.transaction((tx) => fn(this.wrap(tx)));
  }
  async close(): Promise<void> {
    if (!this.pglite.closed) await this.pglite.close();
  }
}
