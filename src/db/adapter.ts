export interface DbAdapter {
  run(sql: string, params?: unknown[]): void;
  get<T = unknown>(sql: string, params?: unknown[]): T | undefined;
  all<T = unknown>(sql: string, params?: unknown[]): T[];
  /** Execute raw SQL (potentially multiple statements). This is a DB method, not child_process. */
  execSql(sql: string): void;
  prepare(sql: string): PreparedStatement;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
