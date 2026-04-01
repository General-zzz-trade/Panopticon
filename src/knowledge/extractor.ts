/**
 * Knowledge Extractor — derives learnings from completed RunContext objects
 * and persists them in the knowledge store for future runs.
 *
 * Three extraction passes per run:
 * 1. Successful selectors from done click/type/hover/select tasks
 * 2. Failure lessons from failed tasks that were later recovered
 * 3. Task templates from high-quality successful runs (score ≥ 80)
 */

import type { AgentTask, RunContext } from "../types";
import { upsertLesson, upsertSelector, upsertTemplate } from "./store";
import type { TaskBlueprint } from "../planner/task-id";

/**
 * Extract and persist knowledge from a completed run.
 * Safe to call on failed runs — only high-confidence data is stored.
 */
export function extractKnowledgeFromRun(context: RunContext): void {
  try {
    const domain = extractDomain(context);
    extractSelectors(context, domain);
    extractFailureLessons(context, domain);
    extractTaskTemplate(context, domain);
  } catch {
    // Never let extraction errors surface to callers
  }
}

// ── Domain ────────────────────────────────────────────────────────────────────

function extractDomain(context: RunContext): string {
  // Try to pull domain from first open_page task
  const openPage = context.tasks.find(t => t.type === "open_page");
  if (openPage?.payload.url) {
    try {
      return new URL(String(openPage.payload.url)).host;
    } catch {
      // fall through
    }
  }
  return "";
}

// ── Selector extraction ───────────────────────────────────────────────────────

const SELECTOR_TASK_TYPES = new Set(["click", "type", "hover", "select"]);

function extractSelectors(context: RunContext, domain: string): void {
  if (!domain) return;

  for (const task of context.tasks) {
    if (!SELECTOR_TASK_TYPES.has(task.type)) continue;
    const selector = task.payload.selector as string | undefined;
    if (!selector) continue;

    const success = task.status === "done";
    const description = inferDescription(task);

    upsertSelector({
      domain,
      description,
      selector,
      successCount: success ? 1 : 0,
      failureCount: success ? 0 : 1
    });
  }
}

function inferDescription(task: AgentTask): string {
  const selector = String(task.payload.selector ?? "");
  if (selector.startsWith("#")) return `element with id "${selector.slice(1)}"`;
  if (selector.startsWith(".")) return `element with class "${selector.slice(1)}"`;
  if (selector.startsWith("[data-testid=")) {
    const match = selector.match(/\[data-testid="?([^"\]]+)"?\]/);
    if (match) return `${task.type} target "${match[1]}"`;
  }
  return `${task.type} target "${selector}"`;
}

// ── Failure lesson extraction ─────────────────────────────────────────────────

function extractFailureLessons(context: RunContext, domain: string): void {
  // Build a set of task ids that were succeeded by a replan recovery
  const recoveredTaskTypes = new Set<string>();
  for (const task of context.tasks) {
    if (task.replanDepth > 0 && task.status === "done") {
      recoveredTaskTypes.add(task.type);
    }
  }

  for (const task of context.tasks) {
    if (task.status !== "failed") continue;
    if (!task.errorHistory?.length) continue;

    const errorPattern = shortenError(task.errorHistory[task.errorHistory.length - 1]);
    if (!errorPattern) continue;

    // Did a replan recovery of the same task type succeed?
    const recovered = recoveredTaskTypes.has(task.type);
    const recoveryHint = inferRecovery(context, task);

    upsertLesson({
      taskType: task.type,
      errorPattern,
      domain: domain || undefined,
      recovery: recoveryHint,
      successCount: recovered ? 1 : 0
    });
  }
}

/** Truncate error to a recognizable ~80-char fingerprint */
function shortenError(error: string): string {
  return error.replace(/\s+/g, " ").slice(0, 80).trim();
}

function inferRecovery(context: RunContext, failedTask: AgentTask): string {
  // Look for the inserted task that followed this one (depth+1)
  const failedIndex = context.tasks.indexOf(failedTask);
  if (failedIndex === -1) return "unknown";

  const nextTasks = context.tasks.slice(failedIndex + 1);
  const recoveryTask = nextTasks.find(t => t.replanDepth > 0);

  if (!recoveryTask) return "abort";
  if (recoveryTask.type === "visual_click") return "use visual_click";
  if (recoveryTask.type === "wait") return `add wait ${recoveryTask.payload.durationMs ?? 1000}ms`;
  if (recoveryTask.type === failedTask.type) return `retry ${recoveryTask.type}`;
  return `fallback to ${recoveryTask.type}`;
}

// ── Task template extraction ──────────────────────────────────────────────────

function extractTaskTemplate(context: RunContext, domain: string): void {
  if (context.result?.success !== true) return;

  const qualityScore = context.plannerDecisionTrace?.qualitySummary.score ?? 0;
  if (qualityScore < 80) return;

  // Only original tasks (no replan insertions)
  const originalTasks = context.tasks.filter(t => t.replanDepth === 0);
  if (originalTasks.length < 2) return;

  const blueprints: TaskBlueprint[] = originalTasks.map(t => ({
    type: t.type,
    payload: t.payload
  }));

  const goalPattern = deriveGoalPattern(context.goal);
  const tasksSummary = originalTasks.map(t => t.type).join(" → ");

  upsertTemplate({
    goalPattern,
    domain: domain || undefined,
    tasksSummary,
    tasksJson: JSON.stringify(blueprints),
    successCount: 1
  });
}

/**
 * Normalize a goal string into a stable pattern key.
 * Strips URLs, quotes, and lowercases.
 */
function deriveGoalPattern(goal: string): string {
  return goal
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, "<url>")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
