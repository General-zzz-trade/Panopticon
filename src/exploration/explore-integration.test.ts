import test from "node:test";
import assert from "node:assert/strict";
import { planExploration, createExplorationReport, DEFAULT_EXPLORATION_CONFIG } from "./explorer";
import { createCausalGraph, addStateNode, addCausalEdge } from "../world-model/causal-graph";

test("planExploration creates ordered action list from elements", () => {
  const elements = [
    { selector: "a.nav", text: "Home", role: "link", confidence: 0.9 },
    { selector: "button.action", text: "Submit", role: "button", confidence: 0.7 },
    { selector: "a.danger", text: "Logout", role: "link", confidence: 0.8 }
  ];

  const plan = planExploration("http://example.com", elements, new Set(), DEFAULT_EXPLORATION_CONFIG);

  // Logout should be filtered out
  assert.ok(plan.actions.length >= 1);
  assert.ok(!plan.actions.some(a => a.description.toLowerCase().includes("logout")));
});

test("planExploration respects maxSteps limit", () => {
  const elements = Array.from({ length: 50 }, (_, i) => ({
    selector: `a.link-${i}`,
    text: `Link ${i}`,
    role: "link",
    confidence: 0.8
  }));

  const config = { ...DEFAULT_EXPLORATION_CONFIG, maxSteps: 5 };
  const plan = planExploration("http://example.com", elements, new Set(), config);
  assert.ok(plan.actions.length <= 5);
});

test("createExplorationReport generates valid summary", () => {
  const graph = createCausalGraph();
  addStateNode(graph, "page:/", "example.com");
  addStateNode(graph, "page:/about", "example.com");
  addCausalEdge(graph, "page:/", "page:/about", "click", "a[href='/about']", "example.com", true);

  const pages = [
    { url: "http://example.com", title: "Home", pageType: "landing", elements: [], visitCount: 1, discoveredAt: 0 },
    { url: "http://example.com/about", title: "About", pageType: "content", elements: [], visitCount: 1, discoveredAt: 1 }
  ];

  const actions = [{
    step: 0,
    action: "click",
    target: "a[href='/about']",
    fromUrl: "http://example.com",
    toUrl: "http://example.com/about",
    fromState: "page:/",
    toState: "page:/about",
    success: true,
    description: 'click "About"'
  }];

  const report = createExplorationReport("http://example.com", pages, actions, graph);
  assert.ok(report.summary.includes("2 page(s)"));
  assert.ok(report.summary.includes("1 action(s)"));
  assert.equal(report.totalSteps, 1);
  assert.equal(report.pagesDiscovered.length, 2);
});

test("exploration avoids dangerous elements", () => {
  const elements = [
    { selector: "a.safe", text: "Settings", role: "link", confidence: 0.9 },
    { selector: "a.danger", text: "Delete Account", role: "link", confidence: 0.95 },
    { selector: "a.danger2", text: "Unsubscribe", role: "link", confidence: 0.85 }
  ];

  const plan = planExploration("http://example.com", elements, new Set(), DEFAULT_EXPLORATION_CONFIG);
  const descriptions = plan.actions.map(a => a.description.toLowerCase());
  assert.ok(!descriptions.some(d => d.includes("delete")));
  assert.ok(!descriptions.some(d => d.includes("unsubscribe")));
});
