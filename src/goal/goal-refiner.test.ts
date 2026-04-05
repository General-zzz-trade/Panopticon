import test from "node:test";
import assert from "node:assert/strict";
import { refineGoalCriteria } from "./goal-refiner";
import type { SuccessCriterion } from "./types";
import type { AgentObservation } from "../cognition/types";
import type { RunContext } from "../types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeObservation(overrides: Partial<AgentObservation> = {}): AgentObservation {
  return {
    id: "obs-1",
    runId: "run-1",
    timestamp: new Date().toISOString(),
    source: "task_observe",
    anomalies: [],
    confidence: 0.8,
    ...overrides,
  };
}

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-1",
    goal: "test goal",
    tasks: [],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 0,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 2 },
    startedAt: new Date().toISOString(),
    escalationDecisions: [],
    ...overrides,
  };
}

// ── Text refinement ──────────────────────────────────────────────────────────

test("refines text criterion when similar text is visible", () => {
  const criteria: SuccessCriterion[] = [
    { type: "text_present", value: "Dashboard", confidence: 0.7, source: "dsl" },
  ];
  const obs = makeObservation({ visibleText: ["Welcome to our platform"] });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, true);
  assert.equal(result.updatedCriteria.length, 1);
  assert.equal(result.updatedCriteria[0].type, "text_present");
  assert.equal(result.updatedCriteria[0].value, "welcome");
  assert.ok(result.updatedCriteria[0].confidence < criteria[0].confidence);
  assert.ok(result.reason.includes("not found"));
});

test("does not refine text criterion when exact text is present", () => {
  const criteria: SuccessCriterion[] = [
    { type: "text_present", value: "Dashboard", confidence: 0.7, source: "dsl" },
  ];
  const obs = makeObservation({ visibleText: ["Dashboard"] });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, false);
  assert.equal(result.updatedCriteria[0].value, "Dashboard");
});

test("does not refine user-stated criteria", () => {
  const criteria: SuccessCriterion[] = [
    { type: "text_present", value: "Dashboard", confidence: 1.0, source: "user" },
  ];
  const obs = makeObservation({ visibleText: ["Welcome to our platform"] });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, false);
  assert.equal(result.updatedCriteria[0].value, "Dashboard");
});

// ── URL refinement ───────────────────────────────────────────────────────────

test("refines URL criterion when partial match exists", () => {
  const criteria: SuccessCriterion[] = [
    { type: "url_reached", value: "https://example.com/dashboard", confidence: 0.7, source: "dsl" },
  ];
  const obs = makeObservation({ pageUrl: "https://example.com/home" });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, true);
  assert.equal(result.updatedCriteria[0].type, "url_reached");
  assert.equal(result.updatedCriteria[0].value, "https://example.com/home");
  assert.ok(result.updatedCriteria[0].confidence < criteria[0].confidence);
});

test("does not refine URL criterion when already matching", () => {
  const criteria: SuccessCriterion[] = [
    { type: "url_reached", value: "https://example.com/dashboard", confidence: 0.8, source: "dsl" },
  ];
  const obs = makeObservation({ pageUrl: "https://example.com/dashboard" });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, false);
});

test("does not refine URL criterion when hosts differ", () => {
  const criteria: SuccessCriterion[] = [
    { type: "url_reached", value: "https://example.com/dash", confidence: 0.7, source: "dsl" },
  ];
  const obs = makeObservation({ pageUrl: "https://other-site.io/dash" });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, false);
});

// ── Element refinement ───────────────────────────────────────────────────────

test("refines element criterion when similar actionable element found", () => {
  const criteria: SuccessCriterion[] = [
    { type: "element_exists", value: "#submit-button", confidence: 0.6, source: "dsl" },
  ];
  const obs = makeObservation({
    actionableElements: [
      { role: "button", text: "Submit Order", selector: ".btn-submit", confidence: 0.9 },
    ],
  });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, true);
  assert.equal(result.updatedCriteria[0].type, "element_exists");
  assert.equal(result.updatedCriteria[0].value, ".btn-submit");
  assert.ok(result.reason.includes("similar element"));
});

// ── No-op cases ──────────────────────────────────────────────────────────────

test("returns unrefined when no observation data available", () => {
  const criteria: SuccessCriterion[] = [
    { type: "text_present", value: "Dashboard", confidence: 0.7, source: "dsl" },
  ];
  const obs = makeObservation({}); // no visibleText, no pageUrl, no actionable
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, false);
  assert.equal(result.updatedCriteria[0].value, "Dashboard");
});

test("returns unrefined when criteria array is empty", () => {
  const obs = makeObservation({ visibleText: ["Hello"] });
  const ctx = makeContext();

  const result = refineGoalCriteria([], obs, ctx);

  assert.equal(result.refined, false);
  assert.equal(result.reason, "no criteria to refine");
});

test("handles multiple criteria and refines only applicable ones", () => {
  const criteria: SuccessCriterion[] = [
    { type: "text_present", value: "Dashboard", confidence: 0.7, source: "dsl" },
    { type: "url_reached", value: "https://example.com/dashboard", confidence: 0.8, source: "dsl" },
    { type: "state_reached", value: "authenticated", confidence: 0.9, source: "dsl" },
  ];
  const obs = makeObservation({
    visibleText: ["Welcome back"],
    pageUrl: "https://example.com/home",
  });
  const ctx = makeContext();

  const result = refineGoalCriteria(criteria, obs, ctx);

  assert.equal(result.refined, true);
  // text_present should be refined (Dashboard → welcome)
  assert.equal(result.updatedCriteria[0].value, "welcome");
  // url_reached should be refined (same host)
  assert.equal(result.updatedCriteria[1].value, "https://example.com/home");
  // state_reached should be unchanged (no refinement logic for it)
  assert.equal(result.updatedCriteria[2].value, "authenticated");
});
