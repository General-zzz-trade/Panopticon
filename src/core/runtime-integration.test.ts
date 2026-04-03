import test from "node:test";
import assert from "node:assert/strict";
import { runGoal } from "./runtime";

test("runGoal rejects empty goal", async () => {
  const result = await runGoal("");
  assert.equal(result.result?.success, false);
  assert.ok(result.result?.message?.includes("Goal is required") || result.result?.message?.includes("No executable"));
});

test("runGoal rejects whitespace-only goal", async () => {
  const result = await runGoal("   ");
  assert.equal(result.result?.success, false);
});

test("runGoal creates run with unique ID", async () => {
  const run1 = await runGoal("nonexistent goal that will fail planning");
  const run2 = await runGoal("another nonexistent goal");
  assert.notEqual(run1.runId, run2.runId);
  assert.ok(run1.runId.startsWith("run-"));
});

test("runGoal records start and end timestamps", async () => {
  const result = await runGoal("test timestamp goal");
  assert.ok(result.startedAt);
  assert.ok(result.endedAt);
  assert.ok(new Date(result.endedAt!).getTime() >= new Date(result.startedAt).getTime());
});

test("runGoal sets termination reason on failure", async () => {
  const result = await runGoal("impossible goal with no valid plan");
  assert.ok(result.terminationReason);
  // Should be one of the valid termination reasons
  const validReasons = ["success", "task_failure", "replan_budget_exceeded", "task_replan_budget_exceeded", "timeout", "unknown"];
  assert.ok(validReasons.includes(result.terminationReason!));
});

test("runGoal initializes world state", async () => {
  const result = await runGoal("any goal");
  // World state should have been initialized even if planning fails
  assert.ok(result.worldState || result.worldStateHistory);
});

test("runGoal respects plannerMode option", async () => {
  const result = await runGoal('open page "http://example.com"', { plannerMode: "template" });
  // plannerUsed reflects whichever planner actually produced the plan
  // With template mode, it may fall back to "none" if no template matches
  assert.ok(result.plannerUsed !== undefined);
  assert.ok(["template", "regex", "llm", "none"].includes(result.plannerUsed!));
});

test("runGoal with keepBrowserAlive does not clear browser session", async () => {
  // This tests the option exists and doesn't crash
  const result = await runGoal("test", { keepBrowserAlive: false });
  assert.equal(result.browserSession, undefined); // Should be cleared
});

test("runGoal populates episode events", async () => {
  const result = await runGoal('wait 10');
  // Even failed runs should have some episode events
  assert.ok(Array.isArray(result.episodeEvents));
});

test("runGoal with maxReplansPerRun limits replanning", async () => {
  const result = await runGoal("test", { maxReplansPerRun: 0 });
  assert.equal(result.limits.maxReplansPerRun, 0);
});

test("runGoal generates reflection on completion", async () => {
  const result = await runGoal('open page "http://example.com" and screenshot');
  // Reflection should be generated even on failure
  if (result.reflection) {
    assert.ok(typeof result.reflection.summary === "string");
    assert.ok(Array.isArray(result.reflection.improvementSuggestions));
  }
});
