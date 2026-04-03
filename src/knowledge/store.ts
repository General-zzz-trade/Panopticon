/**
 * Knowledge Store — SQLite-backed persistent memory for the agent.
 * Runs against the same agent.db used by the run repository.
 */

import { getDb } from "../db/client";
import type {
  KnowledgeType,
  KnowledgeEntry,
  SelectorMapEntry,
  FailureLessonEntry,
  TaskTemplateEntry,
  RelevantKnowledge
} from "./types";

export const CREATE_KNOWLEDGE_TABLE = `
  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_type_domain_key ON knowledge(type, domain, key);
  CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge(type);
  CREATE INDEX IF NOT EXISTS idx_knowledge_domain ON knowledge(domain);
`;

export function initKnowledgeTable(): void {
  getDb().exec(CREATE_KNOWLEDGE_TABLE);
}

// ── Selector Map ──────────────────────────────────────────────────────────────

export function upsertSelector(entry: SelectorMapEntry): void {
  const db = getDb();
  const key = `${entry.description}::${entry.selector}`;
  const existing = db.prepare(
    "SELECT id, value_json, confidence, use_count FROM knowledge WHERE type='selector_map' AND domain=? AND key=?"
  ).get(entry.domain, key) as { id: number; value_json: string; confidence: number; use_count: number } | undefined;

  if (existing) {
    const prev = JSON.parse(existing.value_json) as SelectorMapEntry;
    const updated: SelectorMapEntry = {
      ...prev,
      successCount: prev.successCount + entry.successCount,
      failureCount: prev.failureCount + entry.failureCount
    };
    const total = updated.successCount + updated.failureCount;
    const confidence = total > 0 ? updated.successCount / total : 0.5;
    db.prepare(
      "UPDATE knowledge SET value_json=?, confidence=?, use_count=use_count+1, updated_at=datetime('now') WHERE id=?"
    ).run(JSON.stringify(updated), confidence, existing.id);
  } else {
    const total = entry.successCount + entry.failureCount;
    const confidence = total > 0 ? entry.successCount / total : 0.5;
    db.prepare(
      "INSERT INTO knowledge (type, domain, key, value_json, confidence, use_count) VALUES (?,?,?,?,?,?)"
    ).run("selector_map", entry.domain, key, JSON.stringify(entry), confidence, 1);
  }
}

export function getSelectorsForDomain(domain: string): SelectorMapEntry[] {
  const rows = getDb().prepare(
    "SELECT value_json FROM knowledge WHERE type='selector_map' AND domain=? ORDER BY confidence DESC LIMIT 50"
  ).all(domain) as { value_json: string }[];
  return rows.map(r => JSON.parse(r.value_json) as SelectorMapEntry);
}

/**
 * Get selectors across all domains for a given description.
 * Returns selectors with highest confidence regardless of domain.
 */
export function getSelectorsAcrossDomains(description: string): SelectorMapEntry[] {
  const rows = getDb().prepare(
    "SELECT value_json FROM knowledge WHERE type='selector_map' AND key LIKE ? ORDER BY confidence DESC LIMIT 10"
  ).all(`${description}::%`) as { value_json: string }[];
  return rows.map(r => JSON.parse(r.value_json) as SelectorMapEntry);
}

// ── Failure Lessons ───────────────────────────────────────────────────────────

export function upsertLesson(entry: FailureLessonEntry): void {
  const db = getDb();
  const key = `${entry.taskType}::${entry.errorPattern}`;
  const domain = entry.domain ?? "";
  const existing = db.prepare(
    "SELECT id, value_json, confidence, use_count FROM knowledge WHERE type='failure_lesson' AND domain=? AND key=?"
  ).get(domain, key) as { id: number; value_json: string; confidence: number; use_count: number } | undefined;

  if (existing) {
    const prev = JSON.parse(existing.value_json) as FailureLessonEntry;
    const updated: FailureLessonEntry = { ...prev, successCount: prev.successCount + entry.successCount };
    const newConf = Math.min(0.99, existing.confidence + 0.05 * entry.successCount);
    db.prepare(
      "UPDATE knowledge SET value_json=?, confidence=?, use_count=use_count+1, updated_at=datetime('now') WHERE id=?"
    ).run(JSON.stringify(updated), newConf, existing.id);
  } else {
    db.prepare(
      "INSERT INTO knowledge (type, domain, key, value_json, confidence, use_count) VALUES (?,?,?,?,?,?)"
    ).run("failure_lesson", domain, key, JSON.stringify(entry), 0.5, 1);
  }
}

