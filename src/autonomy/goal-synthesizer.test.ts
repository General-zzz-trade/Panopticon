import test from "node:test";
import assert from "node:assert/strict";
import { registerRule, clearRules, synthesizeGoal, registerDefaultRules, listRules } from "./goal-synthesizer";

test("clearRules empties rule list", () => {
  clearRules();
  registerRule({ triggerType: "test", synthesize: () => "goal" });
  assert.equal(listRules().length, 1);
  clearRules();
  assert.equal(listRules().length, 0);
});

test("synthesizeGoal matches by trigger type", () => {
  clearRules();
  registerRule({ triggerType: "file_changed", synthesize: (t) => `handle ${t.data.path}` });
  const result = synthesizeGoal({
    type: "file_changed",
    source: "test",
    timestamp: new Date().toISOString(),
    data: { path: "/tmp/x.txt" }
  });
  assert.ok(result);
  assert.equal(result!.goal, "handle /tmp/x.txt");
});

test("synthesizeGoal returns null when no rule matches", () => {
  clearRules();
  const result = synthesizeGoal({
    type: "unknown_type",
    source: "test",
    timestamp: new Date().toISOString(),
    data: {}
  });
  assert.equal(result, null);
});

test("synthesizeGoal respects filter", () => {
  clearRules();
  registerRule({
    triggerType: "file_changed",
    filter: (t) => (t.data.path as string).endsWith(".ts"),
    synthesize: () => "ts file goal"
  });
  const result = synthesizeGoal({
    type: "file_changed",
    source: "test",
    timestamp: "",
    data: { path: "/tmp/x.txt" }
  });
  assert.equal(result, null);
});

test("synthesizeGoal picks higher priority rule", () => {
  clearRules();
  registerRule({ triggerType: "x", priority: 1, synthesize: () => "low" });
  registerRule({ triggerType: "x", priority: 10, synthesize: () => "high" });
  const result = synthesizeGoal({ type: "x", source: "", timestamp: "", data: {} });
  assert.equal(result!.goal, "high");
});

test("registerDefaultRules adds file_changed rule", () => {
  clearRules();
  registerDefaultRules();
  const result = synthesizeGoal({
    type: "file_changed",
    source: "test",
    timestamp: "",
    data: { path: "/tmp/test.txt" }
  });
  assert.ok(result);
  assert.equal(result!.mode, "cli");
  assert.ok(result!.goal.includes("/tmp/test.txt"));
});
