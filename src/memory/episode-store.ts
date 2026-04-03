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

/**
 * Remove episodes older than maxAgeDays, keeping at most maxCount total.
 * Returns the number of deleted episodes.
 */
export function pruneEpisodes(maxAgeDays: number = 90, maxCount: number = 500): number {
  const db = getDb();

  // Delete old episodes
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString();

  const aged = db.prepare(
    "DELETE FROM episodes WHERE created_at < ? AND outcome != 'success'"
  ).run(cutoffStr);

  // Enforce max count — keep most recent
  const overflow = db.prepare(
    "DELETE FROM episodes WHERE id NOT IN (SELECT id FROM episodes ORDER BY created_at DESC LIMIT ?)"
  ).run(maxCount);

  return (aged.changes ?? 0) + (overflow.changes ?? 0);
}

/**
 * Merge similar episodes for the same domain+outcome into a single summary.
 * Keeps the most recent and deletes older duplicates.
 */
export function consolidateEpisodes(domain: string): number {
  const db = getDb();

  // Find groups with same domain and outcome that have > 3 entries
  const groups = db.prepare(
    "SELECT domain, outcome, COUNT(*) as cnt FROM episodes WHERE domain = ? GROUP BY domain, outcome HAVING cnt > 3"
  ).all(domain) as Array<{ domain: string; outcome: string; cnt: number }>;

  let consolidated = 0;
  for (const group of groups) {
    // Keep the 3 most recent, delete the rest
    const toDelete = db.prepare(
      "DELETE FROM episodes WHERE domain = ? AND outcome = ? AND id NOT IN (SELECT id FROM episodes WHERE domain = ? AND outcome = ? ORDER BY created_at DESC LIMIT 3)"
    ).run(group.domain, group.outcome, group.domain, group.outcome);
    consolidated += toDelete.changes ?? 0;
  }

  return consolidated;
}

/**
 * Get episode store stats.
 */
export function getEpisodeStats(): { total: number; byOutcome: Record<string, number>; oldestDate: string | null } {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as n FROM episodes").get() as { n: number }).n;

  const outcomes = db.prepare(
    "SELECT outcome, COUNT(*) as n FROM episodes GROUP BY outcome"
  ).all() as Array<{ outcome: string; n: number }>;

  const byOutcome: Record<string, number> = {};
  for (const row of outcomes) byOutcome[row.outcome] = row.n;

  const oldest = db.prepare(
    "SELECT MIN(created_at) as d FROM episodes"
  ).get() as { d: string | null };

  return { total, byOutcome, oldestDate: oldest.d };
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
