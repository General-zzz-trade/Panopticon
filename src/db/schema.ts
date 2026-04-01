export const CREATE_API_KEYS_TABLE = `
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
`;

export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    planner_used TEXT,
    replan_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    result_success INTEGER,
    result_message TEXT,
    termination_reason TEXT,
    context_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id),
    type TEXT NOT NULL,
    path TEXT NOT NULL,
    description TEXT NOT NULL,
    task_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
  CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
`;
