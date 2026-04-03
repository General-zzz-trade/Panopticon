import test from "node:test";
import assert from "node:assert/strict";
import { isLLMDecisionConfigured, llmDecideNextStep } from "./llm-decision";

test("isLLMDecisionConfigured returns false when no env vars set", () => {
  // No LLM_DECISION_PROVIDER set, so should be false
  const original = process.env.LLM_DECISION_PROVIDER;
  delete process.env.LLM_DECISION_PROVIDER;
  assert.equal(isLLMDecisionConfigured(), false);
  if (original) process.env.LLM_DECISION_PROVIDER = original;
});

test("llmDecideNextStep falls back to rule-based when LLM not configured", async () => {
  const original = process.env.LLM_DECISION_PROVIDER;
  delete process.env.LLM_DECISION_PROVIDER;

  const decision = await llmDecideNextStep({
    task: { id: "t1", type: "click", status: "running", retries: 0, attempts: 1, replanDepth: 0, payload: {} } as any,
    goal: "test",
    actionVerification: { runId: "r", taskId: "t1", verifier: "action", passed: true, confidence: 0.9, rationale: "ok", evidence: [] },
    stateVerification: { runId: "r", taskId: "t1", verifier: "state", passed: true, confidence: 0.9, rationale: "ok", evidence: [] },
    replanCount: 0,
    maxReplans: 3,
    completedTasks: [],
    remainingTasks: [],
    failureHistory: []
  });

  assert.equal(decision.nextAction, "continue");
  assert.ok(decision.confidence > 0);

  if (original) process.env.LLM_DECISION_PROVIDER = original;
});

test("llmDecideNextStep falls back to replan on failure", async () => {
  const decision = await llmDecideNextStep({
    task: { id: "t1", type: "click", status: "running", retries: 0, attempts: 1, replanDepth: 0, payload: {} } as any,
    goal: "test",
    stateVerification: { runId: "r", taskId: "t1", verifier: "state", passed: false, confidence: 0.9, rationale: "fail", evidence: [] },
    replanCount: 0,
    maxReplans: 3,
    completedTasks: [],
    remainingTasks: [],
    failureHistory: []
  });

  // Without LLM, should fall back to rule-based: replan since budget available
  assert.equal(decision.nextAction, "replan");
});
