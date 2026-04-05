import test from "node:test";
import assert from "node:assert/strict";
import {
  createReasoningTrace,
  recordDecisionTrace,
  buildDecisionContext,
  buildDecisionOptions,
  getTraceForTask,
  getReplans,
  getDecisionChain
} from "./reasoning-trace";
import { explainDecision, explainRun, explainBrief } from "./explainability";

test("createReasoningTrace initializes empty", () => {
  const trace = createReasoningTrace("run-1");
  assert.equal(trace.runId, "run-1");
  assert.equal(trace.entries.length, 0);
});

test("recordDecisionTrace adds entry", () => {
  const trace = createReasoningTrace("run-1");
  const ctx = buildDecisionContext({ pageUrl: "http://test.com", appState: "ready" });
  const options = [
    { action: "continue", score: 0.8, rationale: "All good" },
    { action: "replan", score: 0.2, rationale: "Not needed" }
  ];
  recordDecisionTrace(trace, {
    taskId: "t1", taskType: "click", stepIndex: 0,
    context: ctx, options, chosen: options[0], confidence: 0.8
  });
  assert.equal(trace.entries.length, 1);
  assert.equal(trace.entries[0].taskId, "t1");
  assert.equal(trace.entries[0].chosen.action, "continue");
});

test("getTraceForTask finds entry", () => {
  const trace = createReasoningTrace("run-1");
  const ctx = buildDecisionContext({});
  recordDecisionTrace(trace, {
    taskId: "t1", taskType: "click", stepIndex: 0,
    context: ctx, options: [], chosen: { action: "continue", score: 0.8, rationale: "ok" }, confidence: 0.8
  });
  recordDecisionTrace(trace, {
    taskId: "t2", taskType: "type", stepIndex: 1,
    context: ctx, options: [], chosen: { action: "replan", score: 0.6, rationale: "error" }, confidence: 0.6
  });
  const entry = getTraceForTask(trace, "t2");
  assert.ok(entry);
  assert.equal(entry!.taskType, "type");
});

test("getReplans returns replan/retry entries", () => {
  const trace = createReasoningTrace("run-1");
  const ctx = buildDecisionContext({});
  recordDecisionTrace(trace, { taskId: "t1", taskType: "click", stepIndex: 0, context: ctx, options: [], chosen: { action: "continue", score: 0.9, rationale: "ok" }, confidence: 0.9 });
  recordDecisionTrace(trace, { taskId: "t2", taskType: "click", stepIndex: 1, context: ctx, options: [], chosen: { action: "replan", score: 0.6, rationale: "failed" }, confidence: 0.6 });
  recordDecisionTrace(trace, { taskId: "t3", taskType: "type", stepIndex: 2, context: ctx, options: [], chosen: { action: "continue", score: 0.8, rationale: "recovered" }, confidence: 0.8 });
  assert.equal(getReplans(trace).length, 1);
});

test("buildDecisionOptions generates all alternatives", () => {
  const options = buildDecisionOptions(
    { nextAction: "continue", rationale: "all passed", confidence: 0.9 },
    true, 3
  );
  assert.ok(options.length >= 3); // continue, replan, retry, abort
  const chosen = options.find(o => o.action === "continue");
  assert.ok(chosen);
  assert.equal(chosen!.score, 0.9);
});

test("explainDecision returns structured explanation", () => {
  const trace = createReasoningTrace("run-1");
  const ctx = buildDecisionContext({
    pageUrl: "http://test.com",
    appState: "ready",
    verifications: [{ runId: "run-1", verifier: "action", passed: true, confidence: 0.8, rationale: "ok", evidence: [] }],
    momentum: 3,
    factCount: 5
  });
  recordDecisionTrace(trace, {
    taskId: "t1", taskType: "click", stepIndex: 0, context: ctx,
    options: [{ action: "continue", score: 0.9, rationale: "passed" }],
    chosen: { action: "continue", score: 0.9, rationale: "passed" },
    confidence: 0.9
  });
  const explanation = explainDecision(trace, "t1");
  assert.ok(explanation);
  assert.ok(explanation!.summary.includes("continue"));
  assert.ok(explanation!.keyFactors.length > 0);
});

test("explainRun produces summary text", () => {
  const trace = createReasoningTrace("run-1");
  const ctx = buildDecisionContext({});
  recordDecisionTrace(trace, { taskId: "t1", taskType: "click", stepIndex: 0, context: ctx, options: [], chosen: { action: "continue", score: 0.9, rationale: "ok" }, confidence: 0.9 });
  const summary = explainRun(trace);
  assert.ok(summary.includes("1 decision"));
});

test("explainBrief returns concise text", () => {
  const trace = createReasoningTrace("run-1");
  const ctx = buildDecisionContext({ pageUrl: "http://test.com" });
  recordDecisionTrace(trace, { taskId: "t1", taskType: "click", stepIndex: 0, context: ctx, options: [
    { action: "continue", score: 0.9, rationale: "ok" },
    { action: "replan", score: 0.2, rationale: "not needed" }
  ], chosen: { action: "continue", score: 0.9, rationale: "ok" }, confidence: 0.9 });
  const brief = explainBrief(trace, "t1");
  assert.ok(brief.includes("continue"));
  assert.ok(brief.includes("90%"));
});
