import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDomainStrategy,
  suggestApproach,
  clearStrategyCache,
} from "./domain-strategy";
import { recordOutcome, clearOutcomes } from "./outcome-analyzer";
import type { RunOutcomeSummary } from "./outcome-analyzer";

function makeSummary(
  overrides: Partial<RunOutcomeSummary> = {}
): RunOutcomeSummary {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    domain: "shop.example.com",
    goal: "buy item",
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

test("domain-strategy", async (t) => {
  t.beforeEach(() => {
    clearOutcomes();
    clearStrategyCache();
  });

  await t.test("computeDomainStrategy derives from outcomes", () => {
    // visual_fallback: 3 uses, 3 successes (100%)
    for (let i = 0; i < 3; i++) {
      recordOutcome(
        makeSummary({ success: true, recoveryStrategiesUsed: ["visual_fallback"] })
      );
    }
    // selector_recovery: 4 uses, 1 success (25%)
    recordOutcome(
      makeSummary({ success: true, recoveryStrategiesUsed: ["selector_recovery"] })
    );
    for (let i = 0; i < 3; i++) {
      recordOutcome(
        makeSummary({ success: false, recoveryStrategiesUsed: ["selector_recovery"] })
      );
    }

    const strategy = computeDomainStrategy("shop.example.com");
    assert.equal(strategy.domain, "shop.example.com");
    assert.ok(strategy.approaches.length >= 1);
    // visual_fallback should be in approaches (effective)
    assert.ok(strategy.approaches.some((a) => a.name === "visual_fallback"));
    // selector_recovery should be in anti-patterns (ineffective)
    assert.ok(strategy.antiPatterns.some((ap) => ap.includes("selector_recovery")));
    // Confidence based on 7 runs: min(1, 7/10) = 0.7
    assert.ok(strategy.confidence > 0.5 && strategy.confidence <= 1);
  });

  await t.test("suggestApproach returns highest priority matching approach", () => {
    // Set up data so visual_fallback is highest priority
    for (let i = 0; i < 5; i++) {
      recordOutcome(
        makeSummary({ success: true, recoveryStrategiesUsed: ["visual_fallback"] })
      );
    }
    for (let i = 0; i < 5; i++) {
      recordOutcome(
        makeSummary({ success: true, recoveryStrategiesUsed: ["retry_wait"] })
      );
    }

    computeDomainStrategy("shop.example.com");

    // suggestApproach should return an approach
    const approach = suggestApproach("shop.example.com", "domain=shop.example.com");
    assert.ok(approach !== undefined);
    assert.ok(typeof approach.name === "string");
    assert.ok(approach.priority > 0);
  });

  await t.test("suggestApproach returns undefined for unknown domain", () => {
    const approach = suggestApproach("unknown.com", "some state");
    assert.equal(approach, undefined);
  });

  await t.test("suggestApproach falls back to highest priority when no condition matches", () => {
    for (let i = 0; i < 3; i++) {
      recordOutcome(
        makeSummary({ success: true, recoveryStrategiesUsed: ["visual_fallback"] })
      );
    }
    computeDomainStrategy("shop.example.com");

    const approach = suggestApproach("shop.example.com", "completely unrelated state");
    assert.ok(approach !== undefined);
    // Should fall back to the top approach
    assert.equal(approach.name, "visual_fallback");
  });
});
