import { getDb } from "../db/client";

export const CREATE_EPISODES_TABLE = `
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL UNIQUE,
    goal TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'unknown',
    task_count INTEGER NOT NULL DEFAULT 0,
    replan_count INTEGER NOT NULL DEFAULT 0,
    embedding TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_episodes_domain ON episodes(domain);
  CREATE INDEX IF NOT EXISTS idx_episodes_outcome ON episodes(outcome);
`;

export interface Episode {
  id: number;
  runId: string;
  goal: string;
  domain: string;
  summary: string;
  outcome: "success" | "failure" | "unknown";
  taskCount: number;
  replanCount: number;
  embedding?: number[];
  createdAt: string;
}

export function initEpisodesTable(): void {
  getDb().exec(CREATE_EPISODES_TABLE);
}

export function saveEpisode(episode: Omit<Episode, "id" | "createdAt">): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO episodes (run_id, goal, domain, summary, outcome, task_count, replan_count, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      summary = excluded.summary,
      outcome = excluded.outcome,
      embedding = excluded.embedding
  `).run(
    episode.runId,
    episode.goal,
    episode.domain,
    episode.summary,
    episode.outcome,
    episode.taskCount,
    episode.replanCount,
    episode.embedding ? JSON.stringify(episode.embedding) : null
  );
}

export function getRecentEpisodes(limit: number = 20, domain?: string): Episode[] {
  const db = getDb();
  const rows = domain
    ? db.prepare("SELECT * FROM episodes WHERE domain = ? ORDER BY created_at DESC LIMIT ?").all(domain, limit)
    : db.prepare("SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?").all(limit);
  return (rows as any[]).map(mapRow);
}

export function getAllEpisodesWithEmbeddings(): Episode[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM episodes WHERE embedding IS NOT NULL ORDER BY created_at DESC LIMIT 500").all();
  return (rows as any[]).map(mapRow);
}

function mapRow(row: any): Episode {
  return {
    id: row.id,
    runId: row.run_id,
    goal: row.goal,
    domain: row.domain,
    summary: row.summary,
    outcome: row.outcome,
    taskCount: row.task_count,
    replanCount: row.replan_count,
    embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
    createdAt: row.created_at
  };
}
