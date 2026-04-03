import test from "node:test";
import assert from "node:assert/strict";
import { replanTasks } from "./planner/replanner";
import { RunContext, AgentTask } from "./types";
import { createUsageLedger } from "./observability/usage-ledger";
import { getDb } from "./db/client";
import { initKnowledgeTable, upsertLesson } from "./knowledge/store";

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
    escalationDecisions: []
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

test("replanner smoke: top hypothesis drives rule strategy", async () => {
  const context = baseContext();
  context.hypotheses = [
    {
      id: "hyp-1",
      taskId: "t1",
      kind: "selector_drift",
      explanation: "Selector likely drifted.",
      confidence: 0.91,
      suggestedExperiments: ["check selector presence"],
      recoveryHint: "Prefer visual fallback."
    }
  ];
  const result = await replanTasks({
    context,
    task: clickTask(),
    error: "click failed",
    recentRuns: [],
    failurePatterns: [],
    maxLLMReplannerCalls: 0,
    maxLLMReplannerTimeouts: 1
  });
  assert.equal(result.abort, false);
  assert.equal(result.insertTasks[0]?.type, "visual_click");
});

test("replanner smoke: procedural prior drives rule strategy", async () => {
  initKnowledgeTable();
  getDb().prepare("DELETE FROM knowledge").run();
  upsertLesson({
    taskType: "click",
    errorPattern: "selector not found",
    domain: "app.example.com",
    recovery: "use visual_click",
    successCount: 1,
    hypothesisKind: "selector_drift",
    recoverySequence: ["use visual_click"]
  });

  const context = baseContext();
  context.worldState = {
    runId: context.runId,
    timestamp: new Date().toISOString(),
    appState: "ready",
    pageUrl: "https://app.example.com/dashboard",
    uncertaintyScore: 0.1,
    facts: [],
    source: "state_update",
    reason: "test"
  };
  context.tasks = [clickTask()];
  context.hypotheses = [
    {
      id: "hyp-prior",
      taskId: "t1",
      kind: "selector_drift",
      explanation: "Selector likely drifted.",
      confidence: 0.88,
      suggestedExperiments: ["probe selector"],
      recoveryHint: "Use prior visual fallback."
    }
  ];

  const result = await replanTasks({
    context,
    task: context.tasks[0],
    error: "selector not found",
    recentRuns: [],
    failurePatterns: [],
    maxLLMReplannerCalls: 0,
    maxLLMReplannerTimeouts: 1
  });

  assert.equal(result.abort, false);
  assert.equal(result.insertTasks[0]?.type, "visual_click");
  assert.match(result.reason, /procedural prior/i);
});
