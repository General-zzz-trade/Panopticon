/**
 * Protocol-Based Benchmark Runner — runs any BenchmarkProtocol adapter
 * and produces a comparison report.
 *
 * Usage:
 *   node --import tsx src/benchmarks/protocol-runner.ts internal
 *   node --import tsx src/benchmarks/protocol-runner.ts webarena benchmarks/webarena-sample.json
 *   node --import tsx src/benchmarks/protocol-runner.ts compare internal webarena benchmarks/webarena-sample.json
 */

import * as fs from "fs";
import * as path from "path";
import type { BenchmarkProtocol, BenchmarkResult, BenchmarkReport } from "./protocol";
import { createReport } from "./protocol";
import { createInternalAdapter } from "./adapters/internal";
import { createWebArenaAdapter } from "./adapters/webarena";
import type { RunOptions } from "../core/runtime";

// ── Adapter factory ─────────────────────────────────────────────────────

function createAdapter(name: string, args: string[]): BenchmarkProtocol {
  switch (name) {
    case "internal":
      return createInternalAdapter(
        args[0] ?? "node --import tsx src/sample-app/server.ts",
        args[1] ?? "http://localhost:3210"
      );
    case "webarena": {
      const taskFile = args[0] ?? "benchmarks/webarena-sample.json";
      if (!fs.existsSync(taskFile)) {
        throw new Error(`WebArena task file not found: ${taskFile}`);
      }
      return createWebArenaAdapter(taskFile);
    }
    default:
      throw new Error(`Unknown adapter: ${name}. Available: internal, webarena`);
  }
}

// ── Runner ──────────────────────────────────────────────────────────────

async function runBenchmark(
  adapter: BenchmarkProtocol,
  options?: Partial<RunOptions>
): Promise<BenchmarkReport> {
  const tasks = await adapter.loadTasks();
  console.log(`\n[benchmark] ${adapter.name}: ${tasks.length} tasks loaded`);

  const results: BenchmarkResult[] = [];

  for (const task of tasks) {
    const start = Date.now();
    console.log(`  [${task.id}] ${task.name}...`);

    try {
      const context = await adapter.runTask(task, options);
      const result = adapter.evaluateResult(task, context);
      result.durationMs = Date.now() - start;
      results.push(result);
      console.log(`  [${task.id}] ${result.passed ? "PASS" : "FAIL"} (${result.durationMs}ms)${result.error ? ` — ${result.error}` : ""}`);
    } catch (error) {
      const durationMs = Date.now() - start;
      results.push({
        taskId: task.id,
        passed: false,
        durationMs,
        error: error instanceof Error ? error.message : String(error)
      });
      console.log(`  [${task.id}] ERROR (${durationMs}ms) — ${error instanceof Error ? error.message : error}`);
    }
  }

  return adapter.generateReport(results);
}

function printReport(report: BenchmarkReport): void {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${report.suiteName.toUpperCase()} BENCHMARK REPORT`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Total:   ${report.totalTasks}`);
  console.log(`  Passed:  ${report.passed}`);
  console.log(`  Failed:  ${report.failed}`);
  console.log(`  Rate:    ${(report.successRate * 100).toFixed(1)}%`);
  console.log(`  Time:    ${report.totalDurationMs}ms (avg ${report.avgDurationMs.toFixed(0)}ms)`);
  console.log(`${"─".repeat(60)}`);

  for (const r of report.results) {
    const icon = r.passed ? "✓" : "✗";
    console.log(`  ${icon} ${r.taskId} (${r.durationMs}ms)${r.error ? ` — ${r.error.slice(0, 80)}` : ""}`);
  }
  console.log();
}

function saveReport(report: BenchmarkReport): void {
  const dir = path.join(process.cwd(), "artifacts", "benchmarks");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${report.suiteName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(report, null, 2));
  console.log(`[benchmark] Report saved to artifacts/benchmarks/${filename}`);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "internal";

  if (command === "compare") {
    // Compare two adapters
    const adapter1Name = args[1] ?? "internal";
    const adapter2Name = args[2] ?? "webarena";
    const adapter2Args = args.slice(3);

    const adapter1 = createAdapter(adapter1Name, []);
    const adapter2 = createAdapter(adapter2Name, adapter2Args);

    const report1 = await runBenchmark(adapter1);
    const report2 = await runBenchmark(adapter2);

    printReport(report1);
    printReport(report2);

    console.log(`\n${"═".repeat(60)}`);
    console.log("  COMPARISON");
    console.log(`${"═".repeat(60)}`);
    console.log(`  ${adapter1Name}: ${(report1.successRate * 100).toFixed(1)}% (${report1.passed}/${report1.totalTasks})`);
    console.log(`  ${adapter2Name}: ${(report2.successRate * 100).toFixed(1)}% (${report2.passed}/${report2.totalTasks})`);
    console.log(`  Delta: ${((report2.successRate - report1.successRate) * 100).toFixed(1)} percentage points`);

    saveReport(report1);
    saveReport(report2);
  } else {
    // Run single adapter
    const adapter = createAdapter(command, args.slice(1));
    const report = await runBenchmark(adapter);
    printReport(report);
    saveReport(report);
  }
}

void main().catch(e => {
  console.error("[benchmark] Fatal:", e);
  process.exit(1);
});
