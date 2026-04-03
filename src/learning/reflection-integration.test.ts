import test from "node:test";
import assert from "node:assert/strict";
import { runReflection, getAdjustedPrior } from "./reflection-loop";
import { applyInsights } from "./strategy-updater";

test("runReflection returns valid insight structure", () => {
  const insight = runReflection();
  assert.ok(typeof insight.hypothesisSuccessRates === "object");
  assert.ok(typeof insight.taskTypeFailureRates === "object");
  assert.ok(Array.isArray(insight.dominantRecoveryStrategies));
  assert.ok(Array.isArray(insight.recommendations));
});

test("applyInsights returns count of applied strategies", () => {
  const insight = runReflection();
  const applied = applyInsights(insight);
  assert.ok(typeof applied === "number");
  assert.ok(applied >= 0);
});

test("getAdjustedPrior blends base confidence with learned rate", () => {
  const insight = runReflection();
  // With no data, should return close to base
  const adjusted = getAdjustedPrior("selector_drift", 0.68, insight);
  assert.ok(adjusted >= 0);
  assert.ok(adjusted <= 1);
});

test("getAdjustedPrior returns base when no data for kind", () => {
  const emptyInsight = {
    hypothesisSuccessRates: {},
    taskTypeFailureRates: {},
    dominantRecoveryStrategies: [],
    recommendations: []
  };
  const adjusted = getAdjustedPrior("selector_drift", 0.68, emptyInsight);
  assert.equal(adjusted, 0.68);
});

test("reflection and strategy updater pipeline works end-to-end", () => {
  // This tests that the full pipeline runs without error
  const insight = runReflection();
  const applied = applyInsights(insight);

  // Run reflection again — should still work
  const insight2 = runReflection();
  assert.ok(typeof insight2.hypothesisSuccessRates === "object");
});
