import { createServer } from "node:http";
import { runGoal } from "../core/runtime";
import { PlannerMode } from ".";

interface PlannerStats {
  runs: number;
  successes: number;
  totalTaskCount: number;
  totalReplans: number;
  totalRetries: number;
  totalQualityScore: number;
  llmInvocations: number;
  timeoutCount: number;
  fallbackCount: number;
  chosenCounts: Record<string, number>;
  ledgerPlannerCalls: number;
  ledgerReplannerCalls: number;
  ledgerDiagnoserCalls: number;
}

interface RecoveryStats {
  runs: number;
  recoveries: number;
  totalInsertedTasks: number;
  totalRetries: number;
  llmUsageByScenario: Record<string, number>;
  fallbackCountByScenario: Record<string, number>;
}

type RecoveryScenario = "selector mismatch" | "delayed success" | "near-match assert" | "multi-step recovery" | "no safe recovery";

type Category = "explicit" | "semi-natural" | "ambiguous";

async function main(): Promise<void> {
  await runPlanningBenchmark();
  await runRecoveryBenchmark();
}

async function runPlanningBenchmark(): Promise<void> {
  const planners: PlannerMode[] = ["auto", "template", "regex", "llm"];
  const stats = new Map<string, PlannerStats>();
  const categories: Category[] = ["explicit", "semi-natural", "ambiguous"];

  for (const category of categories) {
    for (const planner of planners) {
      stats.set(`${category}:${planner}`, createEmptyPlannerStats());
    }
  }

  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;
  const command = `tsx src/sample-app/server.ts ${port}`;

  const goals: Array<{ category: Category; goal: string }> = [
    {
      category: "explicit",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and assert text "Logged out" and stop app`
    },
    {
      category: "explicit",
      goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#login-button" and assert text "Dashboard" and screenshot to artifacts/benchmark-login.png and stop app`
    },
    {
      category: "semi-natural",
      goal: `launch local app using "${command}" then wait until "${url}" is ready and open "${url}" and press delayed login and confirm "Dashboard" appears then capture screenshot and stop app`
    },
    {
      category: "semi-natural",
      goal: `use "${command}" to boot the app, make sure "${url}" is reachable, visit it, hit the delayed login button, verify the dashboard text, and save a screenshot`
    },
    {
      category: "ambiguous",
      goal: `boot app "${command}" and when "${url}" responds go there, make delayed login work, prove dashboard shows up, capture it, then shut everything down`
    },
    {
      category: "ambiguous",
      goal: `start whatever is needed with "${command}", get to "${url}", complete login, verify success, and leave evidence`
    }
  ];

  for (const planner of planners) {
    for (const item of goals) {
      if (planner === "llm" && !process.env.LLM_PLANNER_PROVIDER) {
        continue;
      }

      const run = await runGoal(item.goal, {
        plannerMode: planner,
        maxReplansPerRun: 2,
        maxReplansPerTask: 1,
        maxLLMPlannerCalls: planner === "auto" || planner === "llm" ? 1 : 0
      });

      const entry = stats.get(`${item.category}:${planner}`);
      if (!entry) {
        continue;
      }

      entry.runs += 1;
      entry.successes += run.result?.success ? 1 : 0;
      entry.totalTaskCount += run.tasks.length;
      entry.totalReplans += run.metrics?.totalReplans ?? 0;
      entry.totalRetries += run.metrics?.totalRetries ?? 0;
      entry.totalQualityScore += run.plannerDecisionTrace?.qualityScore ?? 0;
      entry.llmInvocations += run.plannerDecisionTrace?.llmInvocations ?? 0;
      entry.timeoutCount += run.plannerDecisionTrace?.timeoutCount ?? 0;
      entry.fallbackCount += run.plannerDecisionTrace?.fallbackReason ? 1 : 0;
      entry.ledgerPlannerCalls += run.usageLedger?.llmPlannerCalls ?? 0;
      entry.ledgerReplannerCalls += run.usageLedger?.llmReplannerCalls ?? 0;
      entry.ledgerDiagnoserCalls += run.usageLedger?.llmDiagnoserCalls ?? 0;

      const chosenPlanner = run.plannerDecisionTrace?.chosenPlanner ?? "none";
      entry.chosenCounts[chosenPlanner] = (entry.chosenCounts[chosenPlanner] ?? 0) + 1;
    }
  }

  console.log("planning benchmark:");
  for (const category of categories) {
    console.log(`${category}:`);
    for (const planner of planners) {
      const entry = stats.get(`${category}:${planner}`);
      if (!entry || entry.runs === 0) {
        console.log(`  ${planner}: skipped`);
        continue;
      }

      console.log(`  ${planner}:`);
      console.log(`    planner chosen: ${formatChosenCounts(entry.chosenCounts)}`);
      console.log(`    success rate: ${(entry.successes / entry.runs).toFixed(2)}`);
      console.log(`    average quality score: ${(entry.totalQualityScore / entry.runs).toFixed(2)}`);
      console.log(`    average task count: ${(entry.totalTaskCount / entry.runs).toFixed(2)}`);
      console.log(`    average replans: ${(entry.totalReplans / entry.runs).toFixed(2)}`);
      console.log(`    average retries: ${(entry.totalRetries / entry.runs).toFixed(2)}`);
      console.log(`    llm invocation count: ${entry.llmInvocations}`);
      console.log(`    timeout count: ${entry.timeoutCount}`);
      console.log(`    fallback count: ${entry.fallbackCount}`);
      console.log(`    usage ledger summary: planner=${entry.ledgerPlannerCalls}, replanner=${entry.ledgerReplannerCalls}, diagnoser=${entry.ledgerDiagnoserCalls}`);
    }
  }
}

