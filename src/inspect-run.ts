import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RunContext } from "./types";

async function main(): Promise<void> {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    console.error('Usage: tsx src/inspect-run.ts "<run-json-path>"');
    process.exitCode = 1;
    return;
  }

  const absolutePath = resolve(process.cwd(), inputPath);
  const content = await readFile(absolutePath, "utf-8");
  const run = JSON.parse(content) as RunContext;

  console.log(`Run: ${run.runId}`);
  console.log(`Goal: ${run.goal}`);
  console.log(`Termination: ${run.terminationReason ?? "unknown"}`);
  console.log(`Policy mode: planner=${run.policy?.plannerCostMode ?? "n/a"}, replanner=${run.policy?.replannerCostMode ?? "n/a"}`);
  console.log("");

  console.log("Escalation decisions:");
  console.log(JSON.stringify(run.escalationTrace ?? [], null, 2));
  console.log("");

  console.log("LLM usage rationale:");
  console.log((run.escalationTrace ?? []).map((item) => `[${item.stage}] ${item.llmUsageRationale}`).join("\n") || "none");
  console.log("");

  console.log("Fallback rationale:");
  console.log((run.escalationTrace ?? []).map((item) => `[${item.stage}] ${item.fallbackRationale}`).join("\n") || "none");
  console.log("");

  console.log("Planner decision trace:");
  console.log(JSON.stringify(run.plannerDecisionTrace ?? null, null, 2));
  console.log("");

  console.log("Metrics:");
  console.log(JSON.stringify(run.metrics ?? null, null, 2));
  console.log("");

  console.log("Usage ledger:");
  console.log(JSON.stringify(run.usageLedger ?? null, null, 2));
}

void main();
