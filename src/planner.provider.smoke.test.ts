import test from "node:test";
import assert from "node:assert/strict";
import { planTasks } from "./planner";
import { createAbortError, delay, jsonResponse, withEnv, withMockedFetch } from "./provider-smoke.utils";
import { createUsageLedger } from "./usage-ledger";

const providerUrl = "https://provider.test/planner";

test("planner smoke: success", async () => {
  const usageLedger = createUsageLedger();

  await withPlannerEnv(
    500,
    async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tasks: [
                  { type: "open_page", payload: { url: "https://example.com" } },
                  { type: "screenshot", payload: { outputPath: "artifacts/provider-smoke.png" } }
                ]
              })
            }
          }
        ]
      }),
    async () => {
      const result = await planTasks('capture "https://example.com"', {
        runId: "planner-smoke-valid",
        mode: "llm",
        maxLLMPlannerCalls: 1,
        usageLedger
      });

      assert.equal(result.plannerUsed, "llm");
      assert.equal(result.tasks.length, 2);
      assert.equal(usageLedger.llmPlannerCalls, 1);
    }
  );
});

test("planner smoke: timeout", async () => {
  const usageLedger = createUsageLedger();

  await withPlannerEnv(
    50,
    async (_input, init) => {
      await delay(200);
      if (init?.signal?.aborted) {
        throw createAbortError();
      }
      return jsonResponse({ choices: [] });
    },
    async () => {
      const result = await planTasks('capture "https://example.com"', {
        runId: "planner-smoke-timeout",
        mode: "llm",
        maxLLMPlannerCalls: 1,
        usageLedger
      });

      assert.equal(result.plannerUsed, "none");
      assert.equal(result.decisionTrace.timeoutCount, 1);
      assert.equal(usageLedger.plannerTimeouts, 1);
    }
  );
});

test("planner smoke: empty response", async () => {
  const usageLedger = createUsageLedger();

  await withPlannerEnv(
    500,
    async () => jsonResponse({ choices: [{ message: { content: "" } }] }),
    async () => {
      const result = await planTasks('capture "https://example.com"', {
        runId: "planner-smoke-empty",
        mode: "llm",
        maxLLMPlannerCalls: 1,
        usageLedger
      });

      assert.equal(result.plannerUsed, "none");
      assert.match(result.fallbackReason ?? "", /empty content/i);
    }
  );
});

test("planner smoke: invalid JSON", async () => {
  const usageLedger = createUsageLedger();

  await withPlannerEnv(
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
      const result = await planTasks('capture "https://example.com"', {
        runId: "planner-smoke-invalid-json",
        mode: "llm",
        maxLLMPlannerCalls: 1,
        usageLedger
      });

      assert.equal(result.plannerUsed, "none");
      assert.match(result.fallbackReason ?? "", /response was not a JSON task array/i);
    }
  );
});

test("planner smoke: low-quality output fallback", async () => {
  const usageLedger = createUsageLedger();

  await withPlannerEnv(
    500,
    async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                tasks: [{ type: "screenshot", payload: { outputPath: "artifacts/only-shot.png" } }]
              })
            }
          }
        ]
      }),
    async () => {
      const result = await planTasks(
        'launch local app using "npm run dev" then wait until "http://localhost:3000" is ready and open "http://localhost:3000" and confirm "Dashboard" appears then capture screenshot',
        {
          runId: "planner-smoke-low-quality",
          mode: "auto",
          maxLLMPlannerCalls: 1,
          usageLedger,
          policy: {
            mode: "aggressive",
            plannerCostMode: "aggressive",
            replannerCostMode: "balanced",
            preferRuleSystemsOnCheapGoals: false,
            allowLLMReplannerForSimpleFailures: false
          }
        }
      );

      assert.notEqual(result.plannerUsed, "llm");
      assert.equal(result.decisionTrace.llmInvocations, 1);
      assert.equal(usageLedger.plannerFallbacks, 1);
      assert.match(result.fallbackReason ?? "", /low-quality|low quality/i);
    }
  );
});

async function withPlannerEnv(
  timeoutMs: number,
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response,
  fn: () => Promise<void>
): Promise<void> {
  await withEnv(
    {
      LLM_PLANNER_PROVIDER: "openai-compatible",
      LLM_PLANNER_MODEL: "smoke-model",
      LLM_PLANNER_API_KEY: "test-key",
      LLM_PLANNER_BASE_URL: providerUrl,
      LLM_PLANNER_TIMEOUT_MS: String(timeoutMs),
      LLM_PLANNER_MAX_TOKENS: "200",
      LLM_PLANNER_TEMPERATURE: "0.1"
    },
    async () => {
      await withMockedFetch(handler, fn);
    }
  );
}
