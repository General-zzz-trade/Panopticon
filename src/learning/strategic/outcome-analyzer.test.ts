import test from "node:test";
import assert from "node:assert/strict";
import {
  recordOutcome,
  analyzeDomain,
  getEffectiveStrategies,
  getIneffectiveStrategies,
  clearOutcomes,
  type RunOutcomeSummary,
} from "./outcome-analyzer";

function makeSummary(
  overrides: Partial<RunOutcomeSummary> = {}
): RunOutcomeSummary {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    domain: "test.com",
    goal: "test goal",
    success: true,
    taskCount: 5,
    replanCount: 0,
    failedTaskTypes: [],
    recoveryStrategiesUsed: [],
    durationMs: 1000,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

test("outcome-analyzer", async (t) => {
  t.beforeEach(() => {
    clearOutcomes();
  });

  await t.test("recordOutcome stores and analyzeDomain returns correct stats", () => {
    recordOutcome(makeSummary({ success: true, replanCount: 1 }));
    recordOutcome(makeSummary({ success: true, replanCount: 3 }));
    recordOutcome(makeSummary({ success: false, replanCount: 2, failedTaskTypes: ["click"] }));

    const analysis = analyzeDomain("test.com");
    assert.equal(analysis.totalRuns, 3);
    assert.ok(Math.abs(analysis.successRate - 2 / 3) < 0.01);
    assert.equal(analysis.avgReplans, 2);
    assert.equal(analysis.topFailureTypes.length, 1);
    assert.equal(analysis.topFailureTypes[0].type, "click");
    assert.equal(analysis.topFailureTypes[0].count, 1);
  });

  await t.test("getEffectiveStrategies ranks by success rate", () => {
    // "visual_fallback" used in 3 runs, 2 successful => 66%
    recordOutcome(makeSummary({ success: true, recoveryStrategiesUsed: ["visual_fallback"] }));
    recordOutcome(makeSummary({ success: true, recoveryStrategiesUsed: ["visual_fallback"] }));
    recordOutcome(makeSummary({ success: false, recoveryStrategiesUsed: ["visual_fallback"] }));

    // "selector_recovery" used in 3 runs, 1 successful => 33%
    recordOutcome(makeSummary({ success: true, recoveryStrategiesUsed: ["selector_recovery"] }));
    recordOutcome(makeSummary({ success: false, recoveryStrategiesUsed: ["selector_recovery"] }));
    recordOutcome(makeSummary({ success: false, recoveryStrategiesUsed: ["selector_recovery"] }));

    // "retry_wait" used in 2 runs, 2 successful => 100%
    recordOutcome(makeSummary({ success: true, recoveryStrategiesUsed: ["retry_wait"] }));
    recordOutcome(makeSummary({ success: true, recoveryStrategiesUsed: ["retry_wait"] }));

    const effective = getEffectiveStrategies("test.com");
    assert.ok(effective.length >= 2);
    // retry_wait should be first (100%), then visual_fallback (66%)
    assert.equal(effective[0].strategy, "retry_wait");
    assert.equal(effective[0].successRate, 1);
    assert.equal(effective[1].strategy, "visual_fallback");

    const ineffective = getIneffectiveStrategies("test.com");
    assert.equal(ineffective.length, 1);
    assert.equal(ineffective[0].strategy, "selector_recovery");
  });

  await t.test("handles empty data gracefully", () => {
    const analysis = analyzeDomain("nonexistent.com");
    assert.equal(analysis.totalRuns, 0);
    assert.equal(analysis.successRate, 0);
    assert.equal(analysis.avgReplans, 0);
    assert.deepEqual(analysis.topFailureTypes, []);
    assert.deepEqual(analysis.effectiveStrategies, []);
    assert.deepEqual(analysis.ineffectiveStrategies, []);

    const effective = getEffectiveStrategies("nonexistent.com");
    assert.deepEqual(effective, []);

    const ineffective = getIneffectiveStrategies("nonexistent.com");
    assert.deepEqual(ineffective, []);
  });

  await t.test("caps outcomes at 500", () => {
    for (let i = 0; i < 510; i++) {
      recordOutcome(makeSummary({ runId: `run-${i}` }));
    }
    const analysis = analyzeDomain("test.com");
    assert.equal(analysis.totalRuns, 500);
  });
});
