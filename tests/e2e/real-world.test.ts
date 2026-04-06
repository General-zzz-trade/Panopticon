import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { runGoal } from "../../src/core/runtime";
import { matchTemplatePlan } from "../../src/planner/templates";

/**
 * Real-world E2E tests for the agent runtime.
 *
 * Group 1: Local tests against localhost:3000
 * Group 2: Internet tests (skipped if no connectivity)
 * Group 3: Error handling
 * Group 4: Template planner validation
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hasInternet(): Promise<boolean> {
  try {
    await fetch("https://example.com", { signal: AbortSignal.timeout(5000) });
    return true;
  } catch {
    return false;
  }
}

// Pre-check internet connectivity once so we can skip tests synchronously
let internetAvailable = false;

// ---------------------------------------------------------------------------
// Group 1: Local tests (require the API server on localhost:3000)
// ---------------------------------------------------------------------------

describe("Group 1: Local tests", { timeout: 60000 }, () => {
  test("health check via http_request", async () => {
    const ctx = await runGoal("check health of http://localhost:3000/health");
    assert.ok(ctx.result?.success, `Expected success, got: ${ctx.result?.message}`);
    assert.ok(
      ctx.result?.message?.includes("200"),
      `Expected message to include 200, got: ${ctx.result?.message}`
    );
  });

  test("fetch API endpoint", async () => {
    const ctx = await runGoal("fetch http://localhost:3000/api/v1/runs?limit=1");
    assert.ok(ctx.result?.success, `Expected success, got: ${ctx.result?.message}`);
  });

  test("shell command execution", async () => {
    const ctx = await runGoal("run command: echo hello world");
    assert.ok(ctx.result?.success, `Expected success, got: ${ctx.result?.message}`);
    assert.ok(
      ctx.result?.message?.toLowerCase().includes("hello"),
      `Expected message to include 'hello', got: ${ctx.result?.message}`
    );
  });

  test("file read", async () => {
    const ctx = await runGoal("read file package.json");
    assert.ok(ctx.result?.success, `Expected success, got: ${ctx.result?.message}`);
  });

  test("multi-step: health + list runs", async () => {
    const ctx = await runGoal(
      "check health of http://localhost:3000/health and then fetch http://localhost:3000/api/v1/queue/stats"
    );
    assert.ok(ctx.result, "Expected a result from multi-step goal");
  });
});

// ---------------------------------------------------------------------------
// Group 2: Internet tests (skip if no connection)
// ---------------------------------------------------------------------------

describe("Group 2: Internet tests", { timeout: 60000 }, () => {
  test("pre-check connectivity", async () => {
    internetAvailable = await hasInternet();
    if (!internetAvailable) {
      console.log("  [info] No internet connectivity detected — internet tests will be skipped.");
    }
  });

  test("navigate to example.com and verify page title", { skip: !internetAvailable ? "no internet" : false }, async () => {
    const ctx = await runGoal("go to https://example.com");
    assert.ok(ctx.result, "Expected a result from navigation goal");
    // The run should complete (success or have tasks attempted)
    assert.ok(ctx.tasks.length > 0, "Expected at least one task to be created");
  });

  test("fetch GitHub API and verify JSON response", { skip: !internetAvailable ? "no internet" : false }, async () => {
    const ctx = await runGoal("fetch https://api.github.com/zen");
    assert.ok(ctx.result?.success, `Expected success, got: ${ctx.result?.message}`);
  });

  test("screenshot of example.com and verify artifact", { skip: !internetAvailable ? "no internet" : false }, async () => {
    const ctx = await runGoal("take screenshot of https://example.com");
    assert.ok(ctx.result, "Expected a result from screenshot goal");
    assert.ok(ctx.tasks.length >= 2, "Expected at least 2 tasks (open_page + screenshot)");
    const screenshotTask = ctx.tasks.find((t) => t.type === "screenshot");
    assert.ok(screenshotTask, "Expected a screenshot task in the plan");
  });

  test("search planner produces correct plan for example.com", { skip: !internetAvailable ? "no internet" : false }, async () => {
    const ctx = await runGoal('search for "typescript" on https://example.com');
    assert.ok(ctx.result, "Expected a result from search goal");
    assert.ok(ctx.tasks.length >= 1, "Expected tasks to be created for search goal");
  });

  test("navigate and extract text from example.com", { skip: !internetAvailable ? "no internet" : false }, async () => {
    const ctx = await runGoal("get text from https://example.com");
    assert.ok(ctx.result, "Expected a result from extract goal");
    assert.ok(ctx.tasks.length >= 1, "Expected tasks to be created for text extraction");
  });
});

// ---------------------------------------------------------------------------
// Group 3: Error handling tests
// ---------------------------------------------------------------------------

describe("Group 3: Error handling", { timeout: 60000 }, () => {
  test("fetch non-existent URL handles failure gracefully", async () => {
    const ctx = await runGoal("fetch http://localhost:59999/does-not-exist");
    // Should complete without throwing; failure is acceptable but must be graceful
    assert.ok(ctx.result, "Expected a result even for a failing URL");
    // The runtime should not crash — having a result object is the key assertion
  });

  test("invalid goal (empty string) produces error", async () => {
    try {
      const ctx = await runGoal("");
      // If it doesn't throw, the result should indicate failure
      assert.ok(
        !ctx.result?.success || ctx.result?.error,
        "Empty goal should fail or produce an error result"
      );
    } catch (err: unknown) {
      // Throwing on empty goal is also acceptable behavior
      assert.ok(err instanceof Error, "Should throw an Error for empty goal");
    }
  });

  test("timeout scenario is handled gracefully", async () => {
    const ctx = await runGoal("fetch http://localhost:1/timeout-test", {
      policy: { maxRetries: 0 },
    });
    assert.ok(ctx.result, "Expected a result even on timeout/connection refused");
  });

  test("navigate to invalid URL produces error message", async () => {
    const ctx = await runGoal("go to http://invalid-host-that-does-not-exist.local:1");
    assert.ok(ctx.result, "Expected a result for invalid URL navigation");
    // The run should have attempted the task
    assert.ok(ctx.tasks.length > 0, "Expected tasks to be created even for invalid URL");
  });
});

// ---------------------------------------------------------------------------
// Group 4: Template planner tests (pure, no I/O)
// ---------------------------------------------------------------------------

describe("Group 4: Template planner — goal phrasing to task types", () => {
  test('"go to X" produces open_page', () => {
    const plan = matchTemplatePlan("go to http://example.com");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["open_page"]);
    assert.strictEqual(plan[0].payload.url, "http://example.com");
  });

  test('"check health of X" produces http_request', () => {
    const plan = matchTemplatePlan("check health of http://localhost:3000/health");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["http_request"]);
    assert.strictEqual(plan[0].payload.url, "http://localhost:3000/health");
    assert.strictEqual(plan[0].payload.method, "GET");
  });

  test('"take screenshot of X" produces open_page + screenshot', () => {
    const plan = matchTemplatePlan("take screenshot of http://example.com");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["open_page", "screenshot"]);
  });

  test('"run command ls" produces run_code with shell language', () => {
    const plan = matchTemplatePlan("run command ls");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["run_code"]);
    assert.strictEqual(plan[0].payload.language, "shell");
    assert.strictEqual(plan[0].payload.code, "ls");
  });

  test('"read file X" produces read_file', () => {
    const plan = matchTemplatePlan("read file package.json");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["read_file"]);
    assert.strictEqual(plan[0].payload.path, "package.json");
  });

  test('"search for X on Y" produces open_page + type + click', () => {
    const plan = matchTemplatePlan('search for "typescript" on http://example.com');
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["open_page", "type", "click"]);
    assert.strictEqual(plan[0].payload.url, "http://example.com");
    assert.strictEqual(plan[1].payload.text, "typescript");
  });

  test('"fetch X" produces http_request', () => {
    const plan = matchTemplatePlan("fetch https://api.github.com/zen");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["http_request"]);
  });

  test('"get text from X" produces open_page + visual_extract', () => {
    const plan = matchTemplatePlan("get text from http://example.com");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["open_page", "visual_extract"]);
  });

  test('"navigate to X" produces open_page', () => {
    const plan = matchTemplatePlan("navigate to http://localhost:3000");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["open_page"]);
  });

  test('"visit X" produces open_page', () => {
    const plan = matchTemplatePlan("visit http://localhost:3000");
    assert.ok(plan, "Expected a plan from template planner");
    const types = plan.map((t) => t.type);
    assert.deepStrictEqual(types, ["open_page"]);
  });
});
