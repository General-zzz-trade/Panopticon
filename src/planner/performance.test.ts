import test from "node:test";
import assert from "node:assert/strict";
import { planTasks } from "./index";
import { createUsageLedger } from "../observability/usage-ledger";

test("template planner completes within 50ms", async () => {
  const start = Date.now();
  const result = await planTasks('start app "npm start" and wait for server "http://localhost:3000" and open page "http://localhost:3000" and assert text "Hello"', {
    runId: "perf-test-1",
    mode: "template"
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 50, `Template planner took ${elapsed}ms (limit: 50ms)`);
  assert.ok(result.tasks.length > 0);
});

test("regex planner completes within 50ms", async () => {
  const start = Date.now();
  const result = await planTasks('start app "npm start" and wait for server "http://localhost:3000" and open page "http://localhost:3000"', {
    runId: "perf-test-2",
    mode: "regex"
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 50, `Regex planner took ${elapsed}ms (limit: 50ms)`);
});

test("auto mode planner completes within 200ms (no LLM)", async () => {
  const start = Date.now();
  const result = await planTasks('open page "http://example.com" and screenshot', {
    runId: "perf-test-3",
    mode: "auto",
    maxLLMPlannerCalls: 0  // Disable LLM to test rule planners only
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 200, `Auto planner took ${elapsed}ms (limit: 200ms)`);
});

test("planner handles 10 sequential goals efficiently", async () => {
  const goals = Array.from({ length: 10 }, (_, i) =>
    `open page "http://example.com/page${i}" and click "#btn${i}" and assert text "Page ${i}"`
  );

  const start = Date.now();
  for (const goal of goals) {
    await planTasks(goal, { runId: `perf-batch-${Math.random()}`, mode: "template" });
  }
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 500, `10 plans took ${elapsed}ms (limit: 500ms)`);
});

test("quality evaluation does not add significant overhead", async () => {
  const goal = 'start app "npm dev" and wait for server "http://localhost:3000" and open page "http://localhost:3000" and click "#login" and type "#user" "admin" and click "#submit" and assert text "Dashboard" and screenshot and stop app';

  const start = Date.now();
  const result = await planTasks(goal, {
    runId: "perf-quality-test",
    mode: "auto",
    maxLLMPlannerCalls: 0
  });
  const elapsed = Date.now() - start;

  assert.ok(elapsed < 200, `Complex plan with quality eval took ${elapsed}ms (limit: 200ms)`);
  assert.ok(result.qualitySummary);
});
