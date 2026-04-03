import test from "node:test";
import assert from "node:assert/strict";
import { replanTasks } from "./planner/replanner";
import { createAbortError, delay, jsonResponse, withEnv, withMockedFetch } from "./provider-smoke.utils";
import { createUsageLedger } from "./observability/usage-ledger";
import { AgentTask, RunContext } from "./types";

const providerUrl = "https://provider.test/replanner";

test("replanner smoke: success", async () => {
  await withReplannerEnv(
    500,
    async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tasks: [
                  { type: "wait", payload: { durationMs: 1000 } },
                  { type: "click", payload: { selector: "#login-button" } }
                ]
              })
            }
          }
        ]
      }),
    async () => {
      const context = createContext();
      const task = context.tasks[3]!;
      const decision = await replanTasks({
        context,
        task,
        error: 'click selector "#wrong-button" not found',
        recentRuns: [],
        failurePatterns: [{ taskType: "click", count: 2, latestMessages: ["selector not found"] }],
        maxLLMReplannerCalls: 1,
        maxLLMReplannerTimeouts: 1
      });

      assert.equal(decision.abort, false);
      assert.equal(decision.insertTasks.length, 2);
      assert.match(decision.reason, /LLM replanner/i);
      assert.equal(context.usageLedger?.llmReplannerCalls, 1);
    }
  );
});

test("replanner smoke: timeout", async () => {
  await withReplannerEnv(
    50,
    async (_input, init) => {
      await delay(200);
      if (init?.signal?.aborted) {
        throw createAbortError();
      }
      return jsonResponse({ choices: [] });
    },
    async () => {
      const context = createContext();
      const task = context.tasks[3]!;
      const decision = await replanTasks({
        context,
        task,
        error: 'click selector "#wrong-button" not found',
        recentRuns: [],
        failurePatterns: [{ taskType: "click", count: 2, latestMessages: ["selector not found"] }],
        maxLLMReplannerCalls: 1,
        maxLLMReplannerTimeouts: 1
      });

      assert.equal(decision.abort, false);
      assert.equal(decision.insertTasks.length, 2);
      assert.match(decision.reason, /Rule replanner/i);
      assert.equal(context.usageLedger?.replannerTimeouts, 1);
      assert.equal(context.usageLedger?.replannerFallbacks, 1);
    }
  );
});

test("replanner smoke: empty response", async () => {
  await withReplannerEnv(
    500,
    async () => jsonResponse({ choices: [{ message: { content: "" } }] }),
    async () => {
      const context = createContext();
      const task = context.tasks[3]!;
      const decision = await replanTasks({
        context,
        task,
        error: 'click selector "#wrong-button" not found',
        recentRuns: [],
        failurePatterns: [{ taskType: "click", count: 2, latestMessages: ["selector not found"] }],
        maxLLMReplannerCalls: 1,
        maxLLMReplannerTimeouts: 1
      });

      assert.equal(decision.abort, false);
      assert.match(decision.reason, /Rule replanner/i);
      assert.equal(context.usageLedger?.replannerFallbacks, 1);
    }
  );
});

test("replanner smoke: invalid JSON", async () => {
  await withReplannerEnv(
    500,
    async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "{not-valid-json"
            }
          }
        ]
      }),
    async () => {
      const context = createContext();
      const task = context.tasks[3]!;
      const decision = await replanTasks({
        context,
        task,
        error: 'click selector "#wrong-button" not found',
        recentRuns: [],
        failurePatterns: [{ taskType: "click", count: 2, latestMessages: ["selector not found"] }],
        maxLLMReplannerCalls: 1,
        maxLLMReplannerTimeouts: 1
      });

      assert.equal(decision.abort, false);
      assert.match(decision.reason, /Rule replanner/i);
      assert.equal(context.usageLedger?.replannerFallbacks, 1);
    }
  );
});

