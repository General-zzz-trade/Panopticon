/**
 * Goal-Driven Runtime — master/subagent pattern for long-running objective-driven tasks.
 *
 * Architecture:
 *   1. Master agent holds the goal + success criteria
 *   2. Subagent works continuously on the problem
 *   3. Master periodically checks subagent status
 *   4. When subagent claims done or goes idle, master evaluates against criteria
 *   5. If criteria not met, master commands subagent to continue (with feedback)
 *   6. Loop until criteria satisfied
 *
 * Designed for tasks that may take hundreds of hours:
 *   - Compiler design, theorem proving, system design, EDA simulation
 *   - Any problem with objective, verifiable success criteria
 */

import { runGoal } from "../core/runtime";
import type { RunContext } from "../types";
import type { SuccessCriterion } from "../goal/types";
import { logModuleError } from "../core/module-logger";
import * as fs from "fs";
import * as path from "path";

export interface GoalDrivenTask {
  id: string;
  goal: string;
  criteria: CriterionCheck[];
  maxIterations?: number;
  /** Check subagent status every N ms (default: 30s) */
  supervisionIntervalMs?: number;
  /** Called each time master evaluates */
  onEvaluation?: (iteration: number, passed: boolean, details: string) => void;
  /** Persist state to this directory for crash recovery */
  stateDir?: string;
}

export interface CriterionCheck {
  name: string;
  /** Check function: returns true if criterion is satisfied */
  check: (artifacts: SubagentArtifact[]) => Promise<boolean> | boolean;
  description: string;
}

export interface SubagentArtifact {
  iteration: number;
  goal: string;
  success: boolean;
  summary: string;
  output?: string;
  createdAt: string;
}

export interface GoalDrivenResult {
  taskId: string;
  success: boolean;
  iterations: number;
  totalDurationMs: number;
  criteriaResults: Array<{ name: string; passed: boolean }>;
  artifacts: SubagentArtifact[];
  terminationReason: "criteria_met" | "max_iterations" | "stopped" | "error";
}

// In-memory tracking of running tasks
const activeTasks = new Map<string, { stop: boolean }>();

/**
 * Run a goal-driven task with master/subagent supervision.
 */
