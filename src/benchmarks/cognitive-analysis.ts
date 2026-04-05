/**
 * Cognitive Module Analysis — runs real goals and measures which modules
 * actually fire, their accuracy, and their impact on outcomes.
 *
 * Usage: node --import tsx src/benchmarks/cognitive-analysis.ts
 */

import { runGoal } from "../core/runtime";
import type { RunContext } from "../types";
import type { Goal } from "../goal/types";
import * as fs from "fs";
import * as path from "path";

interface ModuleReport {
  name: string;
  triggered: number;
  totalRuns: number;
  triggerRate: number;
  /** When triggered, did the run succeed? */
  successWhenTriggered: number;
  successRateWhenTriggered: number;
}

interface AnalysisReport {
  timestamp: string;
  totalRuns: number;
  totalSuccess: number;
  successRate: number;
  avgDurationMs: number;
  modules: ModuleReport[];
  perGoal: Array<{
    goal: string;
    success: boolean;
    durationMs: number;
    tasksPlanned: number;
    tasksDone: number;
    replans: number;
    hypotheses: number;
    experiments: number;
    beliefUpdates: number;
    verifications: number;
    verificationsPass: number;
    episodeEvents: number;
    pageType: string;
    goalDifficulty: string;
    criteriaCount: number;
    criteriaMet: number;
    modulesTriggered: string[];
  }>;
}

// Goals covering various scenarios — no API key needed
const ANALYSIS_GOALS = [
  // Simple navigation
  'open page "https://example.com" and assert text "Example Domain" and screenshot',
  // HTTP API
  'http_request "https://httpbin.org/get"',
  // Multiple assertions
  'open page "https://example.com" and assert text "Example Domain" and assert text "More information"',
  // Broken selector (recovery test)
  'open page "https://example.com" and click "#nonexistent-button"',
  // Navigation + assertion
  'open page "https://httpbin.org" and assert text "httpbin" and screenshot',
  // HTTP with specific endpoint
  'http_request "https://httpbin.org/headers"',
];

