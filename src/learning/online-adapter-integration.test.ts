import test from "node:test";
import assert from "node:assert/strict";
import { createOnlineAdapterState, recordInRunFailure, suggestAdaptation } from "./online-adapter";

test("suggestAdaptation returns visual strategy after selector failure", () => {
  const state = createOnlineAdapterState();
  const task = { id: "t1", type: "click" as const, status: "failed" as const, retries: 0, attempts: 1, replanDepth: 0, payload: { selector: "#btn" } };

  recordInRunFailure(state, task, "selector not found", 0);

  const adaptation = suggestAdaptation(state, task);
  assert.ok(adaptation !== null);
  assert.equal(adaptation!.strategy, "visual_click");
  assert.ok(adaptation!.reason.includes("#btn"));
});

test("suggestAdaptation returns add_wait after repeated type failures", () => {
  const state = createOnlineAdapterState();
  const task = { id: "t1", type: "type" as const, status: "failed" as const, retries: 0, attempts: 1, replanDepth: 0, payload: { selector: "#input", value: "hello" } };

  // Record 3 failures for same task type
  recordInRunFailure(state, task, "timeout", 0);
  recordInRunFailure(state, { ...task, id: "t2" }, "timeout", 1);
  recordInRunFailure(state, { ...task, id: "t3" }, "timeout", 2);

  // Now ask for adaptation on a task of same type but different selector
  const newTask = { ...task, id: "t4", payload: { selector: "#other", value: "world" } };
  const adaptation = suggestAdaptation(state, newTask);
  assert.ok(adaptation !== null);
  assert.equal(adaptation!.strategy, "add_wait");
});

test("suggestAdaptation returns null when no failures", () => {
  const state = createOnlineAdapterState();
  const task = { id: "t1", type: "click" as const, status: "pending" as const, retries: 0, attempts: 0, replanDepth: 0, payload: { selector: "#btn" } };

  const adaptation = suggestAdaptation(state, task);
  assert.equal(adaptation, null);
});
