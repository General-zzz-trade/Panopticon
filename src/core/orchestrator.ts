/**
 * Multi-Agent Orchestrator
 *
 * Executes a decomposed goal by running each sub-goal as an independent
 * runGoal() call, chaining results sequentially. Each sub-goal gets its
 * own RunContext, planner, executor and knowledge extraction pass.
 *
 * The orchestrator:
 * 1. Decomposes the goal into sub-goals
 * 2. Runs them in order (respecting dependsOn chains)
 * 3. Injects prior results as context into subsequent sub-goals
 * 4. Returns a summary of all sub-runs
 */

import { decomposeGoal } from "../decomposer";
import type { RunOptions } from "./runtime";
import type { RunContext } from "../types";
import { logModuleError } from "./module-logger";

export interface SubRunResult {
  index: number;
  goal: string;
  success: boolean;
  summary: string;
  runId: string;
  durationMs: number;
}

export interface OrchestratorResult {
  decomposed: boolean;
  subGoalCount: number;
  successCount: number;
  failureCount: number;
  subRuns: SubRunResult[];
  overallSuccess: boolean;
  summary: string;
}

export async function orchestrateGoal(
  goal: string,
  options: RunOptions = {}
): Promise<OrchestratorResult> {
  // Lazy import to avoid circular dep — runtime imports orchestrator-aware helpers
  const { runGoal } = await import("./runtime");

  const decomposition = decomposeGoal(goal);

  if (!decomposition.decomposed) {
    // Single goal — run directly
    const ctx = await runGoal(goal, options);
    return singleRunResult(goal, ctx);
  }

  const subRuns: SubRunResult[] = [];
  let priorContext = "";

  for (const subGoal of decomposition.subGoals) {
    // Check if any dependency failed
    const blockedByFailure = subGoal.dependsOn.some(
      depIdx => subRuns[depIdx] && !subRuns[depIdx].success
    );

    if (blockedByFailure) {
      subRuns.push({
        index: subGoal.index,
        goal: subGoal.goal,
        success: false,
        summary: "Skipped: dependency failed",
        runId: "skipped",
        durationMs: 0
      });
      continue;
    }

    // Enrich sub-goal with prior context if available
    const enrichedGoal = priorContext
      ? `${subGoal.goal} (context from previous step: ${priorContext.slice(0, 200)})`
      : subGoal.goal;

    const start = Date.now();
    let ctx: RunContext;
    try {
      ctx = await runGoal(enrichedGoal, options);
    } catch (error) {
      logModuleError("orchestrator", "optional", error, `executing sub-goal: ${subGoal.goal}`);
      subRuns.push({
        index: subGoal.index,
        goal: subGoal.goal,
        success: false,
        summary: "Sub-run threw an unexpected error",
        runId: "error",
        durationMs: Date.now() - start
      });
      continue;
    }

    const success = ctx.result?.success ?? false;
    const summary = ctx.result?.message ?? "";

    subRuns.push({
      index: subGoal.index,
      goal: subGoal.goal,
      success,
      summary,
      runId: ctx.runId,
      durationMs: Date.now() - start
    });

    // Pass a brief context snippet to the next sub-goal
    if (success) {
      priorContext = summary.slice(0, 300);
    }
  }

  const successCount = subRuns.filter(r => r.success).length;
  const failureCount = subRuns.length - successCount;
  const overallSuccess = failureCount === 0;

  const summaryLines = subRuns.map(
    (r, i) => `Step ${i + 1} [${r.success ? "OK" : "FAIL"}]: ${r.goal} — ${r.summary.slice(0, 120)}`
  );

  return {
    decomposed: true,
    subGoalCount: subRuns.length,
    successCount,
    failureCount,
    subRuns,
    overallSuccess,
    summary: summaryLines.join("\n")
  };
}

function singleRunResult(goal: string, ctx: RunContext): OrchestratorResult {
  const success = ctx.result?.success ?? false;
  return {
    decomposed: false,
    subGoalCount: 1,
    successCount: success ? 1 : 0,
    failureCount: success ? 0 : 1,
    subRuns: [{
      index: 0,
      goal,
      success,
      summary: ctx.result?.message ?? "",
      runId: ctx.runId,
      durationMs: ctx.endedAt
        ? new Date(ctx.endedAt).getTime() - new Date(ctx.startedAt).getTime()
        : 0
    }],
    overallSuccess: success,
    summary: ctx.result?.message ?? ""
  };
}
