/**
 * A/B Benchmark Runner — compares baseline (Level-4 disabled) vs full (all enabled).
 *
 * Usage:
 *   npm run eval:ab              # Run baseline vs full comparison
 *   npm run eval:ablation        # Run per-module ablation study
 */

import { createServer } from "node:http";
import { runGoal, type RunOptions } from "../core/runtime";
import { getBenchmarkTasks, type BenchmarkTask, type TaskDifficulty } from "./tasks";
import { getHardBenchmarkTasks } from "./hard-tasks";
import { getExternalBenchmarkTasks } from "./external-tasks";
import {
  BASELINE, FULL, generateAblationProfiles,
  applyProfile, type EvalProfile
} from "./eval-config";
import { logModuleError } from "../core/module-logger";

// ── Types ───────────────────────────────────────────────────────────────────

interface TaskResult {
  taskId: string;
  taskName: string;
  difficulty: TaskDifficulty;
  passed: boolean;
  durationMs: number;
  taskCount: number;
  replanCount: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
  modulesTriggered: string[];
  error?: string;
}

interface ProfileReport {
  profile: string;
  totalTasks: number;
  passed: number;
  failed: number;
  successRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
  totalReplans: number;
  totalTokens: number;
  results: TaskResult[];
}

interface ABReport {
  timestamp: string;
  baseline: ProfileReport;
  full: ProfileReport;
  comparison: {
    successRateDelta: number;
    avgDurationDeltaMs: number;
    replanCountDelta: number;
    tokenUsageDelta: number;
  };
  ablation?: Array<{
    module: string;
    successRate: number;
    deltaFromFull: number;
  }>;
}

// ── Runner ──────────────────────────────────────────────────────────────────

async function runProfile(
  profile: EvalProfile,
  tasks: BenchmarkTask[],
  appUrl: string
): Promise<ProfileReport> {
  const restore = applyProfile(profile);
  const results: TaskResult[] = [];

  try {
    for (const task of tasks) {
      await new Promise(resolve => setTimeout(resolve, 300));
      if (appUrl) { try { await fetch(`${appUrl}/reset`); } catch (error) { logModuleError("ab-runner", "optional", error, "resetting app state between A/B tasks"); } }

      const start = Date.now();
      process.stdout.write(`  [${profile.name}] ${task.id} ${task.name.padEnd(40)} `);

      try {
        const run = await runGoal(task.goal, {
          maxReplansPerRun: 3,
          maxReplansPerTask: 1,
          ...profile.runOptions
        } as RunOptions);

        const passed = task.verify(run);
        const durationMs = Date.now() - start;

        // Extract token usage from usage ledger
        const tokenUsage = {
          inputTokens: run.usageLedger?.totalInputTokens ?? 0,
          outputTokens: run.usageLedger?.totalOutputTokens ?? 0
        };

        // Extract which Level-4 modules were triggered from episode events
        const modulesTriggered = extractTriggeredModules(run);

        results.push({
          taskId: task.id,
          taskName: task.name,
          difficulty: task.difficulty,
          passed,
          durationMs,
          taskCount: run.tasks.length,
          replanCount: run.replanCount,
          tokenUsage,
          modulesTriggered,
          error: passed ? undefined : (run.result?.error ?? run.result?.message)?.slice(0, 200)
        });

        console.log(passed ? `✓ ${durationMs}ms` : `✗ ${durationMs}ms`);
      } catch (error) {
        const durationMs = Date.now() - start;
        const msg = error instanceof Error ? error.message : "Unknown";
        results.push({
          taskId: task.id,
          taskName: task.name,
          difficulty: task.difficulty,
          passed: false,
          durationMs,
          taskCount: 0,
          replanCount: 0,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          modulesTriggered: [],
          error: msg.slice(0, 200)
        });
        console.log(`✗ CRASH ${durationMs}ms`);
      }
    }
  } finally {
    restore();
  }

  const passed = results.filter(r => r.passed).length;
  const totalDuration = results.reduce((s, r) => s + r.durationMs, 0);
  const totalTokens = results.reduce((s, r) => s + r.tokenUsage.inputTokens + r.tokenUsage.outputTokens, 0);

  return {
    profile: profile.name,
    totalTasks: results.length,
    passed,
    failed: results.length - passed,
    successRate: results.length > 0 ? passed / results.length : 0,
    totalDurationMs: totalDuration,
    avgDurationMs: results.length > 0 ? totalDuration / results.length : 0,
    totalReplans: results.reduce((s, r) => s + r.replanCount, 0),
    totalTokens,
    results
  };
}

