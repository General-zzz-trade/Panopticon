import test from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies } from "./anomaly-detector";
import type { AgentTask, RunContext } from "../types";
import type { AgentObservation } from "./types";

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1", type: "click", status: "done",
    retries: 0, attempts: 1, replanDepth: 0, payload: {},
    ...overrides
  };
}

function makeObs(overrides: Partial<AgentObservation> = {}): AgentObservation {
  return {
    id: "obs-1", runId: "run-1", timestamp: new Date().toISOString(),
    source: "task_observe", anomalies: [], confidence: 0.8,
    ...overrides
  };
}

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-1", goal: "test", tasks: [], artifacts: [],
    replanCount: 0, nextTaskSequence: 0, insertedTaskCount: 0,
    llmReplannerInvocations: 0, llmReplannerTimeoutCount: 0, llmReplannerFallbackCount: 0,
    escalationDecisions: [], limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    ...overrides
  };
}

test("detects HTTP error in visible text", () => {
  const before = makeObs({ visibleText: ["Dashboard"] });
  const after = makeObs({ visibleText: ["Error 500", "Internal Server Error"] });
  const report = detectAnomalies(makeTask(), before, after, makeContext());
  assert.ok(report.anomalies.some(a => a.type === "error_signal"));
  assert.equal(report.overallRisk, "high");
});

test("detects stack trace on page", () => {
  const before = makeObs({ visibleText: ["Form"] });
  const after = makeObs({ visibleText: ["Unhandled exception at line 42", "stack trace"] });
  const report = detectAnomalies(makeTask(), before, after, makeContext());
  assert.ok(report.anomalies.some(a => a.type === "error_signal"));
});

test("detects stale page after click", () => {
  const obs = makeObs({ visibleText: ["Same content"], pageUrl: "http://localhost/page" });
  const report = detectAnomalies(makeTask({ type: "click" }), obs, obs, makeContext());
  assert.ok(report.anomalies.some(a => a.type === "stale_page"));
});

test("no stale alert for wait task", () => {
  const obs = makeObs({ visibleText: ["Same content"] });
  const report = detectAnomalies(makeTask({ type: "wait" }), obs, obs, makeContext());
  assert.ok(!report.anomalies.some(a => a.type === "stale_page"));
});

test("detects session regression", () => {
  const before = makeObs({ visibleText: ["Dashboard", "Welcome"], appStateGuess: "authenticated" });
  const after = makeObs({ visibleText: ["Please login", "Sign in"], appStateGuess: "ready" });
  const report = detectAnomalies(makeTask(), before, after, makeContext());
  assert.ok(report.anomalies.some(a => a.type === "regression"));
  assert.equal(report.overallRisk, "high");
});

test("detects unexpected navigation", () => {
  const before = makeObs({ pageUrl: "http://localhost/settings" });
  const after = makeObs({ pageUrl: "http://localhost/error" });
  const report = detectAnomalies(makeTask({ type: "click" }), before, after, makeContext());
  assert.ok(report.anomalies.some(a => a.type === "unexpected_state"));
});

test("no navigation anomaly for open_page", () => {
  const before = makeObs({ pageUrl: "http://localhost/a" });
  const after = makeObs({ pageUrl: "http://localhost/b" });
  const report = detectAnomalies(makeTask({ type: "open_page" }), before, after, makeContext());
  assert.ok(!report.anomalies.some(a => a.type === "unexpected_state"));
});

test("detects repeated failures", () => {
  const tasks = Array.from({ length: 4 }, (_, i) =>
    makeTask({ id: `t${i}`, type: "click", status: "failed" })
  );
  const ctx = makeContext({ tasks });
  const report = detectAnomalies(makeTask({ type: "click" }), makeObs(), makeObs(), ctx);
  assert.ok(report.anomalies.some(a => a.type === "regression" && a.description.includes("4 times")));
});

test("no anomalies for clean transition", () => {
  const before = makeObs({ visibleText: ["Login"], pageUrl: "http://localhost/login" });
  const after = makeObs({ visibleText: ["Dashboard", "Welcome"], pageUrl: "http://localhost/dashboard" });
  const report = detectAnomalies(makeTask({ type: "click" }), before, after, makeContext());
  // Should have unexpected_state (navigation) but NOT error or regression
  assert.ok(!report.anomalies.some(a => a.type === "error_signal"));
  assert.ok(!report.anomalies.some(a => a.type === "regression"));
});

test("report summary includes anomaly types", () => {
  const before = makeObs({ visibleText: ["OK"] });
  const after = makeObs({ visibleText: ["Error 500"] });
  const report = detectAnomalies(makeTask(), before, after, makeContext());
  assert.ok(report.summary.includes("error_signal"));
});

test("clean report has no-anomaly summary", () => {
  const before = makeObs({ visibleText: ["A"], pageUrl: "http://x/a" });
  const after = makeObs({ visibleText: ["B"], pageUrl: "http://x/a" });
  const report = detectAnomalies(makeTask({ type: "click" }), before, after, makeContext());
  // Text changed so not stale, no errors, same URL so no navigation anomaly
  assert.equal(report.overallRisk, "none");
});
