import test from "node:test";
import assert from "node:assert/strict";
import { criterionSuccessCount, criterionOutputContains, criterionCustom } from "./goal-driven";
import type { SubagentArtifact } from "./goal-driven";

function art(success: boolean, output: string, iteration = 0): SubagentArtifact {
  return { iteration, goal: "", success, summary: "", output, createdAt: new Date().toISOString() };
}

test("criterionSuccessCount passes when enough successes", async () => {
  const c = criterionSuccessCount(2);
  assert.equal(await c.check([art(true, ""), art(false, ""), art(true, "")]), true);
});

test("criterionSuccessCount fails when not enough", async () => {
  const c = criterionSuccessCount(3);
  assert.equal(await c.check([art(true, ""), art(true, "")]), false);
});

test("criterionOutputContains matches last output", async () => {
  const c = criterionOutputContains("completed");
  assert.equal(await c.check([art(true, "the task is completed successfully")]), true);
});

test("criterionOutputContains is case-insensitive", async () => {
  const c = criterionOutputContains("DONE");
  assert.equal(await c.check([art(true, "we are done here")]), true);
});

test("criterionOutputContains fails when text missing", async () => {
  const c = criterionOutputContains("failed");
  assert.equal(await c.check([art(true, "everything is fine")]), false);
});

test("criterionCustom evaluates function", async () => {
  const c = criterionCustom("has_three", "at least 3 artifacts", arts => arts.length >= 3);
  assert.equal(await c.check([art(true, "")]), false);
  assert.equal(await c.check([art(true, ""), art(true, ""), art(true, "")]), true);
});

test("criterionOutputContains handles empty artifacts", async () => {
  const c = criterionOutputContains("anything");
  assert.equal(await c.check([]), false);
});
