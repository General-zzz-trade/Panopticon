import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { DbAdapter } from "./adapter";
import { SqliteAdapter } from "./sqlite-adapter";

export type AdapterType = "sqlite" | "pg";

/**
 * Create a DbAdapter instance.
 *
 * @param type - Force a specific adapter. If omitted, auto-detects from
 *   DATABASE_URL (postgres:// or postgresql:// leads to pg, otherwise sqlite).
 * @param options - Optional overrides (e.g. custom sqlite path).
 */
export function createAdapter(
  type?: AdapterType,
  options?: { sqlitePath?: string; connectionString?: string }
): DbAdapter {
  const resolved = type ?? detectType();

  if (resolved === "pg") {
    // Dynamic import so pg-adapter (and the pg module) are only loaded
    // when actually needed.
    const { PgAdapter } = require("./pg-adapter");
    return new PgAdapter(options?.connectionString) as DbAdapter;
  }

  const dbDir = join(process.cwd(), "artifacts");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = options?.sqlitePath ?? join(dbDir, "agent.db");

  return new SqliteAdapter(dbPath, {
    journal_mode: "WAL",
    foreign_keys: "ON",
  });
}

function detectType(): AdapterType {
  const url = process.env.DATABASE_URL;
  if (url && (url.startsWith("postgres://") || url.startsWith("postgresql://"))) {
    return "pg";
  }
  return "sqlite";
}
