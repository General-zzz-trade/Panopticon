import test from "node:test";
import assert from "node:assert/strict";
import { assessExperience, shouldRequestHelp } from "./meta-cognition";
import type { AgentTask, RunContext } from "../types";

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-meta",
    goal: "test",
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

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1", type: "click", status: "done",
    retries: 0, attempts: 1, replanDepth: 0, payload: {},
    ...overrides
  };
}

test("assessExperience: new domain has low familiarity", () => {
  const ctx = makeContext();
  const task = makeTask();
  const assessment = assessExperience(ctx, task);
  assert.ok(assessment.domainFamiliarity <= 1);
  assert.ok(assessment.confidenceMultiplier >= 0.5);
  assert.ok(assessment.confidenceMultiplier <= 1.0);
});

test("assessExperience: selector with failures has high risk", () => {
  const failedTask = makeTask({ id: "t1", status: "failed", payload: { selector: "#btn" } });
  const currentTask = makeTask({ id: "t2", payload: { selector: "#btn" } });
  const ctx = makeContext({ tasks: [failedTask, currentTask] });

  const assessment = assessExperience(ctx, currentTask);
  assert.ok(assessment.selectorRiskLevel > 0, "Should detect selector risk");
});

test("assessExperience: no selector has zero risk", () => {
  const ctx = makeContext();
  const task = makeTask({ payload: { text: "hello" } });
  const assessment = assessExperience(ctx, task);
  assert.equal(assessment.selectorRiskLevel, 0);
});

test("assessExperience: many recent failures increase stuck level", () => {
  const tasks = [
    makeTask({ id: "t1", status: "failed" }),
    makeTask({ id: "t2", status: "failed" }),
    makeTask({ id: "t3", status: "failed" }),
    makeTask({ id: "t4", status: "failed" }),
    makeTask({ id: "t5", status: "done" })
  ];
  const ctx = makeContext({ tasks, replanCount: 2, limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 } });

  const assessment = assessExperience(ctx, makeTask());
  assert.ok(assessment.stuckLevel > 0.3, `Expected stuck > 0.3, got ${assessment.stuckLevel}`);
});

test("assessExperience: progressing run has low stuck level", () => {
  const tasks = [
    makeTask({ id: "t1", status: "done" }),
    makeTask({ id: "t2", status: "done" }),
    makeTask({ id: "t3", status: "done" })
  ];
  const ctx = makeContext({ tasks });
  const assessment = assessExperience(ctx, makeTask());
  assert.equal(assessment.stuckLevel, 0);
});

test("confidenceMultiplier is in valid range [0.5, 1.0]", () => {
  // Worst case: unfamiliar + failing selector + stuck
  const tasks = Array.from({ length: 5 }, (_, i) =>
    makeTask({ id: `t${i}`, status: "failed", payload: { selector: "#x" } })
  );
  const ctx = makeContext({ tasks, replanCount: 3, limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 } });
  const task = makeTask({ payload: { selector: "#x" } });

  const assessment = assessExperience(ctx, task);
  assert.ok(assessment.confidenceMultiplier >= 0.5, `Min bound: ${assessment.confidenceMultiplier}`);
  assert.ok(assessment.confidenceMultiplier <= 1.0, `Max bound: ${assessment.confidenceMultiplier}`);
});

test("shouldRequestHelp: true when stuck and low confidence", () => {
  assert.equal(shouldRequestHelp({
    domainFamiliarity: 0,
    selectorRiskLevel: 1,
    stuckLevel: 0.8,
    confidenceMultiplier: 0.5,
    rationale: "stuck"
  }), true);
});

test("shouldRequestHelp: false when progressing", () => {
  assert.equal(shouldRequestHelp({
    domainFamiliarity: 0.5,
    selectorRiskLevel: 0,
    stuckLevel: 0.2,
    confidenceMultiplier: 0.9,
    rationale: "normal"
  }), false);
});
