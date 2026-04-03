import test from "node:test";
import assert from "node:assert/strict";
import { decideNextStep } from "../cognition/executive-controller";

test("decideNextStep: abort when all budgets exhausted", () => {
  const result = decideNextStep({
    task: { id: "t1", type: "click", status: "running", retries: 3, attempts: 5, replanDepth: 0, payload: {} } as any,
    stateVerification: { runId: "r", taskId: "t1", verifier: "state", passed: false, confidence: 0.9, rationale: "fail", evidence: [] },
    replanCount: 3,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "abort");
});

test("decideNextStep: retry when retries not exhausted and no replan budget", () => {
  const result = decideNextStep({
    task: { id: "t1", type: "click", status: "running", retries: 0, attempts: 1, replanDepth: 0, payload: {} } as any,
    stateVerification: { runId: "r", taskId: "t1", verifier: "state", passed: false, confidence: 0.9, rationale: "fail", evidence: [] },
    replanCount: 3,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "retry_task");
});

test("decideNextStep: continue when all verifications pass", () => {
  const result = decideNextStep({
    task: { id: "t1", type: "click", status: "running", retries: 0, attempts: 1, replanDepth: 0, payload: {} } as any,
    actionVerification: { runId: "r", taskId: "t1", verifier: "action", passed: true, confidence: 0.9, rationale: "ok", evidence: [] },
    stateVerification: { runId: "r", taskId: "t1", verifier: "state", passed: true, confidence: 0.9, rationale: "ok", evidence: [] },
    replanCount: 0,
    maxReplans: 3
  });
  assert.equal(result.nextAction, "continue");
});