test("replanner smoke: low-quality output fallback", async () => {
  await withReplannerEnv(
    500,
    async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tasks: [{ type: "screenshot", payload: { outputPath: "artifacts/replanner-shot.png" } }]
              })
            }
          }
        ]
      }),
    async () => {
      const context = createContext();
      const task = context.tasks[3]!;
      const decision = await replanTasks({
        context,
        task,
        error: 'click selector "#wrong-button" not found',
        recentRuns: [],
        failurePatterns: [{ taskType: "click", count: 2, latestMessages: ["selector not found"] }],
        maxLLMReplannerCalls: 1,
        maxLLMReplannerTimeouts: 1
      });

      assert.equal(decision.abort, false);
      assert.match(decision.reason, /Rule replanner/i);
      assert.equal(context.usageLedger?.replannerFallbacks, 1);
    }
  );
});

async function withReplannerEnv(
  timeoutMs: number,
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response,
  fn: () => Promise<void>
): Promise<void> {
  await withEnv(
    {
      LLM_REPLANNER_PROVIDER: "openai-compatible",
      LLM_REPLANNER_MODEL: "smoke-model",
      LLM_REPLANNER_API_KEY: "test-key",
      LLM_REPLANNER_BASE_URL: providerUrl,
      LLM_REPLANNER_TIMEOUT_MS: String(timeoutMs),
      LLM_REPLANNER_MAX_TOKENS: "200",
      LLM_REPLANNER_TEMPERATURE: "0.1"
    },
    async () => {
      await withMockedFetch(handler, fn);
    }
  );
}

function createContext(): RunContext {
  const usageLedger = createUsageLedger();
  const tasks = [
    createTask("run-smoke-001-start_app", "start_app", { command: "npm run dev" }),
    createTask("run-smoke-002-wait_for_server", "wait_for_server", { url: "http://localhost:3000", timeoutMs: 30000 }),
    createTask("run-smoke-003-open_page", "open_page", { url: "http://localhost:3000" }),
    createTask("run-smoke-004-click", "click", { selector: "#wrong-button" }),
    createTask("run-smoke-005-assert_text", "assert_text", { text: "Dashboard", timeoutMs: 2000 }),
    createTask("run-smoke-006-stop_app", "stop_app", {})
  ];

  return {
    runId: "run-smoke",
    plannerUsed: "template",
    plannerDecisionTrace: {
      candidatePlanners: [],
      chosenPlanner: "template",
      qualitySummary: { complete: true, score: 92, quality: "high", issues: [] },
      qualityScore: 92,
      goalCategory: "explicit",
      policyMode: "balanced",
      escalationDecision: {
        stage: "planner",
        goalCategory: "explicit",
        plannerQuality: "high",
        currentFailureType: "none",
        failurePatterns: [],
        policyMode: "balanced",
        providerHealth: {
          planner: { configured: false, healthy: false, rationale: "n/a" },
          replanner: { configured: false, healthy: false, rationale: "n/a" },
          diagnoser: { configured: false, healthy: false, rationale: "n/a" }
        },
        decision: {
          useRulePlanner: true,
          useLLMPlanner: false,
          useRuleReplanner: false,
          useLLMReplanner: false,
          useRuleDiagnoser: false,
          useLLMDiagnoser: false,
          fallbackToRules: true,
          abortEarly: false,
          rationale: ["seed trace"]
        },
        timestamp: new Date().toISOString()
      },
      llmInvocations: 0,
      llmUsageCap: 0,
      timeoutCount: 0
    },
    plannerTieBreakerPolicy: {
      preferStablePlannerOnTie: true,
      preferRulePlannerOnTie: true,
      preferLowerTaskCountOnTie: true
    },
    policy: {
      mode: "balanced",
      plannerCostMode: "balanced",
      replannerCostMode: "balanced",
      preferRuleSystemsOnCheapGoals: true,
      allowLLMReplannerForSimpleFailures: true
    },
    usageLedger,
    escalationDecisions: [],
    goal: 'start app "npm run dev" and wait for server "http://localhost:3000" and open page "http://localhost:3000" and click "#wrong-button" and assert text "Dashboard" and stop app',
    tasks,
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: tasks.length,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    limits: {
      maxReplansPerRun: 3,
      maxReplansPerTask: 2
    },
    startedAt: new Date().toISOString()
  };
}

function createTask(id: string, type: AgentTask["type"], payload: AgentTask["payload"]): AgentTask {
  return {
    id,
    type,
    status: "pending",
    retries: 0,
    attempts: 0,
    replanDepth: 0,
    payload
  };
}
