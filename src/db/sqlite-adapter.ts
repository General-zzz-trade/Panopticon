import Database from "better-sqlite3";
import type { DbAdapter, PreparedStatement } from "./adapter";

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database;

  constructor(dbPath: string, pragmas?: Record<string, string>) {
    this.db = new Database(dbPath);
    if (pragmas) {
      for (const [key, value] of Object.entries(pragmas)) {
        this.db.pragma(`${key} = ${value}`);
      }
    }
  }

  run(sql: string, params: unknown[] = []): void {
    this.db.prepare(sql).run(...params);
  }

  get<T = unknown>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = unknown>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  execSql(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return {
      run(...params: unknown[]) {
        const result = stmt.run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      },
      get(...params: unknown[]) {
        return stmt.get(...params);
      },
      all(...params: unknown[]) {
        return stmt.all(...params);
      },
    };
  }

  transaction<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn);
    return wrapped();
  }

  close(): void {
    this.db.close();
  }

  /** Expose the raw better-sqlite3 instance for legacy code that needs it. */
  get raw(): Database.Database {
    return this.db;
  }
}
