import test from "node:test";
import assert from "node:assert/strict";
import { isComputerUseConfigured } from "./agent";

test("isComputerUseConfigured checks ANTHROPIC_API_KEY", () => {
  const orig = process.env.ANTHROPIC_API_KEY;

  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(isComputerUseConfigured(), false);

  process.env.ANTHROPIC_API_KEY = "test-key";
  assert.equal(isComputerUseConfigured(), true);

  if (orig) {
    process.env.ANTHROPIC_API_KEY = orig;
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("computer-use module exports expected functions", async () => {
  const mod = await import("./agent");
  assert.ok(typeof mod.isComputerUseConfigured === "function");
  assert.ok(typeof mod.runComputerUseGoal === "function");
});
