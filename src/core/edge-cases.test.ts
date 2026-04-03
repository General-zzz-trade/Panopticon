import test from "node:test";
import assert from "node:assert/strict";
import { runGoal } from "./runtime";

test("runGoal handles very long goal string", async () => {
  const longGoal = "open page ".repeat(500);
  const result = await runGoal(longGoal);
  // Should not crash — just produce some result
  assert.ok(result.runId);
  assert.ok(result.result);
});

test("runGoal handles special characters in goal", async () => {
  const result = await runGoal('click "<script>alert(1)</script>"');
  assert.ok(result.runId);
  // Should not execute the script — just plan it as a task
});

test("runGoal handles unicode goal", async () => {
  const result = await runGoal('点击 "登录" 然后 输入 "用户名"');
  assert.ok(result.runId);
});

test("concurrent runGoal calls do not interfere", async () => {
  const [r1, r2, r3] = await Promise.all([
    runGoal("goal A"),
    runGoal("goal B"),
    runGoal("goal C")
  ]);

  // Each should have unique run IDs
  const ids = new Set([r1.runId, r2.runId, r3.runId]);
  assert.equal(ids.size, 3);
});

test("runGoal with tenantId sets tenant context", async () => {
  const result = await runGoal("test", { tenantId: "custom-tenant" });
  assert.equal(result.tenantId, "custom-tenant");
});
