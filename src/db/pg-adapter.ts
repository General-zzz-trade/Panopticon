import type { DbAdapter, PreparedStatement } from "./adapter";

/**
 * PostgreSQL adapter for DbAdapter.
 *
 * Uses the `pg` module loaded dynamically so the rest of the codebase
 * doesn't hard-depend on it. Connection is configured via DATABASE_URL.
 *
 * NOTE: better-sqlite3 is synchronous while pg is async. This adapter
 * bridges the gap using a spin-wait pattern suitable for CLI / scripts.
 * Production server deployments should consider a fully async adapter.
 */

let pgModule: any;

function requirePg(): any {
  if (pgModule) return pgModule;
  try {
    pgModule = require("pg");
    return pgModule;
  } catch {
    throw new Error(
      "PostgreSQL adapter requires the 'pg' package. Install it with: npm install pg @types/pg"
    );
  }
}

/** Translate SQLite-flavored SQL to PostgreSQL dialect. */
function translateSql(sql: string): string {
  let out = sql;

  // AUTOINCREMENT -> SERIAL
  out = out.replace(
    /INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi,
    "SERIAL PRIMARY KEY"
  );

  // datetime('now') -> NOW()
  out = out.replace(/datetime\(\s*'now'\s*\)/gi, "NOW()");

  // Strip PRAGMA statements (no-op in PG)
  out = out.replace(/^\s*PRAGMA\s+[^;]*;?/gim, "");

  // SQLite uses ? for positional params; pg uses $1, $2, ...
  let idx = 0;
  out = out.replace(/\?/g, () => `$${++idx}`);

  return out;
}

export class PgAdapter implements DbAdapter {
  private pool: any; // pg.Pool
  private connected = false;

  constructor(connectionString?: string) {
    const pg = requirePg();
    const url = connectionString || process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "PgAdapter requires a connection string via constructor argument or DATABASE_URL env var"
      );
    }
    this.pool = new pg.Pool({ connectionString: url });
    this.connected = true;
  }

  /** Run a query synchronously by spin-waiting on the callback. */
  private query(sql: string, params: unknown[] = []): any {
    const translated = translateSql(sql);
    let result: any;
    let error: any;
    let done = false;

    this.pool.query(translated, params, (err: any, res: any) => {
      error = err;
      result = res;
      done = true;
    });

    const deadline = Date.now() + 30_000;
    while (!done) {
      if (Date.now() > deadline) throw new Error("PgAdapter query timed out");
      const buf = new SharedArrayBuffer(4);
      const arr = new Int32Array(buf);
      Atomics.wait(arr, 0, 0, 1); // sleep ~1ms
    }

    if (error) throw error;
    return result;
  }

  run(sql: string, params: unknown[] = []): void {
    this.query(sql, params);
  }

  get<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    const result = this.query(sql, params);
    return (result.rows[0] as T) ?? undefined;
  }

  all<T = unknown>(sql: string, params: unknown[] = []): T[] {
    const result = this.query(sql, params);
    return result.rows as T[];
  }

  execSql(sql: string): void {
    const translated = translateSql(sql);
    const statements = translated
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      this.query(stmt + ";");
    }
  }

  prepare(sql: string): PreparedStatement {
    const translated = translateSql(sql);
    const self = this;

    return {
      run(...params: unknown[]) {
        const result = self.query(translated, params);
        return {
          changes: result.rowCount ?? 0,
          lastInsertRowid: result.rows?.[0]?.id ?? 0,
        };
      },
      get(...params: unknown[]) {
        const result = self.query(translated, params);
        return result.rows[0];
      },
      all(...params: unknown[]) {
        const result = self.query(translated, params);
        return result.rows;
      },
    };
  }

  transaction<T>(fn: () => T): T {
    this.query("BEGIN");
    try {
      const result = fn();
      this.query("COMMIT");
      return result;
    } catch (err) {
      this.query("ROLLBACK");
      throw err;
    }
  }

  close(): void {
    if (this.connected) {
      this.pool.end();
      this.connected = false;
    }
  }
}
