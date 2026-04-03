import test from "node:test";
import assert from "node:assert/strict";
import { verifyStateResult } from "./state-verifier";
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

test("wait_for_server passes when no browser-lost anomaly", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "wait_for_server" });
  const obs = makeObservation({ anomalies: [] });
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("wait_for_server fails when no browser page anomaly", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "wait_for_server" });
  const obs = makeObservation({ anomalies: ["No browser page attached"] });
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("start_app passes when appProcess is set", async () => {
  const ctx = makeContext({ appProcess: { pid: 123, kill: async () => {} } as any });
  const task = makeTask({ type: "start_app" });
  const obs = makeObservation();
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("start_app fails when appProcess is missing", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "start_app" });
  const obs = makeObservation();
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("stop_app passes when appProcess is cleared", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "stop_app" });
  const obs = makeObservation();
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("stop_app fails when appProcess still attached", async () => {
  const ctx = makeContext({ appProcess: { pid: 123, kill: async () => {} } as any });
  const task = makeTask({ type: "stop_app" });
  const obs = makeObservation();
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("open_page passes when observation URL matches worldState URL", async () => {
  const ctx = makeContext({
    worldState: {
      runId: "run-test",
      timestamp: new Date().toISOString(),
      appState: "ready",
      uncertaintyScore: 0.3,
      facts: [],
      pageUrl: "http://localhost:3000/dashboard"
    }
  });
  const task = makeTask({ type: "open_page", payload: { url: "http://localhost:3000/dashboard" } });
  const obs = makeObservation({ pageUrl: "http://localhost:3000/dashboard" });
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, true);
});

test("open_page fails when observation URL diverges from worldState URL", async () => {
  const ctx = makeContext({
    worldState: {
      runId: "run-test",
      timestamp: new Date().toISOString(),
      appState: "ready",
      uncertaintyScore: 0.3,
      facts: [],
      pageUrl: "http://localhost:3000/dashboard"
    }
  });
  const task = makeTask({ type: "open_page", payload: { url: "http://localhost:3000/dashboard" } });
  const obs = makeObservation({ pageUrl: "http://localhost:3000/login" });
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, false);
});

test("default task type passes with state consistent", async () => {
  const ctx = makeContext();
  const task = makeTask({ type: "click" });
  const obs = makeObservation();
  const result = await verifyStateResult(ctx, task, obs);
  assert.equal(result.passed, true);
  assert.ok(result.confidence >= 0.7);
});
