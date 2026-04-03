import test from "node:test";
import assert from "node:assert/strict";
import {
  planExploration,
  createExplorationReport,
  DEFAULT_EXPLORATION_CONFIG,
  type ExploredPage,
  type ExplorationAction
} from "./explorer";
import { createCausalGraph, addCausalEdge } from "../world-model/causal-graph";
import type { ActionableElementObservation } from "../cognition/types";

test("planExploration: prioritizes navigation elements", () => {
  const elements: ActionableElementObservation[] = [
    { role: "button", text: "Submit", confidence: 0.8 },
    { role: "link", text: "Dashboard", selector: "#nav-dashboard", confidence: 0.7 },
    { role: "input", text: "Search", confidence: 0.9 },
    { role: "link", text: "Settings", selector: "#nav-settings", confidence: 0.6 }
  ];

  const plan = planExploration("http://localhost", elements, new Set());
  // Links should come first due to navigation priority bonus
  assert.ok(plan.actions.length >= 2);
  assert.equal(plan.actions[0].type, "navigate");
});

test("planExploration: skips dangerous elements", () => {
  const elements: ActionableElementObservation[] = [
    { role: "button", text: "Logout", confidence: 0.9 },
    { role: "button", text: "Delete Account", confidence: 0.8 },
    { role: "link", text: "Home", selector: "#home", confidence: 0.7 }
  ];

  const plan = planExploration("http://localhost", elements, new Set());
  const targets = plan.actions.map(a => a.description);
  assert.ok(!targets.includes("Logout"));
  assert.ok(!targets.includes("Delete Account"));
});

test("planExploration: respects maxSteps", () => {
  const elements: ActionableElementObservation[] = Array.from({ length: 50 }, (_, i) => ({
    role: "link", text: `Link ${i}`, selector: `#link-${i}`, confidence: 0.7
  }));

  const config = { ...DEFAULT_EXPLORATION_CONFIG, maxSteps: 5 };
  const plan = planExploration("http://localhost", elements, new Set(), config);
  assert.ok(plan.actions.length <= 5);
});

test("planExploration: inputs get lower priority", () => {
  const elements: ActionableElementObservation[] = [
    { role: "input", text: "Username", confidence: 0.95 },
    { role: "link", text: "About", selector: "#about", confidence: 0.5 }
  ];

  const plan = planExploration("http://localhost", elements, new Set());
  // Link should come first despite lower raw confidence
  if (plan.actions.length >= 2) {
    assert.equal(plan.actions[0].description, "About");
  }
});

test("createExplorationReport: builds navigation map", () => {
  const pages: ExploredPage[] = [
    { url: "http://localhost/", title: "Home", pageType: "dashboard", elements: [], visitCount: 1, discoveredAt: 0 },
    { url: "http://localhost/about", title: "About", pageType: "unknown", elements: [], visitCount: 1, discoveredAt: 1 }
  ];

  const actions: ExplorationAction[] = [
    { step: 0, action: "click", target: "#about", fromUrl: "http://localhost/", toUrl: "http://localhost/about", fromState: "home", toState: "about", success: true, description: "Clicked About link" }
  ];

  const report = createExplorationReport("http://localhost/", pages, actions, createCausalGraph());
  assert.equal(report.pagesDiscovered.length, 2);
  assert.ok(report.navigationMap.get("http://localhost/")?.includes("http://localhost/about"));
  assert.ok(report.summary.includes("2 page(s)"));
});

test("createExplorationReport: detects error pages", () => {
  const pages: ExploredPage[] = [
    { url: "http://localhost/", title: "Home", pageType: "dashboard", elements: [], visitCount: 1, discoveredAt: 0 },
    { url: "http://localhost/broken", title: "Error", pageType: "error", elements: [], visitCount: 1, discoveredAt: 1 }
  ];

  const report = createExplorationReport("http://localhost/", pages, [], createCausalGraph());
  assert.ok(report.anomalies.some(a => a.includes("error page")));
});

test("createExplorationReport: detects dead ends", () => {
  const pages: ExploredPage[] = [
    { url: "http://localhost/a", title: "A", pageType: "unknown", elements: [], visitCount: 1, discoveredAt: 0 },
    { url: "http://localhost/b", title: "B", pageType: "unknown", elements: [], visitCount: 1, discoveredAt: 1 },
    { url: "http://localhost/c", title: "C", pageType: "unknown", elements: [], visitCount: 1, discoveredAt: 2 }
  ];

  // No actions = no navigation map = all pages are dead ends
  const report = createExplorationReport("http://localhost/a", pages, [], createCausalGraph());
  assert.ok(report.anomalies.some(a => a.includes("dead-end")));
});

test("createExplorationReport: computes success rate", () => {
  const actions: ExplorationAction[] = [
    { step: 0, action: "click", target: "#a", fromUrl: "/", toUrl: "/a", fromState: "s1", toState: "s2", success: true, description: "" },
    { step: 1, action: "click", target: "#b", fromUrl: "/a", toUrl: "/a", fromState: "s2", toState: "s2", success: false, description: "" }
  ];

  const report = createExplorationReport("/", [], actions, createCausalGraph());
  assert.ok(report.summary.includes("50%"));
});

test("createExplorationReport: empty exploration", () => {
  const report = createExplorationReport("http://localhost", [], [], createCausalGraph());
  assert.equal(report.totalSteps, 0);
  assert.equal(report.pagesDiscovered.length, 0);
  assert.ok(report.summary.includes("0 page(s)"));
});
