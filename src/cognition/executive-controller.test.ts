import test from "node:test";
import assert from "node:assert/strict";
import { decideNextStep } from "./executive-controller";
import type { AgentTask } from "../types";
import type { VerificationResult } from "./types";

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
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

function makeVerification(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    runId: "run-test",
    taskId: "task-1",
    verifier: "action",
    passed: true,
    confidence: 0.8,
    rationale: "OK",
    evidence: [],
    ...overrides
  };
}

test("continue when all verifications pass", () => {
  const result = decideNextStep({
    task: makeTask(),
    actionVerification: makeVerification({ verifier: "action", passed: true }),
    stateVerification: makeVerification({ verifier: "state", passed: true }),
    replanCount: 0,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "continue");
  assert.ok(result.confidence >= 0.8);
});

test("reobserve when only goal verification fails", () => {
  const result = decideNextStep({
    task: makeTask(),
    actionVerification: makeVerification({ verifier: "action", passed: true }),
    stateVerification: makeVerification({ verifier: "state", passed: true }),
    goalVerification: makeVerification({ verifier: "goal", passed: false }),
    replanCount: 0,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "reobserve");
});

test("replan when action verification fails and budget available", () => {
  const result = decideNextStep({
    task: makeTask(),
    actionVerification: makeVerification({ verifier: "action", passed: false }),
    stateVerification: makeVerification({ verifier: "state", passed: true }),
    replanCount: 0,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "replan");
});

test("retry when verification fails and no retries yet but no replan budget", () => {
  const result = decideNextStep({
    task: makeTask({ retries: 0 }),
    actionVerification: makeVerification({ verifier: "action", passed: false }),
    replanCount: 3,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "retry_task");
});

test("abort when verification fails, no retries left, no replan budget", () => {
  const result = decideNextStep({
    task: makeTask({ retries: 1 }),
    actionVerification: makeVerification({ verifier: "action", passed: false }),
    replanCount: 3,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "abort");
  assert.ok(result.confidence >= 0.8);
});

test("continue with no verifications provided (all undefined)", () => {
  const result = decideNextStep({
    task: makeTask(),
    replanCount: 0,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "continue");
});

test("replan when state verification fails and budget available", () => {
  const result = decideNextStep({
    task: makeTask(),
    stateVerification: makeVerification({ verifier: "state", passed: false }),
    replanCount: 1,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "replan");
});
