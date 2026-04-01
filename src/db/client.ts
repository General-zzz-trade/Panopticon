import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CREATE_TABLES } from "./schema";
import { CREATE_KNOWLEDGE_TABLE } from "../knowledge/store";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbDir = join(process.cwd(), "artifacts");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, "agent.db");

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(CREATE_TABLES);
  _db.exec(CREATE_KNOWLEDGE_TABLE);
  runMigrations(_db);

  return _db;
}

function runMigrations(db: Database.Database): void {
  // Migration 1: add tenant_id to runs if missing
  const runsCols = db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
  if (!runsCols.some(c => c.name === "tenant_id")) {
    db.exec("ALTER TABLE runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_runs_tenant ON runs(tenant_id)");
  }

  // Migration 2: add tenant_id to api_keys if missing (api_keys may not exist yet)
  const keysCols = db.prepare("PRAGMA table_info(api_keys)").all() as Array<{ name: string }>;
  if (keysCols.length > 0 && !keysCols.some(c => c.name === "tenant_id")) {
    db.exec("ALTER TABLE api_keys ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id)");
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