function extractModulesTrigger(ctx: RunContext): string[] {
  const modules: string[] = [];
  if ((ctx.hypotheses?.length ?? 0) > 0) modules.push("hypothesis-engine");
  if ((ctx.experimentResults?.length ?? 0) > 0) modules.push("experiment-runner");
  if ((ctx.beliefUpdates?.length ?? 0) > 0) modules.push("belief-updater");
  if (ctx.replanCount > 0) modules.push("replanner");

  const events = ctx.episodeEvents ?? [];
  if (events.some(e => e.summary?.includes("Anomaly"))) modules.push("anomaly-detector");
  if (events.some(e => e.summary?.includes("Lookahead"))) modules.push("lookahead");
  if (events.some(e => e.summary?.includes("Meta-cognition"))) modules.push("meta-cognition");
  if (events.some(e => e.summary?.includes("Page model"))) modules.push("page-model");
  if (events.some(e => e.summary?.includes("Proactive exploration"))) modules.push("proactive-explorer");
  if (events.some(e => e.summary?.includes("In-run learning"))) modules.push("online-adapter");
  if (events.some(e => e.summary?.includes("Counterfactual"))) modules.push("counterfactual");
  if (events.some(e => e.summary?.includes("Reflection"))) modules.push("reflection");
  if (events.some(e => e.summary?.includes("visual fallback"))) modules.push("visual-fallback");
  if (events.some(e => e.summary?.includes("Synthesized recovery"))) modules.push("recovery-synthesizer");

  return modules;
}

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  COGNITIVE MODULE ANALYSIS");
  console.log(`${"═".repeat(60)}\n`);
  console.log(`Running ${ANALYSIS_GOALS.length} goals...\n`);

  const perGoal: AnalysisReport["perGoal"] = [];
  const moduleCounters = new Map<string, { triggered: number; successWhenTriggered: number }>();

  for (let i = 0; i < ANALYSIS_GOALS.length; i++) {
    const goal = ANALYSIS_GOALS[i];
    console.log(`[${i + 1}/${ANALYSIS_GOALS.length}] ${goal.slice(0, 70)}...`);

    const start = Date.now();
    let ctx: RunContext;
    try {
      ctx = await runGoal(goal);
    } catch (e) {
      console.log(`  ERROR: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const durationMs = Date.now() - start;
    const success = ctx.result?.success ?? false;
    const modulesTriggered = extractModulesTrigger(ctx);

    const parsedGoal = (ctx as RunContext & { parsedGoal?: Goal }).parsedGoal;
    const pageModel = (ctx as RunContext & { pageModel?: { pageType: string } }).pageModel;

    // Track module counters
    for (const mod of modulesTriggered) {
      const c = moduleCounters.get(mod) ?? { triggered: 0, successWhenTriggered: 0 };
      c.triggered++;
      if (success) c.successWhenTriggered++;
      moduleCounters.set(mod, c);
    }

    const record = {
      goal: goal.slice(0, 100),
      success,
      durationMs,
      tasksPlanned: ctx.tasks.length,
      tasksDone: ctx.tasks.filter(t => t.status === "done").length,
      replans: ctx.replanCount,
      hypotheses: ctx.hypotheses?.length ?? 0,
      experiments: ctx.experimentResults?.length ?? 0,
      beliefUpdates: ctx.beliefUpdates?.length ?? 0,
      verifications: ctx.verificationResults?.length ?? 0,
      verificationsPass: ctx.verificationResults?.filter(v => v.passed).length ?? 0,
      episodeEvents: ctx.episodeEvents?.length ?? 0,
      pageType: pageModel?.pageType ?? "n/a",
      goalDifficulty: parsedGoal?.difficulty ?? "n/a",
      criteriaCount: parsedGoal?.successCriteria?.length ?? 0,
      criteriaMet: 0, // Would need criteria verifier to count
      modulesTriggered
    };
    perGoal.push(record);

    const icon = success ? "✓" : "✗";
    console.log(`  ${icon} ${durationMs}ms | tasks=${record.tasksDone}/${record.tasksPlanned} | replans=${record.replans} | hyp=${record.hypotheses} | page=${record.pageType} | modules=[${modulesTriggered.join(",")}]`);
  }

  // Build report
  const totalSuccess = perGoal.filter(g => g.success).length;
  const avgDuration = perGoal.reduce((s, g) => s + g.durationMs, 0) / (perGoal.length || 1);

  const modules: ModuleReport[] = [];
  for (const [name, c] of moduleCounters) {
    modules.push({
      name,
      triggered: c.triggered,
      totalRuns: perGoal.length,
      triggerRate: c.triggered / perGoal.length,
      successWhenTriggered: c.successWhenTriggered,
      successRateWhenTriggered: c.triggered > 0 ? c.successWhenTriggered / c.triggered : 0
    });
  }
  modules.sort((a, b) => b.triggerRate - a.triggerRate);

  const report: AnalysisReport = {
    timestamp: new Date().toISOString(),
    totalRuns: perGoal.length,
    totalSuccess,
    successRate: totalSuccess / (perGoal.length || 1),
    avgDurationMs: avgDuration,
    modules,
    perGoal
  };

  // Print summary
  console.log(`\n${"═".repeat(60)}`);
  console.log("  RESULTS");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Success rate: ${totalSuccess}/${perGoal.length} (${(report.successRate * 100).toFixed(0)}%)`);
  console.log(`  Avg duration: ${avgDuration.toFixed(0)}ms`);
  console.log();
  console.log("  MODULE TRIGGER RATES:");
  for (const m of modules) {
    const bar = "█".repeat(Math.round(m.triggerRate * 20));
    console.log(`    ${m.name.padEnd(22)} ${bar} ${(m.triggerRate * 100).toFixed(0)}% (${m.triggered}/${m.totalRuns}) | success when active: ${(m.successRateWhenTriggered * 100).toFixed(0)}%`);
  }

  // Save report
  const dir = path.join(process.cwd(), "artifacts", "analysis");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `cognitive-analysis-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(report, null, 2));
  console.log(`\n  Report saved: artifacts/analysis/${filename}`);
}

void main().catch(e => { console.error(e); process.exit(1); });
