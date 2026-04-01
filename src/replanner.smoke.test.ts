import test from "node:test";
import assert from "node:assert/strict";
import { replanTasks } from "./planner/replanner";
import { RunContext, AgentTask } from "./types";
import { createUsageLedger } from "./usage-ledger";

function baseContext(): RunContext {
  return {
    runId: "smoke-replanner",
    goal: "login",
    tasks: [],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    usageLedger: createUsageLedger(),
    escalationTrace: []
  };
}
function clickTask(): AgentTask { return { id: "t1", type: "click", status: "failed", retries: 0, attempts: 1, replanDepth: 0, payload: { selector: "#wrong-button" }, errorHistory: ["not found"] }; }

test("replanner smoke: success", async () => {
  process.env.LLM_REPLANNER_PROVIDER = "mock";
  const context = baseContext();
  context.tasks = [clickTask()];
  const result = await replanTasks({ context, task: context.tasks[0], error: "selector not found", recentRuns: [], failurePatterns: [], maxLLMReplannerCalls: 1, maxLLMReplannerTimeouts: 1 });
  assert.equal(result.abort, false);
  assert.ok(result.insertTasks.length > 0);
  delete process.env.LLM_REPLANNER_PROVIDER;
});

test("replanner smoke: timeout", async () => {
  const context = baseContext();
  const result = await replanTasks({ context, task: clickTask(), error: "timed out", recentRuns: [], failurePatterns: [], maxLLMReplannerCalls: 0, maxLLMReplannerTimeouts: 1 });
  assert.equal(result.abort, false);
});

test("replanner smoke: empty response", async () => {
  process.env.LLM_REPLANNER_PROVIDER = "mock";
  const context = baseContext();
  const task = { ...clickTask(), payload: { selector: "#unknown" } };
  const result = await replanTasks({ context, task, error: "unknown issue", recentRuns: [], failurePatterns: [], maxLLMReplannerCalls: 1, maxLLMReplannerTimeouts: 1 });
  assert.ok(result.reason.includes("Rule replanner") || result.abort);
  delete process.env.LLM_REPLANNER_PROVIDER;
});

test("replanner smoke: invalid json", async () => {
  const context = baseContext();
  process.env.LLM_REPLANNER_PROVIDER = "openai-compatible";
  const result = await replanTasks({ context, task: clickTask(), error: "invalid json", recentRuns: [], failurePatterns: [], maxLLMReplannerCalls: 1, maxLLMReplannerTimeouts: 1 });
  assert.ok(result.reason.length > 0);
  delete process.env.LLM_REPLANNER_PROVIDER;
});

test("replanner smoke: low-quality fallback", async () => {
  process.env.LLM_REPLANNER_PROVIDER = "mock";
  const context = baseContext();
  const result = await replanTasks({ context, task: clickTask(), error: "visible timeout", recentRuns: [], failurePatterns: [{ taskType: "click", count: 4, latestMessages: ["timeout"] }], maxLLMReplannerCalls: 1, maxLLMReplannerTimeouts: 1 });
  assert.ok(result.reason.includes("replanner"));
  delete process.env.LLM_REPLANNER_PROVIDER;
});
