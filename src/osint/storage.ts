/**
 * OSINT Storage — SQLite persistence for investigation results
 * Stores investigations, enables history comparison, accumulates knowledge graph
 */

import { getDb } from "../db/client.js";

// ── Schema ──────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS osint_investigations (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    risk_level TEXT,
    risk_score INTEGER,
    entity_count INTEGER DEFAULT 0,
    relation_count INTEGER DEFAULT 0,
    data JSON,
    report TEXT,
    duration_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    tenant_id TEXT DEFAULT 'default'
  );

  CREATE INDEX IF NOT EXISTS idx_osint_target ON osint_investigations(target);
  CREATE INDEX IF NOT EXISTS idx_osint_created ON osint_investigations(created_at);

  CREATE TABLE IF NOT EXISTS osint_entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    metadata JSON,
    sources JSON,
    confidence REAL DEFAULT 0.5,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    investigation_id TEXT,
    tenant_id TEXT DEFAULT 'default',
    UNIQUE(type, value, tenant_id)
  );

  CREATE INDEX IF NOT EXISTS idx_entity_type ON osint_entities(type);
  CREATE INDEX IF NOT EXISTS idx_entity_value ON osint_entities(value);

  CREATE TABLE IF NOT EXISTS osint_relations (
    id TEXT PRIMARY KEY,
    source_entity TEXT NOT NULL,
    target_entity TEXT NOT NULL,
    type TEXT NOT NULL,
    confidence REAL DEFAULT 0.5,
    metadata JSON,
    investigation_id TEXT,
    tenant_id TEXT DEFAULT 'default'
  );

  CREATE TABLE IF NOT EXISTS osint_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id TEXT,
    check_type TEXT,
    severity TEXT,
    message TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    tenant_id TEXT DEFAULT 'default'
  );
`;

export function initOsintSchema(): void {
  const db = getDb();
  // Run each statement separately to avoid issues with multi-statement exec
  for (const stmt of SCHEMA_SQL.split(";").map(s => s.trim()).filter(Boolean)) {
    db.prepare(stmt).run();
  }
}

// ── Save Investigation ──────────────────────────────────

export function saveInvestigation(data: {
  target: string;
  type: string;
  riskLevel?: string;
  riskScore?: number;
  entityCount?: number;
  relationCount?: number;
  data: any;
  report?: string;
  durationMs?: number;
  tenantId?: string;
}): string {
  const db = getDb();
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO osint_investigations (id, target, type, risk_level, risk_score, entity_count, relation_count, data, report, duration_ms, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, data.target, data.type, data.riskLevel || null, data.riskScore || null,
    data.entityCount || 0, data.relationCount || 0,
    JSON.stringify(data.data), data.report || null, data.durationMs || null,
    data.tenantId || "default"
  );

  return id;
}

// ── Query Investigations ────────────────────────────────

export function getInvestigation(id: string): any {
  const db = getDb();
  const row = db.prepare("SELECT * FROM osint_investigations WHERE id = ?").get(id) as any;
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data || "{}") };
}

export function listInvestigations(options: {
  target?: string;
  type?: string;
  limit?: number;
  offset?: number;
  tenantId?: string;
} = {}): any[] {
  const db = getDb();
  let sql = "SELECT id, target, type, risk_level, risk_score, entity_count, relation_count, duration_ms, created_at FROM osint_investigations WHERE 1=1";
  const params: any[] = [];

  if (options.target) { sql += " AND target LIKE ?"; params.push(`%${options.target}%`); }
  if (options.type) { sql += " AND type = ?"; params.push(options.type); }
  if (options.tenantId) { sql += " AND tenant_id = ?"; params.push(options.tenantId); }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(options.limit || 50, options.offset || 0);

  return db.prepare(sql).all(...params);
}

// ── History Comparison ──────────────────────────────────

export interface HistoryDiff {
  target: string;
  investigations: { id: string; date: string; riskLevel?: string }[];
  changes: { field: string; from: any; to: any; date: string }[];
}

export function compareHistory(target: string, limit = 10): HistoryDiff {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, data, risk_level, created_at FROM osint_investigations WHERE target = ? ORDER BY created_at DESC LIMIT ?"
  ).all(target, limit) as any[];

  const diff: HistoryDiff = {
    target,
    investigations: rows.map(r => ({ id: r.id, date: r.created_at, riskLevel: r.risk_level })),
    changes: [],
  };

  for (let i = 0; i < rows.length - 1; i++) {
    const newer = JSON.parse(rows[i].data || "{}");
    const older = JSON.parse(rows[i + 1].data || "{}");

    if (rows[i].risk_level !== rows[i + 1].risk_level) {
      diff.changes.push({ field: "risk_level", from: rows[i + 1].risk_level, to: rows[i].risk_level, date: rows[i].created_at });
    }

    const newSubCount = newer.domain?.subdomains?.length || 0;
    const oldSubCount = older.domain?.subdomains?.length || 0;
    if (newSubCount !== oldSubCount) {
      diff.changes.push({ field: "subdomains", from: oldSubCount, to: newSubCount, date: rows[i].created_at });
    }
  }

  return diff;
}

// ── Knowledge Graph Accumulation ────────────────────────

export function accumulateEntity(
  type: string, value: string, metadata: any = {},
  sources: string[] = [], investigationId?: string, tenantId = "default"
): void {
  const db = getDb();

  const existing = db.prepare(
    "SELECT id, confidence, sources FROM osint_entities WHERE type = ? AND value = ? AND tenant_id = ?"
  ).get(type, value.toLowerCase(), tenantId) as any;

  if (existing) {
    const existingSources = JSON.parse(existing.sources || "[]");
    const mergedSources = [...new Set([...existingSources, ...sources])];
    const newConfidence = Math.min(1, existing.confidence + 0.05);

    db.prepare(
      "UPDATE osint_entities SET confidence = ?, sources = ?, last_seen = datetime('now'), metadata = ? WHERE id = ?"
    ).run(newConfidence, JSON.stringify(mergedSources), JSON.stringify(metadata), existing.id);
  } else {
    const id = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      "INSERT INTO osint_entities (id, type, value, metadata, sources, investigation_id, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(id, type, value.toLowerCase(), JSON.stringify(metadata), JSON.stringify(sources), investigationId || null, tenantId);
  }
}

export function getKnowledgeGraphStats(tenantId = "default"): {
  entities: number; relations: number; entityTypes: Record<string, number>;
} {
  const db = getDb();
  const entities = (db.prepare("SELECT COUNT(*) as c FROM osint_entities WHERE tenant_id = ?").get(tenantId) as any).c;
  const relations = (db.prepare("SELECT COUNT(*) as c FROM osint_relations WHERE tenant_id = ?").get(tenantId) as any).c;

  const typeRows = db.prepare(
    "SELECT type, COUNT(*) as c FROM osint_entities WHERE tenant_id = ? GROUP BY type"
  ).all(tenantId) as any[];

  const entityTypes: Record<string, number> = {};
  for (const row of typeRows) entityTypes[row.type] = row.c;

  return { entities, relations, entityTypes };
}