/**
 * Retrieve lessons across ALL domains, abstracted to task-type level.
 * Used when domain-specific knowledge is insufficient.
 */
export function getCrossDomainLessons(taskType: string, excludeDomain?: string): FailureLessonEntry[] {
  const db = getDb();
  const rows = excludeDomain
    ? db.prepare(
        "SELECT value_json FROM knowledge WHERE type='failure_lesson' AND key LIKE ? AND domain != ? ORDER BY confidence DESC LIMIT 10"
      ).all(`${taskType}::%`, excludeDomain)
    : db.prepare(
        "SELECT value_json FROM knowledge WHERE type='failure_lesson' AND key LIKE ? ORDER BY confidence DESC LIMIT 10"
      ).all(`${taskType}::%`);
  return (rows as { value_json: string }[]).map(r => JSON.parse(r.value_json) as FailureLessonEntry);
}

export function getLessonsForTaskType(taskType: string, domain?: string): FailureLessonEntry[] {
  const db = getDb();
  const rows = domain
    ? db.prepare(
        "SELECT value_json FROM knowledge WHERE type='failure_lesson' AND key LIKE ? AND (domain='' OR domain=?) ORDER BY confidence DESC LIMIT 20"
      ).all(`${taskType}::%`, domain)
    : db.prepare(
        "SELECT value_json FROM knowledge WHERE type='failure_lesson' AND key LIKE ? ORDER BY confidence DESC LIMIT 20"
      ).all(`${taskType}::%`);
  const lessons = (rows as { value_json: string }[]).map(r => JSON.parse(r.value_json) as FailureLessonEntry);

  // Cross-domain fallback: if domain-specific lessons are scarce, include cross-domain patterns
  if (domain && lessons.length < 3) {
    const crossDomain = getCrossDomainLessons(taskType, domain);
    // Add cross-domain lessons not already present (by recovery strategy)
    const existingRecoveries = new Set(lessons.map(l => l.recovery));
    for (const lesson of crossDomain) {
      if (!existingRecoveries.has(lesson.recovery)) {
        lessons.push(lesson);
        existingRecoveries.add(lesson.recovery);
      }
      if (lessons.length >= 10) break;
    }
  }

  return lessons;
}

export function retrieveRecoveryPriors(
  taskType: string,
  options: {
    domain?: string;
    hypothesisKind?: string;
    limit?: number;
  } = {}
): FailureLessonEntry[] {
  const limit = Math.max(1, options.limit ?? 5);
  const lessons = getLessonsForTaskType(taskType, options.domain);

  return [...lessons]
    .sort((left, right) => scoreLesson(right, options) - scoreLesson(left, options))
    .slice(0, limit);
}

// ── Task Templates ────────────────────────────────────────────────────────────

export function upsertTemplate(entry: TaskTemplateEntry): void {
  const db = getDb();
  const key = entry.goalPattern;
  const domain = entry.domain ?? "";
  const existing = db.prepare(
    "SELECT id, value_json, confidence FROM knowledge WHERE type='task_template' AND domain=? AND key=?"
  ).get(domain, key) as { id: number; value_json: string; confidence: number } | undefined;

  if (existing) {
    const prev = JSON.parse(existing.value_json) as TaskTemplateEntry;
    const updated: TaskTemplateEntry = { ...prev, successCount: prev.successCount + entry.successCount };
    const newConf = Math.min(0.99, existing.confidence + 0.1);
    db.prepare(
      "UPDATE knowledge SET value_json=?, confidence=?, use_count=use_count+1, updated_at=datetime('now') WHERE id=?"
    ).run(JSON.stringify(updated), newConf, existing.id);
  } else {
    db.prepare(
      "INSERT INTO knowledge (type, domain, key, value_json, confidence, use_count) VALUES (?,?,?,?,?,?)"
    ).run("task_template", domain, key, JSON.stringify(entry), 0.6, 1);
  }
}