function extractTriggeredModules(run: any): string[] {
  const modules = new Set<string>();
  const events = run.episodeEvents ?? [];
  for (const ev of events) {
    const summary = String(ev.summary ?? "").toLowerCase();
    if (summary.includes("loop detected")) modules.add("loop_detection");
    if (summary.includes("counterfactual")) modules.add("counterfactual");
    if (summary.includes("synthesized recovery")) modules.add("recovery_synthesis");
    if (summary.includes("proactive exploration")) modules.add("proactive_exploration");
    if (summary.includes("adaptive")) modules.add("adaptive_weights");
    if (summary.includes("thompson")) modules.add("thompson_sampling");
  }
  if (run.plannerDecisionTrace?.chosenPlanner) modules.add("planner:" + run.plannerDecisionTrace.chosenPlanner);
  return [...modules];
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "ab";

  // External mode skips sample app entirely
  let url = "";
  let tasks: BenchmarkTask[] = [];

  if (mode !== "external") {
    const port = await getAvailablePort();
    url = `http://127.0.0.1:${port}`;
    const command = `node --import tsx src/sample-app/server.ts ${port}`;
    if (mode === "hard") {
      tasks = getHardBenchmarkTasks(command, url);
    } else {
      tasks = getBenchmarkTasks(command, url);
    }
  }

  const taskCount = mode === "external" ? getExternalBenchmarkTasks().length : tasks.length;
  console.log(`\n=== Panopticon A/B Evaluation ===`);
  console.log(`Tasks: ${taskCount}, Mode: ${mode}${url ? `, App: ${url}` : ""}\n`);

  if (mode === "ab" || mode === "full" || mode === "hard") {
    // Run baseline
    console.log("─── BASELINE (Level-4 disabled) ───");
    const baselineReport = await runProfile(BASELINE, tasks, url);

    // Run full
    console.log("\n─── FULL (Level-4 enabled) ───");
    const fullReport = await runProfile(FULL, tasks, url);

    const report: ABReport = {
      timestamp: new Date().toISOString(),
      baseline: baselineReport,
      full: fullReport,
      comparison: {
        successRateDelta: fullReport.successRate - baselineReport.successRate,
        avgDurationDeltaMs: fullReport.avgDurationMs - baselineReport.avgDurationMs,
        replanCountDelta: fullReport.totalReplans - baselineReport.totalReplans,
        tokenUsageDelta: fullReport.totalTokens - baselineReport.totalTokens
      }
    };

    // Optional ablation
    if (mode === "full") {
      console.log("\n─── ABLATION (one module disabled at a time) ───");
      const ablationProfiles = generateAblationProfiles();
      report.ablation = [];
      for (const profile of ablationProfiles) {
        const ablationReport = await runProfile(profile, tasks, url);
        report.ablation.push({
          module: profile.name.replace("ablation-no-", ""),
          successRate: ablationReport.successRate,
          deltaFromFull: fullReport.successRate - ablationReport.successRate
        });
      }
    }

    printComparison(report);
    saveReport(report);
  } else if (mode === "external") {
    // External mode: run against real public websites, no sample app needed
    const externalTasks = getExternalBenchmarkTasks();
    console.log(`\n─── EXTERNAL (real websites, ${externalTasks.length} tasks) ───`);
    const fullReport = await runProfile(FULL, externalTasks, "");

    console.log("\n" + "═".repeat(60));
    console.log("  EXTERNAL WEBSITE RESULTS");
    console.log("═".repeat(60));
    console.log(`  Total: ${fullReport.totalTasks}  Passed: ${fullReport.passed}  Failed: ${fullReport.failed}`);
    console.log(`  Success Rate: ${(fullReport.successRate * 100).toFixed(1)}%`);
    console.log(`  Avg Duration: ${(fullReport.avgDurationMs / 1000).toFixed(1)}s`);
    console.log(`  Total Tokens: ${fullReport.totalTokens}`);

    // Per-difficulty breakdown
    const diffs: TaskDifficulty[] = ["trivial", "simple", "medium", "complex", "expert"];
    for (const d of diffs) {
      const dTasks = fullReport.results.filter(r => r.difficulty === d);
      if (dTasks.length === 0) continue;
      const rate = dTasks.filter(r => r.passed).length / dTasks.length;
      console.log(`    ${d.padEnd(10)} ${(rate * 100).toFixed(0).padStart(4)}%  (${dTasks.length} tasks)`);
    }

    // Show failures
    const failures = fullReport.results.filter(r => !r.passed);
    if (failures.length > 0) {
      console.log("\n  Failures:");
      for (const f of failures) {
        console.log(`    ${f.taskId} ${f.taskName}: ${f.error ?? "unknown"}`);
      }
    }
    console.log("═".repeat(60));

    saveReport({ timestamp: new Date().toISOString(), baseline: fullReport, full: fullReport, comparison: { successRateDelta: 0, avgDurationDeltaMs: 0, replanCountDelta: 0, tokenUsageDelta: 0 } });
  } else {
    console.log(`Unknown mode: ${mode}. Use "ab", "full", or "external".`);
  }
}

