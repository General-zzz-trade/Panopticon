/**
 * CLI parallel command — multi-agent parallel goal execution.
 * Decomposes a goal into independent sub-goals and dispatches
 * them as parallel workers via the job queue.
 *
 * Usage: npm run dev -- --parallel "test login, registration, and profile"
 */

import { Logger } from "../logger";
import { runGoal } from "../core/runtime";
import {
  planCoordination,
  getReadyWorkers,
  completeWorker,
  isCoordinationComplete,
  generateReport,
  type CoordinationPlan,
  type WorkerResult
} from "./coordinator";

export async function runParallelGoal(goal: string, logger: Logger): Promise<void> {
  const plan = planCoordination(goal);

  if (plan.strategy === "single") {
    logger.info("Goal does not decompose into parallel sub-goals. Running as single goal.");
    const run = await runGoal(goal);
    console.log(run.result?.message ?? "Done.");
    return;
  }

  logger.info(`Coordination plan: ${plan.strategy} strategy, ${plan.workers.length} workers`);
  for (const worker of plan.workers) {
    logger.info(`  ${worker.id}: ${worker.goal}`);
  }

  const startTime = Date.now();

  // Execute workers in dependency order, parallelizing where possible
  while (!isCoordinationComplete(plan)) {
    const ready = getReadyWorkers(plan);

    if (ready.length === 0) {
      // All remaining workers are blocked by failed dependencies
      break;
    }

    logger.info(`Dispatching ${ready.length} worker(s) in parallel`);

    // Mark as running
    for (const worker of ready) {
      worker.status = "running";
      worker.assignedAt = new Date().toISOString();
    }

    // Run all ready workers in parallel
    const results = await Promise.allSettled(
      ready.map(async (worker) => {
        const workerStart = Date.now();
        try {
          const run = await runGoal(worker.goal);
          const result: WorkerResult = {
            success: run.result?.success ?? false,
            summary: run.result?.message ?? "",
            artifacts: run.artifacts.map(a => a.path),
            durationMs: Date.now() - workerStart
          };
          completeWorker(plan, worker.id, result);
          return { workerId: worker.id, result };
        } catch (error) {
          const result: WorkerResult = {
            success: false,
            summary: error instanceof Error ? error.message : "Unknown error",
            artifacts: [],
            durationMs: Date.now() - workerStart
          };
          completeWorker(plan, worker.id, result);
          return { workerId: worker.id, result };
        }
      })
    );

    // Log results
    for (const settled of results) {
      if (settled.status === "fulfilled") {
        const { workerId, result } = settled.value;
        const status = result.success ? "✓" : "✗";
        logger.info(`  ${status} ${workerId}: ${result.summary.slice(0, 100)} (${result.durationMs}ms)`);
      }
    }
  }

  const report = generateReport(plan);
  console.log("\n=== Coordination Report ===");
  console.log(report.summary);
  console.log(`\nTotal duration: ${Date.now() - startTime}ms`);
}
