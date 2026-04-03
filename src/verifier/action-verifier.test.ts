import test from "node:test";
import assert from "node:assert/strict";
import { verifyActionResult } from "./action-verifier";
import type { AgentTask, RunContext } from "../types";
import type { AgentObservation } from "../cognition/types";

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-test",
    goal: "test goal",
    tasks: [],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 0,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeTask(overrides: Partial<AgentTask>): AgentTask {
  return {
    id: "task-1",
    type: "click",
    status: "done",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: {},
    ...overrides
  };
}

function makeObservation(overrides: Partial<AgentObservation> = {}): AgentObservation {
  return {
    id: "obs-1",
    runId: "run-test",
    timestamp: new Date().toISOString(),
    source: "task_observe",
    anomalies: [],
    confidence: 0.8,
    ...overrides
  };
}

test("type task passes when typed value appears in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "type", payload: { selector: "#email", value: "user@test.com" } });
  const obs = makeObservation({ visibleText: ["Email", "user@test.com", "Password"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
  assert.ok(result.confidence >= 0.7);
});

test("type task fails when typed value not in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "type", payload: { selector: "#email", value: "user@test.com" } });
  const obs = makeObservation({ visibleText: ["Email", "Password"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("screenshot task passes when artifact exists for task", async () => {
  const ctx = makeContext({ artifacts: [{ type: "screenshot", path: "shot.png", description: "Screenshot", taskId: "task-1" }] });
  const task = makeTask({ type: "screenshot", id: "task-1" });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("screenshot task fails when no artifact for task", async () => {
  const ctx = makeContext({ artifacts: [] });
  const task = makeTask({ type: "screenshot", id: "task-1" });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("http_request task passes when task has no error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "http_request", payload: { url: "http://example.com" }, error: undefined });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("http_request task fails when task has error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "http_request", payload: { url: "http://example.com" }, error: "HTTP 500" });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("visual_click passes when no anomalies", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "visual_click", payload: { description: "Login button" } });
  const obs = makeObservation({ anomalies: [] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("visual_click fails when anomalies present", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "visual_click", payload: { description: "Login button" } });
  const obs = makeObservation({ anomalies: ["Element not found"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("visual_type passes when typed value in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "visual_type", payload: { description: "Email field", value: "hello@test.com" } });
  const obs = makeObservation({ visibleText: ["Email", "hello@test.com"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("select task passes when selected value in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "select", payload: { selector: "#country", value: "Japan" } });
  const obs = makeObservation({ visibleText: ["Country", "Japan", "Submit"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("hover task passes when no anomalies", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "hover", payload: { selector: "#menu" } });
  const obs = makeObservation({ anomalies: [] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("read_file passes when task has no error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "read_file", payload: { path: "/tmp/test.txt" }, error: undefined });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("write_file fails when task has error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "write_file", payload: { path: "/tmp/test.txt" }, error: "EACCES" });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("run_code passes when task has no error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "run_code", payload: { language: "javascript", code: "1+1" }, error: undefined });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("visual_assert passes when expected text is in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "visual_assert", payload: { text: "Welcome" } });
  const obs = makeObservation({ visibleText: ["Welcome back, user!"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("wait task always passes", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "wait", payload: { ms: 1000 } });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("visual_type fails when typed value not in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "visual_type", payload: { description: "Email field", value: "hello@test.com" } });
  const obs = makeObservation({ visibleText: ["Email", "Password"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("select task fails when selected value not in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "select", payload: { selector: "#country", value: "Japan" } });
  const obs = makeObservation({ visibleText: ["Country", "USA", "Submit"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("hover task fails when anomalies present", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "hover", payload: { selector: "#menu" } });
  const obs = makeObservation({ anomalies: ["Hover target not found"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("read_file fails when task has error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "read_file", payload: { path: "/tmp/missing.txt" }, error: "ENOENT" });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("write_file passes when task has no error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "write_file", payload: { path: "/tmp/test.txt" }, error: undefined });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("run_code fails when task has error", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "run_code", payload: { language: "javascript", code: "throw 1" }, error: "Script failed" });
  const obs = makeObservation();
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("visual_assert fails when expected text not in visible text", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "visual_assert", payload: { text: "Welcome" } });
  const obs = makeObservation({ visibleText: ["Login page"] });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("open_page passes when url matches", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "open_page", payload: { url: "http://localhost:3000/dashboard" } });
  const obs = makeObservation({ pageUrl: "http://localhost:3000/dashboard" });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("open_page verification with url mismatch", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "open_page", payload: { url: "http://localhost:3000/dashboard" } });
  const obs = makeObservation({ pageUrl: "http://localhost:3000/login" });
  const result = await verifyActionResult(ctx, task, obs);
  assert.equal(result.passed, false);
});