function printComparison(report: ABReport): void {
  const b = report.baseline;
  const f = report.full;
  const c = report.comparison;
  const sign = (n: number) => n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);

  console.log("\n" + "═".repeat(60));
  console.log("  A/B COMPARISON");
  console.log("═".repeat(60));
  console.log(`${"".padEnd(24)} ${"Baseline".padStart(10)} ${"Full".padStart(10)} ${"Delta".padStart(10)}`);
  console.log(`${"Success Rate".padEnd(24)} ${(b.successRate * 100).toFixed(1).padStart(9)}% ${(f.successRate * 100).toFixed(1).padStart(9)}% ${sign(c.successRateDelta * 100).padStart(9)}%`);
  console.log(`${"Avg Duration".padEnd(24)} ${(b.avgDurationMs / 1000).toFixed(1).padStart(9)}s ${(f.avgDurationMs / 1000).toFixed(1).padStart(9)}s ${sign(c.avgDurationDeltaMs / 1000).padStart(9)}s`);
  console.log(`${"Total Replans".padEnd(24)} ${String(b.totalReplans).padStart(10)} ${String(f.totalReplans).padStart(10)} ${sign(c.replanCountDelta).padStart(10)}`);
  console.log(`${"Total Tokens".padEnd(24)} ${String(b.totalTokens).padStart(10)} ${String(f.totalTokens).padStart(10)} ${sign(c.tokenUsageDelta).padStart(10)}`);

  if (report.ablation && report.ablation.length > 0) {
    console.log("\n  Module Impact (ablation — positive = module helps):");
    for (const a of report.ablation.sort((x, y) => y.deltaFromFull - x.deltaFromFull)) {
      const bar = a.deltaFromFull > 0 ? "█".repeat(Math.min(20, Math.round(a.deltaFromFull * 100))) : "·";
      console.log(`    ${a.module.padEnd(25)} ${sign(a.deltaFromFull * 100).padStart(6)}%  ${bar}`);
    }
  }

  // Per-difficulty breakdown
  console.log("\n  By Difficulty:");
  const diffs: TaskDifficulty[] = ["trivial", "simple", "medium", "complex", "expert"];
  for (const d of diffs) {
    const bTasks = b.results.filter(r => r.difficulty === d);
    const fTasks = f.results.filter(r => r.difficulty === d);
    if (bTasks.length === 0) continue;
    const bRate = bTasks.filter(r => r.passed).length / bTasks.length;
    const fRate = fTasks.filter(r => r.passed).length / fTasks.length;
    console.log(`    ${d.padEnd(10)} ${(bRate * 100).toFixed(0).padStart(4)}% → ${(fRate * 100).toFixed(0).padStart(4)}%  (${sign((fRate - bRate) * 100)}%)`);
  }

  console.log("═".repeat(60));
}

function saveReport(report: ABReport): void {
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(process.cwd(), "artifacts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filepath = path.join(dir, "ab-report.json");
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to ${filepath}`);
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
