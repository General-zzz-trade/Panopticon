/**
 * Cross-session user memory — persists user preferences, frequent goals,
 * and context notes in SQLite across all runs and restarts.
 */
import { getDb } from "../db/client";

export const CREATE_USER_MEMORY_TABLE = `
  CREATE TABLE IF NOT EXISTS user_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memory_tenant_key ON user_memory(tenant_id, key);
  CREATE INDEX IF NOT EXISTS idx_user_memory_category ON user_memory(tenant_id, category);
`;

export interface UserMemoryEntry {
  id: number;
  tenantId: string;
  key: string;
  value: string;
  category: "preference" | "frequent_goal" | "context" | "general";
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export function initUserMemoryTable(): void {
  getDb().exec(CREATE_USER_MEMORY_TABLE);
}

export function upsertMemory(
  tenantId: string,
  key: string,
  value: string,
  category: UserMemoryEntry["category"] = "general"
): void {
  getDb().prepare(`
    INSERT INTO user_memory (tenant_id, key, value, category, use_count, updated_at)
    VALUES (?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(tenant_id, key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      use_count = use_count + 1,
      updated_at = datetime('now')
  `).run(tenantId, key, value, category);
}

export function getMemory(tenantId: string, key: string): UserMemoryEntry | undefined {
  const row = getDb().prepare(
    "SELECT * FROM user_memory WHERE tenant_id=? AND key=?"
  ).get(tenantId, key) as Record<string, unknown> | undefined;
  return row ? rowToEntry(row) : undefined;
}

export function listMemory(tenantId: string, category?: string): UserMemoryEntry[] {
  const rows = category
    ? getDb().prepare(
        "SELECT * FROM user_memory WHERE tenant_id=? AND category=? ORDER BY use_count DESC, updated_at DESC"
      ).all(tenantId, category)
    : getDb().prepare(
        "SELECT * FROM user_memory WHERE tenant_id=? ORDER BY use_count DESC, updated_at DESC"
      ).all(tenantId);
  return (rows as Record<string, unknown>[]).map(rowToEntry);
}

export function deleteMemory(tenantId: string, key: string): void {
  getDb().prepare("DELETE FROM user_memory WHERE tenant_id=? AND key=?").run(tenantId, key);
}

export function clearMemory(tenantId: string): void {
  getDb().prepare("DELETE FROM user_memory WHERE tenant_id=?").run(tenantId);
}

/** Auto-record a goal as a frequent_goal memory entry */
export function recordFrequentGoal(tenantId: string, goal: string): void {
  const key = `goal:${goal.slice(0, 80).toLowerCase().replace(/\s+/g, "_")}`;
  upsertMemory(tenantId, key, goal, "frequent_goal");
}

/** Return top N most-used goals for this tenant */
export function getFrequentGoals(tenantId: string, limit = 5): string[] {
  const rows = getDb().prepare(`
    SELECT value FROM user_memory
    WHERE tenant_id=? AND category='frequent_goal'
    ORDER BY use_count DESC LIMIT ?
  `).all(tenantId, limit) as { value: string }[];
  return rows.map(r => r.value);
}

function rowToEntry(row: Record<string, unknown>): UserMemoryEntry {
  return {
    id: Number(row.id),
    tenantId: String(row.tenant_id),
    key: String(row.key),
    value: String(row.value),
    category: String(row.category) as UserMemoryEntry["category"],
    useCount: Number(row.use_count),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