async function runRecoveryBenchmark(): Promise<void> {
  const scenarios: Array<{ name: RecoveryScenario; goal: string }> = [];
  const port = await getAvailablePort();
  const url = `http://127.0.0.1:${port}`;
  const command = `tsx src/sample-app/server.ts ${port}`;

  scenarios.push({ name: "selector mismatch", goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#wrong-button" and assert text "Dashboard" and stop app` });
  scenarios.push({ name: "delayed success", goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#delayed-login-button" and assert text "Dashboard" and stop app` });
  scenarios.push({ name: "near-match assert", goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#login-button" and assert text "Dashbord" and stop app` });
  scenarios.push({ name: "multi-step recovery", goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and click "#wrong-button" and assert text "Wrong Dashboard" timeout 1 second and stop app` });
  scenarios.push({ name: "no safe recovery", goal: `start app "${command}" and wait for server "${url}" and open page "${url}" and assert text "Never Appears" timeout 1 second and stop app` });

  const stats: RecoveryStats = { runs: 0, recoveries: 0, totalInsertedTasks: 0, totalRetries: 0, llmUsageByScenario: {}, fallbackCountByScenario: {} };

  for (const scenario of scenarios) {
    const run = await runGoal(scenario.goal, {
      plannerMode: "auto",
      maxReplansPerRun: 2,
      maxReplansPerTask: 1,
      maxLLMPlannerCalls: 0,
      maxLLMReplannerCalls: process.env.LLM_REPLANNER_PROVIDER ? 1 : 0,
      maxLLMReplannerTimeouts: 1
    });

    stats.runs += 1;
    stats.recoveries += run.result?.success ? 1 : 0;
    stats.totalInsertedTasks += run.insertedTaskCount;
    stats.totalRetries += run.metrics?.totalRetries ?? 0;
    stats.llmUsageByScenario[scenario.name] = run.usageLedger?.llmReplannerCalls ?? 0;
    stats.fallbackCountByScenario[scenario.name] = run.usageLedger?.replannerFallbacks ?? 0;
  }

  console.log("\nrecovery benchmark:");
  console.log(`  recovery success rate: ${(stats.recoveries / Math.max(stats.runs, 1)).toFixed(2)}`);
  console.log(`  llm usage by scenario: ${JSON.stringify(stats.llmUsageByScenario)}`);
  console.log(`  fallback count by scenario: ${JSON.stringify(stats.fallbackCountByScenario)}`);
  console.log(`  average inserted tasks: ${(stats.totalInsertedTasks / Math.max(stats.runs, 1)).toFixed(2)}`);
  console.log(`  average retries: ${(stats.totalRetries / Math.max(stats.runs, 1)).toFixed(2)}`);
}

function createEmptyPlannerStats(): PlannerStats {
  return {
    runs: 0,
    successes: 0,
    totalTaskCount: 0,
    totalReplans: 0,
    totalRetries: 0,
    totalQualityScore: 0,
    llmInvocations: 0,
    timeoutCount: 0,
    fallbackCount: 0,
    chosenCounts: {},
    ledgerPlannerCalls: 0,
    ledgerReplannerCalls: 0,
    ledgerDiagnoserCalls: 0
  };
}

function formatChosenCounts(chosenCounts: Record<string, number>): string {
  const entries = Object.entries(chosenCounts);
  if (entries.length === 0) {
    return "none";
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([planner, count]) => `${planner}=${count}`)
    .join(", ");
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate a benchmark port.");
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  return address.port;
}

void main();
