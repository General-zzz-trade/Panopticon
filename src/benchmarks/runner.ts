/**
 * Benchmark Runner — executes all benchmark tasks and produces a score report.
 *
 * Usage: node --import tsx src/benchmarks/runner.ts
 */

import { createServer } from "node:http";
import { runGoal } from "../core/runtime";
import { getBenchmarkTasks, type BenchmarkTask, type TaskDifficulty } from "./tasks";
import { logModuleError } from "../core/module-logger";

interface TaskResult {
  task: BenchmarkTask;
  passed: boolean;
  durationMs: number;
  taskCount: number;
  replanCount: number;
  error?: string;
}

interface BenchmarkReport {
  totalTasks: number;
  passed: number;
  failed: number;
  successRate: number;
  byDifficulty: Record<TaskDifficulty, { total: number; passed: number; rate: number }>;
  byCategory: Record<string, { total: number; passed: number; rate: number }>;
  totalDurationMs: number;
  avgDurationMs: number;
  totalReplans: number;
  results: TaskResult[];
}

async function main(): Promise<void> {
  console.log("=== Agent-Orchestrator Benchmark Suite ===\n");

  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;
  const command = `node --import tsx src/sample-app/server.ts ${port}`;

  const tasks = getBenchmarkTasks(command, url);
  console.log(`Running ${tasks.length} benchmark tasks...\n`);

  const results: TaskResult[] = [];

  for (const task of tasks) {
    // Wait for port release between tasks, then reset app state
    await new Promise(resolve => setTimeout(resolve, 500));
    try { await fetch(`${url}/reset`); } catch (error) { logModuleError("benchmark-runner", "optional", error, "resetting app state between benchmark tasks"); }

    const start = Date.now();
    process.stdout.write(`  ${task.id} ${task.name.padEnd(45)} `);

    try {
      const run = await runGoal(task.goal, {
        maxReplansPerRun: 3,
        maxReplansPerTask: 1
      });

      const passed = task.verify(run);
      const durationMs = Date.now() - start;

      results.push({
        task,
        passed,
        durationMs,
        taskCount: run.tasks.length,
        replanCount: run.replanCount,
        error: passed ? undefined : (run.result?.error ?? run.result?.message)
      });

      console.log(passed ? `\u2713 (${durationMs}ms)` : `\u2717 (${durationMs}ms) ${run.result?.error?.slice(0, 60) ?? ""}`);
    } catch (error) {
      const durationMs = Date.now() - start;
      const msg = error instanceof Error ? error.message : "Unknown error";

      results.push({
        task,
        passed: false,
        durationMs,
        taskCount: 0,
        replanCount: 0,
        error: msg
      });

      console.log(`\u2717 CRASH (${durationMs}ms) ${msg.slice(0, 60)}`);
    }
  }

  // Generate report
  const report = generateReport(results);
  printReport(report);
}

function generateReport(results: TaskResult[]): BenchmarkReport {
  const passed = results.filter(r => r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

  const byDifficulty: Record<string, { total: number; passed: number; rate: number }> = {};
  const byCategory: Record<string, { total: number; passed: number; rate: number }> = {};

  for (const r of results) {
    // By difficulty
    if (!byDifficulty[r.task.difficulty]) {
      byDifficulty[r.task.difficulty] = { total: 0, passed: 0, rate: 0 };
    }
    byDifficulty[r.task.difficulty].total++;
    if (r.passed) byDifficulty[r.task.difficulty].passed++;

    // By category
    if (!byCategory[r.task.category]) {
      byCategory[r.task.category] = { total: 0, passed: 0, rate: 0 };
    }
    byCategory[r.task.category].total++;
    if (r.passed) byCategory[r.task.category].passed++;
  }

  for (const group of [...Object.values(byDifficulty), ...Object.values(byCategory)]) {
    group.rate = group.total > 0 ? group.passed / group.total : 0;
  }

  return {
    totalTasks: results.length,
    passed,
    failed: results.length - passed,
    successRate: results.length > 0 ? passed / results.length : 0,
    byDifficulty: byDifficulty as Record<TaskDifficulty, { total: number; passed: number; rate: number }>,
    byCategory,
    totalDurationMs: totalDuration,
    avgDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    totalReplans: results.reduce((sum, r) => sum + r.replanCount, 0),
    results
  };
}

function printReport(report: BenchmarkReport): void {
  console.log("\n" + "=".repeat(60));
  console.log("BENCHMARK RESULTS");
  console.log("=".repeat(60));

  console.log(`\nOverall: ${report.passed}/${report.totalTasks} passed (${(report.successRate * 100).toFixed(1)}%)`);
  console.log(`Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s total, ${(report.avgDurationMs / 1000).toFixed(1)}s avg`);
  console.log(`Replans: ${report.totalReplans} total`);

  console.log("\nBy Difficulty:");
  const diffOrder: TaskDifficulty[] = ["trivial", "simple", "medium", "complex", "expert"];
  for (const diff of diffOrder) {
    const d = report.byDifficulty[diff];
    if (!d) continue;
    const bar = "\u2588".repeat(Math.round(d.rate * 20)).padEnd(20, "\u2591");
    console.log(`  ${diff.padEnd(10)} ${bar} ${d.passed}/${d.total} (${(d.rate * 100).toFixed(0)}%)`);
  }

  console.log("\nBy Category:");
  for (const [cat, c] of Object.entries(report.byCategory).sort((a, b) => b[1].rate - a[1].rate)) {
    const bar = "\u2588".repeat(Math.round(c.rate * 20)).padEnd(20, "\u2591");
    console.log(`  ${cat.padEnd(12)} ${bar} ${c.passed}/${c.total} (${(c.rate * 100).toFixed(0)}%)`);
  }

  const failures = report.results.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log("\nFailed Tasks:");
    for (const f of failures) {
      console.log(`  \u2717 ${f.task.id} ${f.task.name}: ${f.error?.slice(0, 80) ?? "unknown"}`);
    }
  }

  console.log("\n" + "=".repeat(60));

  // Write JSON report
  const fs = require("fs");
  const path = require("path");
  const reportDir = path.join(process.cwd(), "artifacts");
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "benchmark-report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log("Report saved to artifacts/benchmark-report.json");
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to get port");
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  return addr.port;
}

void main();
