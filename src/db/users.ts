import { getDb } from "./client";
import { createHash, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CREATE_USERS_TABLE = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user',
    tenant_id TEXT NOT NULL DEFAULT 'default',
    plan TEXT NOT NULL DEFAULT 'free',
    usage_tokens INTEGER NOT NULL DEFAULT 0,
    usage_runs INTEGER NOT NULL DEFAULT 0,
    usage_limit_tokens INTEGER NOT NULL DEFAULT 100000,
    usage_limit_runs INTEGER NOT NULL DEFAULT 50,
    stripe_customer_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  tenant_id: string;
  plan: string;
  usage_tokens: number;
  usage_runs: number;
  usage_limit_tokens: number;
  usage_limit_runs: number;
  stripe_customer_id: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface UserUsage {
  usage_tokens: number;
  usage_runs: number;
  usage_limit_tokens: number;
  usage_limit_runs: number;
  plan: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple SHA-256 hash. Note: bcrypt would be better for production. */
export function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

// ---------------------------------------------------------------------------
// Repository functions
// ---------------------------------------------------------------------------

export function initUsersTable(): void {
  const db = getDb();
  db.exec(CREATE_USERS_TABLE);
}

export function createUser(
  email: string,
  password: string,
  name: string,
  role = "user",
  tenantId = "default",
): User {
  const db = getDb();
  const id = randomUUID();
  const passwordHash = hashPassword(password);

  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, email, passwordHash, name, role, tenantId);

  return findUserById(id)!;
}

export function findUserByEmail(email: string): User | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

export function findUserById(id: string): User | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function updateUserUsage(id: string, tokens: number, runs: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE users
        SET usage_tokens = usage_tokens + ?,
            usage_runs   = usage_runs + ?
      WHERE id = ?`,
  ).run(tokens, runs, id);
}

export function getUserUsage(id: string): UserUsage | undefined {
  const db = getDb();
  return db
    .prepare(
      "SELECT usage_tokens, usage_runs, usage_limit_tokens, usage_limit_runs, plan FROM users WHERE id = ?",
    )
    .get(id) as UserUsage | undefined;
}

export function updateLastLogin(id: string): void {
  const db = getDb();
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}