export async function runGoalDriven(task: GoalDrivenTask): Promise<GoalDrivenResult> {
  const maxIterations = task.maxIterations ?? 100;
  const startTime = Date.now();
  const artifacts: SubagentArtifact[] = [];
  activeTasks.set(task.id, { stop: false });

  // Restore state from disk if available
  if (task.stateDir) {
    restoreArtifacts(task.stateDir, task.id, artifacts);
  }

  let iteration = artifacts.length;
  let terminationReason: GoalDrivenResult["terminationReason"] = "max_iterations";
  let subagentFeedback = "";

  for (; iteration < maxIterations; iteration++) {
    const taskState = activeTasks.get(task.id);
    if (taskState?.stop) {
      terminationReason = "stopped";
      break;
    }

    // Build goal for subagent — include feedback from master if present
    const subagentGoal = subagentFeedback
      ? `${task.goal}\n\n[Previous attempt feedback from supervisor]: ${subagentFeedback}`
      : task.goal;

    console.log(`[goal-driven] Iteration ${iteration + 1}: subagent working...`);

    // Run subagent
    let subagentContext: RunContext;
    try {
      subagentContext = await runGoal(subagentGoal, { executionMode: "react" });
    } catch (err) {
      logModuleError("goal-driven", "critical", err, `subagent iteration ${iteration}`);
      terminationReason = "error";
      break;
    }

    const artifact: SubagentArtifact = {
      iteration,
      goal: subagentGoal.slice(0, 200),
      success: subagentContext.result?.success ?? false,
      summary: subagentContext.result?.message ?? "",
      output: subagentContext.result?.message,
      createdAt: new Date().toISOString()
    };
    artifacts.push(artifact);

    // Persist state
    if (task.stateDir) {
      persistArtifacts(task.stateDir, task.id, artifacts);
    }

    // Master evaluation: check criteria
    console.log(`[goal-driven] Iteration ${iteration + 1}: master evaluating criteria...`);
    const criteriaResults: Array<{ name: string; passed: boolean; detail: string }> = [];
    let allPassed = true;

    for (const criterion of task.criteria) {
      try {
        const passed = await criterion.check(artifacts);
        criteriaResults.push({ name: criterion.name, passed, detail: criterion.description });
        if (!passed) allPassed = false;
      } catch (err) {
        criteriaResults.push({ name: criterion.name, passed: false, detail: `evaluation error: ${err instanceof Error ? err.message : err}` });
        allPassed = false;
      }
    }

    const detailStr = criteriaResults.map(c => `${c.passed ? "✓" : "✗"} ${c.name}`).join(", ");
    console.log(`[goal-driven] Iteration ${iteration + 1}: ${detailStr}`);

    if (task.onEvaluation) {
      try { task.onEvaluation(iteration + 1, allPassed, detailStr); } catch { /* ignore */ }
    }

    if (allPassed) {
      terminationReason = "criteria_met";
      iteration++;
      break;
    }

    // Build feedback for next iteration
    const failed = criteriaResults.filter(c => !c.passed);
    subagentFeedback = `Criteria not met: ${failed.map(c => `${c.name} (${c.detail})`).join("; ")}. Continue working to satisfy these.`;
  }

  activeTasks.delete(task.id);

  // Final evaluation
  const finalResults: Array<{ name: string; passed: boolean }> = [];
  for (const criterion of task.criteria) {
    try {
      const passed = await criterion.check(artifacts);
      finalResults.push({ name: criterion.name, passed });
    } catch {
      finalResults.push({ name: criterion.name, passed: false });
    }
  }

  return {
    taskId: task.id,
    success: terminationReason === "criteria_met",
    iterations: iteration,
    totalDurationMs: Date.now() - startTime,
    criteriaResults: finalResults,
    artifacts,
    terminationReason
  };
}

/**
 * Stop a running goal-driven task.
 */
export function stopGoalDriven(taskId: string): void {
  const state = activeTasks.get(taskId);
  if (state) state.stop = true;
}

/**
 * List currently running goal-driven tasks.
 */
export function listActiveGoalDrivenTasks(): string[] {
  return Array.from(activeTasks.keys());
}

// ── Criteria builders ──────────────────────────────────────────────────

/**
 * Criterion: at least N successful subagent runs.
 */
export function criterionSuccessCount(count: number): CriterionCheck {
  return {
    name: `at_least_${count}_success`,
    description: `at least ${count} successful iterations`,
    check: (arts) => arts.filter(a => a.success).length >= count
  };
}

/**
 * Criterion: last subagent output contains specific text.
 */
export function criterionOutputContains(text: string): CriterionCheck {
  return {
    name: `output_contains_${text.slice(0, 30)}`,
    description: `output contains "${text}"`,
    check: (arts) => {
      const last = arts[arts.length - 1];
      return last ? (last.output ?? "").toLowerCase().includes(text.toLowerCase()) : false;
    }
  };
}

/**
 * Criterion: custom function on the artifacts.
 */
export function criterionCustom(name: string, description: string, fn: (arts: SubagentArtifact[]) => boolean): CriterionCheck {
  return { name, description, check: fn };
}

// ── Persistence ────────────────────────────────────────────────────────

function persistArtifacts(dir: string, taskId: string, artifacts: SubagentArtifact[]): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${taskId}-state.json`), JSON.stringify(artifacts, null, 2));
  } catch (err) {
    logModuleError("goal-driven", "critical", err, "persisting artifacts");
  }
}

function restoreArtifacts(dir: string, taskId: string, into: SubagentArtifact[]): void {
  try {
    const file = path.join(dir, `${taskId}-state.json`);
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf-8")) as SubagentArtifact[];
      into.push(...saved);
      console.log(`[goal-driven] Restored ${saved.length} artifacts from previous session`);
    }
  } catch (err) {
    logModuleError("goal-driven", "optional", err, "restoring artifacts");
  }
}
