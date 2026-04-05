import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkingMemory,
  updateFocus,
  switchFocus,
  recordReasoning,
  getRecentReasoning,
  detectReasoningLoop,
  recordFact,
  getFact,
  getAllFacts,
  tickFacts,
  recordFailurePattern,
  getFailurePatterns,
  isPatternExceeded,
  stepWorkingMemory
} from "./working-memory";
import type { AgentTask } from "../types";

function makeTask(id: string, type: string = "click"): AgentTask {
  return { id, type: type as any, status: "pending", retries: 0, attempts: 0, replanDepth: 0, payload: {} };
}

test("createWorkingMemory initializes with goal as focus", () => {
  const wm = createWorkingMemory("open page and click login");
  assert.equal(wm.focus.currentObjective, "open page and click login");
  assert.equal(wm.focus.momentum, 0);
  assert.equal(wm.stepCount, 0);
});

test("updateFocus tracks momentum on success", () => {
  const wm = createWorkingMemory("test");
  updateFocus(wm, makeTask("t1"), true);
  assert.equal(wm.focus.momentum, 1);
  updateFocus(wm, makeTask("t2"), true);
  assert.equal(wm.focus.momentum, 2);
  updateFocus(wm, makeTask("t3"), false);
  assert.equal(wm.focus.momentum, 0);
});

test("switchFocus resets state", () => {
  const wm = createWorkingMemory("original");
  updateFocus(wm, makeTask("t1"), true);
  switchFocus(wm, "new objective", "replan after failure");
  assert.equal(wm.focus.currentObjective, "new objective");
  assert.equal(wm.focus.momentum, 0);
  assert.equal(wm.focus.switchReason, "replan after failure");
});

test("recordReasoning and getRecentReasoning", () => {
  const wm = createWorkingMemory("test");
  recordReasoning(wm, "t1", "continue", "all good", 0.9);
  recordReasoning(wm, "t2", "replan", "selector drift", 0.6);
  recordReasoning(wm, "t3", "continue", "recovered", 0.8);
  const recent = getRecentReasoning(wm, 2);
  assert.equal(recent.length, 2);
  assert.equal(recent[0].taskId, "t2");
  assert.equal(recent[1].taskId, "t3");
});

test("reasoningStack capped at 20", () => {
  const wm = createWorkingMemory("test");
  for (let i = 0; i < 25; i++) {
    recordReasoning(wm, `t${i}`, "continue", "ok", 0.9);
  }
  assert.equal(wm.reasoningStack.length, 20);
});

test("detectReasoningLoop detects repeated patterns", () => {
  const wm = createWorkingMemory("test");
  for (let i = 0; i < 8; i++) {
    recordReasoning(wm, `t${i}`, "replan", "same error", 0.5);
  }
  assert.equal(detectReasoningLoop(wm, 4), true);
});

test("detectReasoningLoop returns false for varied decisions", () => {
  const wm = createWorkingMemory("test");
  recordReasoning(wm, "t1", "continue", "ok", 0.9);
  recordReasoning(wm, "t2", "replan", "error", 0.5);
  recordReasoning(wm, "t3", "continue", "recovered", 0.8);
  recordReasoning(wm, "t4", "continue", "all good", 0.9);
  assert.equal(detectReasoningLoop(wm, 2), false);
});

test("facts with TTL expire after ticks", () => {
  const wm = createWorkingMemory("test");
  recordFact(wm, "url", "http://test.com", "t1", 2);
  assert.equal(getFact(wm, "url"), "http://test.com");
  tickFacts(wm);
  assert.equal(getFact(wm, "url"), "http://test.com");
  tickFacts(wm);
  assert.equal(getFact(wm, "url"), undefined);
});

test("recordFact overwrites existing key", () => {
  const wm = createWorkingMemory("test");
  recordFact(wm, "url", "http://a.com", "t1");
  recordFact(wm, "url", "http://b.com", "t2");
  assert.equal(getFact(wm, "url"), "http://b.com");
  assert.equal(wm.facts.length, 1);
});

test("getAllFacts returns only live facts", () => {
  const wm = createWorkingMemory("test");
  recordFact(wm, "a", "1", "t1", 1);
  recordFact(wm, "b", "2", "t1", 3);
  tickFacts(wm);
  const facts = getAllFacts(wm);
  assert.equal(facts["a"], undefined);
  assert.equal(facts["b"], "2");
});

test("failure patterns accumulate and suggest shifts", () => {
  const wm = createWorkingMemory("test");
  const task = makeTask("t1", "click");
  recordFailurePattern(wm, task, "selector not found");
  recordFailurePattern(wm, task, "locator not matched");
  const patterns = getFailurePatterns(wm);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].count, 2);
  assert.equal(patterns[0].errorPattern, "selector_miss");
  assert.equal(patterns[0].suggestedShift, "switch_to_visual");
});

test("isPatternExceeded returns signature above threshold", () => {
  const wm = createWorkingMemory("test");
  const task = makeTask("t1", "click");
  recordFailurePattern(wm, task, "not found");
  recordFailurePattern(wm, task, "not found");
  recordFailurePattern(wm, task, "not found");
  const sig = isPatternExceeded(wm, "click", 3);
  assert.ok(sig);
  assert.equal(sig!.count, 3);
});

test("stepWorkingMemory increments counter and ages facts", () => {
  const wm = createWorkingMemory("test");
  recordFact(wm, "x", "y", "t1", 1);
  stepWorkingMemory(wm);
  assert.equal(wm.stepCount, 1);
  assert.equal(getFact(wm, "x"), undefined);
});