export function findTemplates(goalKeywords: string[], domain?: string): TaskTemplateEntry[] {
  const db = getDb();
  const all = domain
    ? db.prepare("SELECT value_json FROM knowledge WHERE type='task_template' AND (domain='' OR domain=?) ORDER BY confidence DESC LIMIT 30").all(domain)
    : db.prepare("SELECT value_json FROM knowledge WHERE type='task_template' ORDER BY confidence DESC LIMIT 30").all();

  const templates = (all as { value_json: string }[]).map(r => JSON.parse(r.value_json) as TaskTemplateEntry);
  // Filter by keyword overlap
  return templates.filter(t =>
    goalKeywords.some(kw => t.goalPattern.toLowerCase().includes(kw.toLowerCase()))
  );
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

export function retrieveRelevantKnowledge(goal: string, domain?: string): RelevantKnowledge {
  const words = goal.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return {
    selectors: domain ? getSelectorsForDomain(domain) : [],
    lessons: getLessonsForTaskType("click", domain)
      .concat(getLessonsForTaskType("type", domain))
      .concat(getLessonsForTaskType("assert_text", domain)),
    templates: findTemplates(words, domain)
  };
}

function scoreLesson(
  lesson: FailureLessonEntry,
  options: {
    domain?: string;
    hypothesisKind?: string;
  }
): number {
  let score = lesson.successCount * 2;

  if (options.domain && lesson.domain === options.domain) {
    score += 3;
  } else if (!lesson.domain) {
    score += 1;
  }

  if (options.hypothesisKind && lesson.hypothesisKind === options.hypothesisKind) {
    score += 4;
  }

  if (lesson.recoverySequence?.length) {
    score += 1;
  }

  if (lesson.stateTransition) {
    score += 0.5;
  }

  if (lesson.evidenceSummary) {
    score += 0.25;
  }

  return score;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function getKnowledgeStats(): { selectors: number; lessons: number; templates: number } {
  const db = getDb();
  const count = (type: KnowledgeType) =>
    (db.prepare("SELECT COUNT(*) as n FROM knowledge WHERE type=?").get(type) as { n: number }).n;
  return {
    selectors: count("selector_map"),
    lessons: count("failure_lesson"),
    templates: count("task_template")
  };
}

/**
 * Remove low-confidence knowledge entries that haven't been used recently.
 * Returns the number of pruned entries.
 */
export function pruneKnowledge(minConfidence: number = 0.2, maxAgeDays: number = 60): number {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const cutoffStr = cutoff.toISOString();

  const result = db.prepare(
    "DELETE FROM knowledge WHERE confidence < ? AND updated_at < ? AND use_count < 3"
  ).run(minConfidence, cutoffStr);

  return result.changes ?? 0;
}

/**
 * Enforce a maximum number of entries per type.
 * Keeps the highest-confidence entries.
 */
export function enforceKnowledgeCapacity(maxPerType: number = 200): number {
  const db = getDb();
  const types = ["selector_map", "failure_lesson", "task_template"];
  let pruned = 0;

  for (const type of types) {
    const result = db.prepare(
      "DELETE FROM knowledge WHERE type = ? AND id NOT IN (SELECT id FROM knowledge WHERE type = ? ORDER BY confidence DESC, use_count DESC LIMIT ?)"
    ).run(type, type, maxPerType);
    pruned += result.changes ?? 0;
  }

  return pruned;
}
