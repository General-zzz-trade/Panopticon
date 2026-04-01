import { getDb } from "../db/client";

export const CREATE_SCHEDULES_TABLE = `
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    goal TEXT NOT NULL,
    cron_expr TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON schedules(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
`;

export interface ScheduleRecord {
  id: string;
  name: string;
  goal: string;
  cronExpr: string;
  tenantId: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  createdAt: string;
}

export function initSchedulesTable(): void {
  getDb().exec(CREATE_SCHEDULES_TABLE);
}

export function createSchedule(record: Omit<ScheduleRecord, "runCount" | "createdAt">): ScheduleRecord {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO schedules (id, name, goal, cron_expr, tenant_id, enabled, next_run_at, run_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(record.id, record.name, record.goal, record.cronExpr, record.tenantId, record.enabled ? 1 : 0, record.nextRunAt ?? null, now);
  return getSchedule(record.id)!;
}

export function getSchedule(id: string): ScheduleRecord | undefined {
  const row = getDb().prepare("SELECT * FROM schedules WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function listSchedules(tenantId?: string): ScheduleRecord[] {
  const rows = tenantId
    ? getDb().prepare("SELECT * FROM schedules WHERE tenant_id=? ORDER BY created_at DESC").all(tenantId)
    : getDb().prepare("SELECT * FROM schedules ORDER BY created_at DESC").all();
  return (rows as Record<string, unknown>[]).map(rowToRecord);
}

export function updateScheduleRun(id: string, lastRunAt: string, nextRunAt: string): void {
  getDb().prepare(
    "UPDATE schedules SET last_run_at=?, next_run_at=?, run_count=run_count+1 WHERE id=?"
  ).run(lastRunAt, nextRunAt, id);
}

export function setScheduleEnabled(id: string, enabled: boolean): void {
  getDb().prepare("UPDATE schedules SET enabled=? WHERE id=?").run(enabled ? 1 : 0, id);
}

export function deleteSchedule(id: string): void {
  getDb().prepare("DELETE FROM schedules WHERE id=?").run(id);
}

function rowToRecord(row: Record<string, unknown>): ScheduleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    goal: String(row.goal),
    cronExpr: String(row.cron_expr),
    tenantId: String(row.tenant_id),
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ? String(row.last_run_at) : undefined,
    nextRunAt: row.next_run_at ? String(row.next_run_at) : undefined,
    runCount: Number(row.run_count),
    createdAt: String(row.created_at)
  };
}
