import test from "node:test";
import assert from "node:assert/strict";

// Mock the persistence layer before importing self-model
// so tests don't depend on SQLite
import test_module from "node:module";

// We need to mock the persistence imports. Use a simple approach:
// override the functions after import.
let savedState: Record<string, unknown> = {};

test.before(() => {
  // Reset
  savedState = {};
});

// We'll test self-model logic by importing it and using an in-memory
// approach. The self-model functions accept a SelfModel object so we
// can create fresh ones for each test.

// Instead of mocking persistence, we create models directly.
import {
  createSelfModel,
  recordRunOutcome,
  getDomainProfile,
  getStrengthAssessment,
  suggestStrategyForDomain,
} from "./self-model";
import type { SelfModel, DomainProfile } from "./self-model";

function freshModel(): SelfModel {
  return {
    profiles: new Map(),
    overallSuccessRate: 0,
    totalRuns: 0,
    strongDomains: [],
    weakDomains: [],
  };
}

// ── recordRunOutcome ────────────────────────────────────────────────────────

test("recordRunOutcome updates domain profile", () => {
  const model = freshModel();

  recordRunOutcome(model, "e-commerce", true, 5, 1, []);
  const profile = getDomainProfile(model, "e-commerce");

  assert.ok(profile);
  assert.equal(profile!.totalRuns, 1);
  assert.equal(profile!.successCount, 1);
  assert.equal(profile!.successRate, 1);
  assert.equal(profile!.avgTaskCount, 5);
  assert.equal(profile!.avgReplanCount, 1);
});

test("recordRunOutcome accumulates across multiple runs", () => {
  const model = freshModel();

  recordRunOutcome(model, "e-commerce", true, 4, 0, []);
  recordRunOutcome(model, "e-commerce", false, 6, 2, ["selector drift"]);
  recordRunOutcome(model, "e-commerce", true, 5, 1, []);

  const profile = getDomainProfile(model, "e-commerce");
  assert.ok(profile);
  assert.equal(profile!.totalRuns, 3);
  assert.equal(profile!.successCount, 2);
  assert.ok(Math.abs(profile!.successRate - 2 / 3) < 0.01);
  assert.equal(profile!.avgTaskCount, 5); // (4+6+5)/3
  assert.equal(profile!.avgReplanCount, 1); // (0+2+1)/3
  assert.equal(profile!.commonFailures.length, 1);
  assert.equal(profile!.commonFailures[0].pattern, "selector drift");
});

test("recordRunOutcome tracks multiple domains independently", () => {
  const model = freshModel();

  recordRunOutcome(model, "e-commerce", true, 5, 0, []);
  recordRunOutcome(model, "crm", false, 8, 3, ["auth failure"]);

  assert.equal(model.totalRuns, 2);
  assert.equal(model.profiles.size, 2);
  assert.equal(getDomainProfile(model, "e-commerce")!.successRate, 1);
  assert.equal(getDomainProfile(model, "crm")!.successRate, 0);
});

test("recordRunOutcome accumulates failure pattern counts", () => {
  const model = freshModel();

  recordRunOutcome(model, "crm", false, 3, 1, ["selector not found"]);
  recordRunOutcome(model, "crm", false, 4, 2, ["selector not found", "timeout"]);

  const profile = getDomainProfile(model, "crm")!;
  const selectorFailure = profile.commonFailures.find(
    (f) => f.pattern === "selector not found"
  );
  assert.ok(selectorFailure);
  assert.equal(selectorFailure!.count, 2);
});

// ── getStrengthAssessment ───────────────────────────────────────────────────

test("getStrengthAssessment returns unknown for new domains", () => {
  const model = freshModel();

  const assessment = getStrengthAssessment(model, "unknown-domain");
  assert.equal(assessment.strength, "unknown");
  assert.equal(assessment.confidence, 0);
  assert.ok(assessment.rationale.includes("No historical data"));
});

test("getStrengthAssessment returns unknown for insufficient data", () => {
  const model = freshModel();
  recordRunOutcome(model, "new-domain", true, 3, 0, []);

  const assessment = getStrengthAssessment(model, "new-domain");
  assert.equal(assessment.strength, "unknown");
  assert.ok(assessment.rationale.includes("insufficient"));
});

test("getStrengthAssessment returns strong after many successes", () => {
  const model = freshModel();

  for (let i = 0; i < 10; i++) {
    recordRunOutcome(model, "web-scraping", true, 4, 0, []);
  }

  const assessment = getStrengthAssessment(model, "web-scraping");
  assert.equal(assessment.strength, "strong");
  assert.ok(assessment.confidence > 0.4);
  assert.ok(assessment.rationale.includes("100%"));
});

test("getStrengthAssessment returns weak after many failures", () => {
  const model = freshModel();

  for (let i = 0; i < 5; i++) {
    recordRunOutcome(model, "complex-forms", false, 8, 3, [
      "element not found",
    ]);
  }

  const assessment = getStrengthAssessment(model, "complex-forms");
  assert.equal(assessment.strength, "weak");
  assert.ok(assessment.rationale.includes("0%"));
  assert.ok(assessment.rationale.includes("element not found"));
});

test("getStrengthAssessment returns moderate for mixed results", () => {
  const model = freshModel();

  recordRunOutcome(model, "mixed", true, 4, 0, []);
  recordRunOutcome(model, "mixed", false, 5, 1, []);
  recordRunOutcome(model, "mixed", true, 4, 0, []);

  const assessment = getStrengthAssessment(model, "mixed");
  assert.equal(assessment.strength, "moderate");
});

// ── suggestStrategyForDomain ────────────────────────────────────────────────

test("suggestStrategyForDomain returns suggestions for unknown domain", () => {
  const model = freshModel();

  const suggestions = suggestStrategyForDomain(model, "new-domain");
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.some((s) => /conservative/i.test(s)));
});

test("suggestStrategyForDomain suggests based on common failures", () => {
  const model = freshModel();

  for (let i = 0; i < 5; i++) {
    recordRunOutcome(model, "fragile-ui", false, 6, 2, [
      "selector mismatch",
      "timeout waiting for element",
    ]);
  }

  const suggestions = suggestStrategyForDomain(model, "fragile-ui");
  assert.ok(suggestions.length > 0);
  assert.ok(
    suggestions.some((s) => /selector/i.test(s)),
    "Should suggest selector improvements"
  );
  assert.ok(
    suggestions.some((s) => /timeout/i.test(s)),
    "Should suggest timeout improvements"
  );
});

test("suggestStrategyForDomain suggests efficiency for strong domains", () => {
  const model = freshModel();

  for (let i = 0; i < 5; i++) {
    recordRunOutcome(model, "strong-domain", true, 3, 0, []);
  }

  const suggestions = suggestStrategyForDomain(model, "strong-domain");
  assert.ok(suggestions.some((s) => /aggressive|parallel/i.test(s)));
});

test("suggestStrategyForDomain flags high replan rate", () => {
  const model = freshModel();

  for (let i = 0; i < 4; i++) {
    recordRunOutcome(model, "replan-heavy", true, 5, 4, []);
  }

  const suggestions = suggestStrategyForDomain(model, "replan-heavy");
  assert.ok(suggestions.some((s) => /replan/i.test(s)));
});
