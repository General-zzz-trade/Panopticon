import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPageType,
  findForms,
  findNavigation,
  extractPageModel,
} from "./page-model";
import type { AgentObservation, ActionableElementObservation } from "../cognition/types";

function makeObservation(
  overrides: Partial<AgentObservation> = {}
): AgentObservation {
  return {
    id: "obs-1",
    runId: "run-1",
    timestamp: new Date().toISOString(),
    source: "task_observe",
    anomalies: [],
    confidence: 0.9,
    ...overrides,
  };
}

// ── classifyPageType ────────────────────────────────────────────────────────

test("classifyPageType recognizes login page from text", () => {
  const obs = makeObservation({
    visibleText: ["Welcome back", "Sign in to your account", "Password"],
    pageUrl: "https://example.com/login",
  });
  assert.equal(classifyPageType(obs), "login");
});

test("classifyPageType recognizes login page from URL alone", () => {
  const obs = makeObservation({
    visibleText: ["Welcome"],
    pageUrl: "https://example.com/auth/signin",
  });
  assert.equal(classifyPageType(obs), "login");
});

test("classifyPageType recognizes error page", () => {
  const obs = makeObservation({
    visibleText: ["404 Not Found", "The page you requested could not be found."],
    pageUrl: "https://example.com/missing-page",
  });
  assert.equal(classifyPageType(obs), "error");
});

test("classifyPageType recognizes error page with 500", () => {
  const obs = makeObservation({
    visibleText: ["500 Internal Server Error", "Something went wrong"],
  });
  assert.equal(classifyPageType(obs), "error");
});

test("classifyPageType recognizes dashboard", () => {
  const obs = makeObservation({
    visibleText: ["Dashboard", "Total users: 1500", "Revenue overview"],
    pageUrl: "https://app.example.com/dashboard",
  });
  assert.equal(classifyPageType(obs), "dashboard");
});

test("classifyPageType recognizes loading state", () => {
  const obs = makeObservation({
    visibleText: ["Loading... Please wait"],
  });
  assert.equal(classifyPageType(obs), "loading");
});

test("classifyPageType recognizes search results", () => {
  const obs = makeObservation({
    visibleText: ["Search results for 'typescript'", "Showing 42 results"],
  });
  assert.equal(classifyPageType(obs), "search");
});

test("classifyPageType returns unknown for ambiguous pages", () => {
  const obs = makeObservation({
    visibleText: ["Hello world"],
    actionableElements: [],
  });
  assert.equal(classifyPageType(obs), "unknown");
});

// ── findForms ───────────────────────────────────────────────────────────────

test("findForms extracts form structure from elements", () => {
  const elements: ActionableElementObservation[] = [
    { role: "textbox", text: "Email", selector: "#email", confidence: 0.9 },
    { role: "textbox", text: "Password", selector: "#password", confidence: 0.9 },
    { role: "button", text: "Submit", selector: "#submit-btn", confidence: 0.9 },
    { role: "link", text: "Forgot password?", confidence: 0.8 },
  ];

  const forms = findForms(elements);
  assert.equal(forms.length, 1);
  assert.equal(forms[0].fields.length, 2);
  assert.equal(forms[0].fields[0].name, "Email");
  assert.equal(forms[0].fields[0].type, "email");
  assert.equal(forms[0].fields[1].type, "password");
  assert.ok(forms[0].submitButton);
  assert.equal(forms[0].submitButton!.text, "Submit");
});

test("findForms returns empty array when no inputs", () => {
  const elements: ActionableElementObservation[] = [
    { role: "button", text: "Click me", confidence: 0.9 },
    { role: "link", text: "Home", confidence: 0.8 },
  ];

  const forms = findForms(elements);
  assert.equal(forms.length, 0);
});

test("findForms handles form without submit button", () => {
  const elements: ActionableElementObservation[] = [
    { role: "textbox", text: "Search", selector: "#search", confidence: 0.9 },
  ];

  const forms = findForms(elements);
  assert.equal(forms.length, 1);
  assert.equal(forms[0].submitButton, undefined);
});

// ── findNavigation ──────────────────────────────────────────────────────────

test("findNavigation extracts links", () => {
  const elements: ActionableElementObservation[] = [
    { role: "link", text: "Home", selector: "a.home", confidence: 0.9 },
    { role: "link", text: "About", selector: "a.about", confidence: 0.9 },
    { role: "menuitem", text: "Settings", confidence: 0.8 },
  ];

  const nav = findNavigation(elements);
  assert.equal(nav.links.length, 3);
  assert.equal(nav.links[0].text, "Home");
  assert.equal(nav.links[2].text, "Settings");
});

test("findNavigation detects breadcrumbs", () => {
  const elements: ActionableElementObservation[] = [
    { role: "navigation", text: "Home > Products > Widget", confidence: 0.9 },
  ];

  const nav = findNavigation(elements);
  assert.deepEqual(nav.breadcrumbs, ["Home", "Products", "Widget"]);
});

// ── extractPageModel ────────────────────────────────────────────────────────

test("extractPageModel builds complete model", () => {
  const obs = makeObservation({
    pageUrl: "https://example.com/login",
    title: "Login Page",
    visibleText: [
      "Sign in to your account",
      "Enter your credentials below to continue",
    ],
    actionableElements: [
      { role: "textbox", text: "Email", selector: "#email", confidence: 0.9 },
      { role: "textbox", text: "Password", selector: "#pass", confidence: 0.9 },
      { role: "button", text: "Sign In", selector: "#login-btn", confidence: 0.9 },
      { role: "link", text: "Forgot password?", selector: "a.forgot", confidence: 0.8 },
    ],
  });

  const model = extractPageModel(obs);

  assert.equal(model.pageType, "login");
  assert.equal(model.title, "Login Page");
  assert.equal(model.url, "https://example.com/login");
  assert.equal(model.elements.length, 4);
  assert.equal(model.forms.length, 1);
  assert.equal(model.forms[0].fields.length, 2);
  assert.ok(model.navigation);
  assert.equal(model.navigation.links.length, 1); // only the link element
  // Content areas: lines > 20 chars
  assert.ok(model.contentAreas.length > 0);
});

test("extractPageModel uses worldState for fallbacks", () => {
  const obs = makeObservation({
    visibleText: ["Some content on the page that is long enough to be detected"],
    actionableElements: [],
  });

  const worldState = {
    runId: "run-1",
    timestamp: new Date().toISOString(),
    appState: "ready" as const,
    pageUrl: "https://example.com/page",
    uncertaintyScore: 0.1,
    facts: ["title:My Page Title"],
  };

  const model = extractPageModel(obs, worldState);

  assert.equal(model.url, "https://example.com/page");
  assert.equal(model.title, "My Page Title");
});
