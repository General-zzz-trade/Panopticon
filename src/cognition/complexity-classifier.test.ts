import test from "node:test";
import assert from "node:assert/strict";
import { classifyComplexity, estimateModeCost } from "./complexity-classifier";

test("DSL goal → fast mode + sequential", () => {
  const r = classifyComplexity('open page "https://example.com" and assert text "Welcome"');
  assert.equal(r.mode, "fast");
  assert.equal(r.suggestedExecutionMode, "sequential");
  assert.ok(r.signals.some(s => s.startsWith("dsl_markers")));
});

test("abstract reasoning → slow mode + react", () => {
  const r = classifyComplexity("analyze this pattern and explain why it works");
  assert.equal(r.mode, "slow");
  assert.equal(r.suggestedExecutionMode, "react");
});

test("shell task → cli mode", () => {
  const r = classifyComplexity("run ls to find all python files and show git status");
  assert.equal(r.suggestedExecutionMode, "cli");
  assert.ok(r.signals.some(s => s.startsWith("shell")));
});

test("vague NL goal → hybrid or slow", () => {
  const r = classifyComplexity("find something interesting on this website");
  assert.ok(r.mode === "slow" || r.mode === "hybrid");
  assert.ok(r.signals.some(s => s.startsWith("vague")));
});

test("multi-step goal → higher complexity", () => {
  const simple = classifyComplexity('open page "http://x.com"');
  const multi = classifyComplexity("open the page then click login then verify the dashboard appears");
  assert.ok(multi.score >= simple.score);
});

test("short DSL beats short vague", () => {
  const dsl = classifyComplexity('screenshot');
  const vague = classifyComplexity('help me');
  assert.equal(dsl.mode, "fast");
  assert.ok(vague.score > dsl.score);
});

test("estimateModeCost orders correctly", () => {
  const seq = estimateModeCost("sequential", 50);
  const cli = estimateModeCost("cli", 50);
  const react = estimateModeCost("react", 50);
  assert.ok(seq < cli);
  assert.ok(cli < react);
});

test("rationale is non-empty", () => {
  const r = classifyComplexity("do something");
  assert.ok(r.rationale.length > 0);
});
