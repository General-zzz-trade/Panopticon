import test from "node:test";
import assert from "node:assert/strict";
import { applyBeliefUpdates } from "./belief-updater";
import type { ExperimentResult, FailureHypothesis } from "./types";

function makeHypothesis(overrides: Partial<FailureHypothesis> = {}): FailureHypothesis {
  return {
    id: "hyp-1",
    kind: "selector_drift",
    explanation: "Selector may have drifted",
    confidence: 0.6,
    suggestedExperiments: [],
    recoveryHint: "Try visual fallback",
    ...overrides
  };
}

function makeExperiment(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    id: "exp-1",
    runId: "run-test",
    hypothesisId: "hyp-1",
    experiment: "check selector",
    outcome: "support",
    evidence: [],
    confidenceDelta: 0.15,
    ...overrides
  };
}

test("single supporting experiment increases confidence", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.6 })],
    experimentResults: [makeExperiment({ confidenceDelta: 0.15 })]
  });
  assert.equal(result.updatedHypotheses.length, 1);
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.75) < 0.001);
});

test("single refuting experiment decreases confidence", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.6 })],
    experimentResults: [makeExperiment({ confidenceDelta: -0.2 })]
  });
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.4) < 0.001);
});

test("confidence clamped to minimum 0.05", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.1 })],
    experimentResults: [makeExperiment({ confidenceDelta: -0.5 })]
  });
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.05) < 0.001);
});

test("confidence clamped to maximum 0.98", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.9 })],
    experimentResults: [makeExperiment({ confidenceDelta: 0.5 })]
  });
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.98) < 0.001);
});

test("multiple experiments for same hypothesis accumulate deltas", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ id: "hyp-1", confidence: 0.5 })],
    experimentResults: [
      makeExperiment({ hypothesisId: "hyp-1", confidenceDelta: 0.1 }),
      makeExperiment({ id: "exp-2", hypothesisId: "hyp-1", confidenceDelta: 0.1 })
    ]
  });
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.7) < 0.001);
});

test("no matching experiments leave confidence unchanged", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ id: "hyp-1", confidence: 0.6 })],
    experimentResults: [makeExperiment({ hypothesisId: "hyp-other", confidenceDelta: 0.3 })]
  });
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.6) < 0.001);
});

test("hypotheses sorted by confidence descending after update", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [
      makeHypothesis({ id: "hyp-low", confidence: 0.3 }),
      makeHypothesis({ id: "hyp-high", confidence: 0.8 })
    ],
    experimentResults: []
  });
  assert.equal(result.updatedHypotheses[0].id, "hyp-high");
  assert.equal(result.updatedHypotheses[1].id, "hyp-low");
});

test("belief updates are generated for each hypothesis", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [
      makeHypothesis({ id: "hyp-1" }),
      makeHypothesis({ id: "hyp-2" })
    ],
    experimentResults: []
  });
  assert.equal(result.beliefUpdates.length, 2);
  assert.ok(result.beliefUpdates.every((u) => u.runId === "run-test"));
});

test("empty hypotheses and experiments returns empty arrays", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [],
    experimentResults: []
  });
  assert.equal(result.updatedHypotheses.length, 0);
  assert.equal(result.beliefUpdates.length, 0);
});

test("selector probe experiment has higher weight than assertion overlap", () => {
  const selectorResult = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ id: "hyp-sel", confidence: 0.5 })],
    experimentResults: [makeExperiment({
      hypothesisId: "hyp-sel",
      experiment: "check selector presence in DOM",
      confidenceDelta: 0.2
    })]
  });

  const assertResult = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ id: "hyp-assert", confidence: 0.5 })],
    experimentResults: [makeExperiment({
      hypothesisId: "hyp-assert",
      experiment: "compare expected assertion text with visible text",
      confidenceDelta: 0.2
    })]
  });

  const selectorDelta = selectorResult.updatedHypotheses[0].confidence - 0.5;
  const assertDelta = assertResult.updatedHypotheses[0].confidence - 0.5;
  assert.ok(selectorDelta > assertDelta,
    `Selector delta ${selectorDelta} should be > assertion delta ${assertDelta}`);
});

test("unknown experiment type uses default weight", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.5 })],
    experimentResults: [makeExperiment({
      experiment: "some new experiment type",
      confidenceDelta: 0.2
    })]
  });
  // Default weight 0.75 → effective delta = 0.2 * 0.75 = 0.15
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.65) < 0.01);
});

test("readiness probe has medium weight", () => {
  const result = applyBeliefUpdates({
    runId: "run-test",
    hypotheses: [makeHypothesis({ confidence: 0.5 })],
    experimentResults: [makeExperiment({
      experiment: "wait briefly and inspect readiness signals",
      confidenceDelta: 0.2
    })]
  });
  // Readiness weight 0.8 → effective delta = 0.2 * 0.8 = 0.16
  assert.ok(Math.abs(result.updatedHypotheses[0].confidence - 0.66) < 0.01);
});
