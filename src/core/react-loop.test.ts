import test from "node:test";
import assert from "node:assert/strict";
import { isReactConfigured } from "./react-loop";

test("isReactConfigured returns false when env vars not set", () => {
  const orig = process.env.LLM_REACT_PROVIDER;
  delete process.env.LLM_REACT_PROVIDER;
  assert.equal(isReactConfigured(), false);
  if (orig) process.env.LLM_REACT_PROVIDER = orig;
});

test("runReactGoal module exports expected functions", async () => {
  const mod = await import("./react-loop");
  assert.ok(typeof mod.isReactConfigured === "function");
  assert.ok(typeof mod.runReactGoal === "function");
});
