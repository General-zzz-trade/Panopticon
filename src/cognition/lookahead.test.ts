import test from "node:test";
import assert from "node:assert/strict";
import { computeHorizon, runLookahead } from "./lookahead";
import { createCausalGraph, addStateNode, addCausalEdge } from "../world-model/causal-graph";
import type { MetaCognitionAssessment } from "./meta-cognition";
import type { RunContext } from "../types";

function makeAssessment(familiarity: number): MetaCognitionAssessment {
  return {
    domainFamiliarity: familiarity,
    selectorRiskLevel: 0,
    stuckLevel: 0,
    confidenceMultiplier: 1,
    rationale: "test"
  };
}

test("computeHorizon returns 1 for familiar domains", () => {
  assert.equal(computeHorizon(makeAssessment(0.8), 10), 1);
});

test("computeHorizon returns 3 for moderate familiarity", () => {
  assert.equal(computeHorizon(makeAssessment(0.5), 10), 3);
});

test("computeHorizon returns 5 for unfamiliar domains", () => {
  assert.equal(computeHorizon(makeAssessment(0.1), 10), 5);
});

test("computeHorizon returns 1 when graph too small", () => {
  assert.equal(computeHorizon(makeAssessment(0.1), 2), 1);
});

test("runLookahead returns continue when no upcoming tasks", () => {
  const graph = createCausalGraph();
  const context = {
    tasks: [{ id: "t1", type: "click", status: "done", retries: 0, attempts: 1, replanDepth: 0, payload: {} }],
    worldState: { pageUrl: "http://test.com", appState: "ready" },
  } as unknown as RunContext;

  const result = runLookahead(context, 0, graph, makeAssessment(0.5));
  assert.equal(result.suggestedAction, "continue");
  assert.equal(result.predictions.length, 0);
  assert.equal(result.overallConfidence, 1.0);
});

test("runLookahead predicts with causal graph data", () => {
  const graph = createCausalGraph();
  addStateNode(graph, "page:home", "test.com");
  addStateNode(graph, "page:login", "test.com");
  addCausalEdge(graph, "page:home", "page:login", "click", "#login-button", "test.com", true);
  addCausalEdge(graph, "page:home", "page:login", "click", "#login-button", "test.com", true);

  const context = {
    tasks: [
      { id: "t1", type: "open_page", status: "done", retries: 0, attempts: 1, replanDepth: 0, payload: {} },
      { id: "t2", type: "click", status: "pending", retries: 0, attempts: 0, replanDepth: 0, payload: { selector: "#login-button" } },
    ],
    worldState: { pageUrl: "http://test.com", appState: "ready" },
    latestObservation: { pageUrl: "http://test.com" },
  } as unknown as RunContext;

  const result = runLookahead(context, 0, graph, makeAssessment(0.1));
  assert.ok(result.predictions.length > 0);
  assert.equal(result.predictions[0].taskType, "click");
});

test("runLookahead suggests replan when confidence very low", () => {
  const graph = createCausalGraph();
  addStateNode(graph, "unknown|unknown", "test.com");
  addStateNode(graph, "page:error", "test.com");
  addCausalEdge(graph, "unknown|unknown", "page:error", "click", "#broken", "test.com", false);
  addCausalEdge(graph, "unknown|unknown", "page:error", "click", "#broken", "test.com", false);
  addCausalEdge(graph, "unknown|unknown", "page:error", "click", "#broken", "test.com", true);

  const context = {
    tasks: [
      { id: "t1", type: "open_page", status: "done", retries: 0, attempts: 1, replanDepth: 0, payload: {} },
      { id: "t2", type: "click", status: "pending", retries: 2, attempts: 2, replanDepth: 1, payload: { selector: "#broken" } },
    ],
    worldState: { appState: "unknown" },
    latestObservation: {},
  } as unknown as RunContext;

  const result = runLookahead(context, 0, graph, makeAssessment(0.1));
  // With retries and replanDepth, confidence should be discounted
  assert.ok(result.predictions.length > 0);
  assert.ok(result.predictions[0].predictedSuccess < 0.5);
});
