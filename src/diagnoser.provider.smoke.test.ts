import test from "node:test";
import assert from "node:assert/strict";
import { reflectOnRun } from "./core/reflector";
import { createAbortError, delay, jsonResponse, withEnv, withMockedFetch } from "./provider-smoke.utils";
import { createUsageLedger } from "./observability/usage-ledger";
import { AgentTask, RunContext } from "./types";

const providerUrl = "https://provider.test/diagnoser";

test("diagnoser smoke: success", async () => {
  await withDiagnoserEnv(
    500,
    async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                diagnosis: "Provider diagnosis: login flow depends on a delayed readiness check.",
                topRisks: ["Login selector is unstable"],
                suggestedNextImprovements: ["Add a readiness wait before the assertion"]
              })
            }
          }
        ]
      }),
    async () => {
      const run = createRun();
      const reflection = await reflectOnRun(run);

      assert.match(reflection.diagnosis, /Provider diagnosis:/);
      assert.equal(run.usageLedger?.llmDiagnoserCalls, 1);
    }
  );
});

test("diagnoser smoke: timeout", async () => {
  await withDiagnoserEnv(
    50,
    async (_input, init) => {
      await delay(200);
      if (init?.signal?.aborted) {
        throw createAbortError();
      }
      return jsonResponse({ choices: [] });
    },
    async () => {
      const run = createRun();
      const reflection = await reflectOnRun(run);

      assert.match(reflection.diagnosis, /Run diagnosis:/);
      assert.equal(run.usageLedger?.llmDiagnoserCalls, 1);
      assert.equal(run.usageLedger?.diagnoserTimeouts, 1);
    }
  );
});

test("diagnoser smoke: empty response", async () => {
  await withDiagnoserEnv(
    500,
    async () => jsonResponse({ choices: [{ message: { content: "" } }] }),
    async () => {
      const run = createRun();
      const reflection = await reflectOnRun(run);

      assert.match(reflection.diagnosis, /Run diagnosis:/);
      assert.doesNotMatch(reflection.diagnosis, /Provider diagnosis:/);
    }
  );
});

test("diagnoser smoke: invalid JSON", async () => {
  await withDiagnoserEnv(
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
      const run = createRun();
      const reflection = await reflectOnRun(run);

      assert.match(reflection.diagnosis, /Run diagnosis:/);
      assert.doesNotMatch(reflection.diagnosis, /Provider diagnosis:/);
    }
  );
});

test("diagnoser smoke: low-quality output fallback", async () => {
  await withDiagnoserEnv(
    500,
    async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                diagnosis: "Too short",
                topRisks: [],
                suggestedNextImprovements: []
              })
            }
          }
        ]
      }),
    async () => {
      const run = createRun();
      const reflection = await reflectOnRun(run);

      assert.match(reflection.diagnosis, /Run diagnosis:/);
      assert.equal(run.usageLedger?.llmDiagnoserCalls, 1);
    }
  );
});

async function withDiagnoserEnv(
  timeoutMs: number,
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response,
  fn: () => Promise<void>
): Promise<void> {
  await withEnv(
    {
      LLM_DIAGNOSER_PROVIDER: "openai-compatible",
      LLM_DIAGNOSER_MODEL: "smoke-model",
      LLM_DIAGNOSER_API_KEY: "test-key",
      LLM_DIAGNOSER_BASE_URL: providerUrl,
      LLM_DIAGNOSER_TIMEOUT_MS: String(timeoutMs),
      LLM_DIAGNOSER_MAX_TOKENS: "200",
      LLM_DIAGNOSER_TEMPERATURE: "0.1"
    },
    async () => {
      await withMockedFetch(handler, fn);
    }
  );
}

function createRun(): RunContext {
  const usageLedger = createUsageLedger();
  const tasks = [
    createTask("run-smoke-001-open_page", "open_page", { url: "http://localhost:3000" }, "done"),
    createTask("run-smoke-002-click", "click", { selector: "#login-button" }, "done"),
    createTask("run-smoke-003-assert_text", "assert_text", { text: "Dashboard", timeoutMs: 2000 }, "failed", [
      'Expected text "Dashboard" to be visible'
    ])
  ];

  return {
    runId: "run-diagnoser-smoke",
    plannerUsed: "template",
    plannerDecisionTrace: {
      candidatePlanners: [],
      chosenPlanner: "template",
      qualitySummary: { complete: true, score: 88, quality: "high", issues: [] },
      qualityScore: 88,
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
    goal: 'open "http://localhost:3000" and click "#login-button" and assert text "Dashboard"',
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
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    terminationReason: "task_failure",
    result: {
      success: false,
      message: "Task failed: Expected text \"Dashboard\" to be visible",
      error: "Expected text \"Dashboard\" to be visible"
    },
    metrics: {
      totalTasks: tasks.length,
      doneTasks: 2,
      failedTasks: 1,
      totalRetries: 0,
      totalReplans: 0,
      averageTaskDurationMs: 100
    }
  };
}

function createTask(
  id: string,
  type: AgentTask["type"],
  payload: AgentTask["payload"],
  status: AgentTask["status"],
  errorHistory?: string[]
): AgentTask {
  return {
    id,
    type,
    status,
    retries: 0,
    attempts: status === "done" ? 1 : 2,
    replanDepth: 0,
    payload,
    errorHistory
  };
}
