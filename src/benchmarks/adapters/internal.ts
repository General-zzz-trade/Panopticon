/**
 * Internal Benchmark Adapter — wraps the existing tasks.ts / hard-tasks.ts
 * behind the BenchmarkProtocol interface.
 */

import { runGoal, type RunOptions } from "../../core/runtime";
import type { RunContext } from "../../types";
import { getBenchmarkTasks, type BenchmarkTask } from "../tasks";
import { getHardBenchmarkTasks } from "../hard-tasks";
import type { BenchmarkProtocol, BenchmarkTaskSpec, BenchmarkResult } from "../protocol";
import { createReport } from "../protocol";

export function createInternalAdapter(appCommand: string, appUrl: string): BenchmarkProtocol {
  // Cache the verify functions by task id since they can't be serialized
  const verifyMap = new Map<string, (result: any) => boolean>();

  return {
    name: "internal",

    async loadTasks(): Promise<BenchmarkTaskSpec[]> {
      const tasks = [
        ...getBenchmarkTasks(appCommand, appUrl),
        ...getHardBenchmarkTasks(appCommand, appUrl)
      ];
      for (const t of tasks) {
        verifyMap.set(t.id, t.verify);
      }
      return tasks.map(t => ({
        id: t.id,
        name: t.name,
        difficulty: t.difficulty,
        category: t.category,
        goal: t.goal,
        metadata: { description: t.description }
      }));
    },

    async runTask(task: BenchmarkTaskSpec, runOptions?: Partial<RunOptions>): Promise<RunContext> {
      return runGoal(task.goal, runOptions ?? {});
    },

    evaluateResult(task: BenchmarkTaskSpec, context: RunContext): BenchmarkResult {
      const verify = verifyMap.get(task.id);
      const passed = verify ? verify(context) : (context.result?.success === true);
      return {
        taskId: task.id,
        passed,
        durationMs: context.metrics?.averageTaskDurationMs
          ? context.metrics.averageTaskDurationMs * (context.metrics.totalTasks || 1)
          : 0,
        context,
        error: context.result?.error
      };
    },

    generateReport(results: BenchmarkResult[]) {
      return createReport("internal", results);
    }
  };
}
