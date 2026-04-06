/**
 * Benchmark runner — executes multiple goals and reports timing + success data.
 *
 * Usage:
 *   npx tsx tests/e2e/benchmark.ts
 *
 * Exports `runBenchmark()` for programmatic use.
 */

import { runGoal, type RunOptions } from "../../src/core/runtime";
import type { RunContext } from "../../src/types";

interface BenchmarkGoal {
  label: string;
  goal: string;
  options?: RunOptions;
}

interface BenchmarkResult {
  label: string;
  goal: string;
  success: boolean;
  error?: string;
  planTimeMs: number;
  executionTimeMs: number;
  totalDurationMs: number;
  taskCount: number;
  tasksCompleted: number;
  tasksFailed: number;
}

const GOALS: BenchmarkGoal[] = [
  {
    label: "HTTP health check",
    goal: "check health of http://localhost:3000/health",
  },
  {
    label: "Fetch API runs",
    goal: "fetch http://localhost:3000/api/v1/runs?limit=1",
  },
  {
    label: "Shell echo",
    goal: "run command: echo benchmark-test",
  },
  {
    label: "Read file",
    goal: "read file package.json",
  },
  {
    label: "Navigate local",
    goal: "go to http://localhost:3000/health",
  },
  {
    label: "Screenshot local",
    goal: "take screenshot of http://localhost:3000/health",
  },
  {
    label: "Multi-step HTTP",
    goal: "check health of http://localhost:3000/health and then fetch http://localhost:3000/api/v1/queue/stats",
  },
  {
    label: "Shell ls",
    goal: "run command ls -la",
  },
  {
    label: "Read tsconfig",
    goal: "read file tsconfig.json",
  },
  {
    label: "Fetch queue stats",
    goal: "fetch http://localhost:3000/api/v1/queue/stats",
  },
];

function estimatePlanTime(ctx: RunContext): number {
  // Use the first task's startedAt relative to run start as a proxy for plan time
  if (ctx.tasks.length === 0) return 0;
  const firstTask = ctx.tasks[0];
  if (!firstTask.startedAt) return 0;
  // planDecisionTrace has timing info in some builds; fall back to estimation
  const runStart = ctx.tasks.reduce((earliest, t) => {
    if (!t.startedAt) return earliest;
    const ts = new Date(t.startedAt).getTime();
    return ts < earliest ? ts : earliest;
  }, Infinity);
  // If we can't distinguish, report 0
  return runStart === Infinity ? 0 : 0;
}

function estimateExecutionTime(ctx: RunContext): number {
  return ctx.tasks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
}

async function runSingleBenchmark(entry: BenchmarkGoal): Promise<BenchmarkResult> {
  const startMs = performance.now();
  let ctx: RunContext;
  let success = false;
  let error: string | undefined;

  try {
    ctx = await runGoal(entry.goal, entry.options ?? {});
    success = ctx.result?.success ?? false;
    error = ctx.result?.error;
  } catch (err: unknown) {
    const totalDurationMs = Math.round(performance.now() - startMs);
    return {
      label: entry.label,
      goal: entry.goal,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      planTimeMs: 0,
      executionTimeMs: 0,
      totalDurationMs,
      taskCount: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
    };
  }

  const totalDurationMs = Math.round(performance.now() - startMs);
  const executionTimeMs = estimateExecutionTime(ctx);
  const planTimeMs = Math.max(0, totalDurationMs - executionTimeMs);

  return {
    label: entry.label,
    goal: entry.goal,
    success,
    error,
    planTimeMs,
    executionTimeMs,
    totalDurationMs,
    taskCount: ctx.tasks.length,
    tasksCompleted: ctx.tasks.filter((t) => t.status === "done").length,
    tasksFailed: ctx.tasks.filter((t) => t.status === "failed").length,
  };
}

function printSummaryTable(results: BenchmarkResult[]): void {
  const col = {
    label: 22,
    success: 9,
    planMs: 10,
    execMs: 10,
    totalMs: 10,
    tasks: 7,
    error: 30,
  };

  const header = [
    "Label".padEnd(col.label),
    "Success".padEnd(col.success),
    "Plan(ms)".padStart(col.planMs),
    "Exec(ms)".padStart(col.execMs),
    "Total(ms)".padStart(col.totalMs),
    "Tasks".padStart(col.tasks),
    "Error",
  ].join(" | ");

  const separator = "-".repeat(header.length + 10);

  console.log("\n" + separator);
  console.log("  BENCHMARK RESULTS");
  console.log(separator);
  console.log(header);
  console.log(separator);

  for (const r of results) {
    const row = [
      r.label.slice(0, col.label).padEnd(col.label),
      (r.success ? "PASS" : "FAIL").padEnd(col.success),
      String(r.planTimeMs).padStart(col.planMs),
      String(r.executionTimeMs).padStart(col.execMs),
      String(r.totalDurationMs).padStart(col.totalMs),
      `${r.tasksCompleted}/${r.taskCount}`.padStart(col.tasks),
      (r.error ?? "").slice(0, col.error),
    ].join(" | ");
    console.log(row);
  }

  console.log(separator);

  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;
  const avgTotal = Math.round(
    results.reduce((s, r) => s + r.totalDurationMs, 0) / results.length
  );
  const avgExec = Math.round(
    results.reduce((s, r) => s + r.executionTimeMs, 0) / results.length
  );

  console.log(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`  Avg total duration: ${avgTotal}ms | Avg execution: ${avgExec}ms`);
  console.log(separator + "\n");
}

export async function runBenchmark(): Promise<BenchmarkResult[]> {
  console.log(`Running ${GOALS.length} benchmark goals...\n`);
  const results: BenchmarkResult[] = [];

  for (let i = 0; i < GOALS.length; i++) {
    const entry = GOALS[i];
    console.log(`  [${i + 1}/${GOALS.length}] ${entry.label} ...`);
    const result = await runSingleBenchmark(entry);
    console.log(
      `    => ${result.success ? "PASS" : "FAIL"} in ${result.totalDurationMs}ms` +
        (result.error ? ` (${result.error.slice(0, 60)})` : "")
    );
    results.push(result);
  }

  printSummaryTable(results);
  return results;
}

// Run directly when executed as a script
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("benchmark.ts") || process.argv[1].endsWith("benchmark.js"));

if (isDirectRun) {
  runBenchmark()
    .then((results) => {
      const failed = results.filter((r) => !r.success).length;
      process.exit(failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error("Benchmark failed:", err);
      process.exit(2);
    });
}
