import test from "node:test";
import assert from "node:assert/strict";
import { causalDecompose, inferGoalState, inferCurrentState } from "./causal-decomposer";
import { createCausalGraph, addCausalEdge } from "../world-model/causal-graph";

test("causalDecompose returns plan from known graph path", () => {
  const graph = createCausalGraph();
  addCausalEdge(graph, "content:login", "content:dashboard", "click", "#login-btn", "example.com", true);

  const result = causalDecompose(
    "go to dashboard",
    "content:login",
    "content:dashboard",
    graph
  );

  assert.equal(result.decomposed, true);
  assert.equal(result.strategy, "causal");
  assert.ok(result.causalPath!.length > 0);
  assert.equal(result.subGoals.length, 1);
});

test("causalDecompose returns single goal when no path", () => {
  const graph = createCausalGraph();

  const result = causalDecompose(
    "do something unknown",
    "state:unknown",
    "goal:unknown",
    graph
  );

  assert.equal(result.decomposed, false);
  assert.equal(result.strategy, "single");
});

test("inferGoalState maps common patterns", () => {
  assert.equal(inferGoalState("navigate to dashboard"), "content:dashboard");
  assert.equal(inferGoalState("login to the site"), "content:login");
  assert.equal(inferGoalState("verify authenticated"), "app:authenticated");
});

test("inferCurrentState from observation data", () => {
  const state = inferCurrentState({
    pageUrl: "http://example.com/login",
    appState: "ready",
    visibleText: ["Login", "Sign in"]
  });

  assert.ok(state.includes("page:/login"));
  assert.ok(state.includes("app:ready"));
});

test("causalDecompose multi-step path", () => {
  const graph = createCausalGraph();
  addCausalEdge(graph, "state:unknown", "content:login", "open_page", "/login", "d", true);
  addCausalEdge(graph, "content:login", "content:dashboard", "click", "#submit", "d", true);

  const result = causalDecompose(
    "go to dashboard",
    "state:unknown",
    "content:dashboard",
    graph
  );

  assert.equal(result.decomposed, true);
  assert.equal(result.subGoals.length, 2);
  assert.deepEqual(result.subGoals[0].dependsOn, []);
  assert.deepEqual(result.subGoals[1].dependsOn, [0]);
});
