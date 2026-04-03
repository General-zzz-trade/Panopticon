import test from "node:test";
import assert from "node:assert/strict";
import { generateGoalSuggestions, getKnowledgeSummary } from "./curiosity";

test("generateGoalSuggestions returns array", () => {
  const suggestions = generateGoalSuggestions();
  assert.ok(Array.isArray(suggestions));
  for (const s of suggestions) {
    assert.ok(typeof s.goal === "string");
    assert.ok(typeof s.reason === "string");
    assert.ok(typeof s.priority === "number");
    assert.ok(s.priority >= 0 && s.priority <= 1);
    assert.ok(["unexplored", "low_confidence", "retry_failure", "llm_generated", "coverage_gap"].includes(s.source));
  }
});

test("getKnowledgeSummary returns valid structure", () => {
  const summary = getKnowledgeSummary();
  assert.ok(typeof summary.totalEpisodes === "number");
  assert.ok(typeof summary.successRate === "number");
  assert.ok(Array.isArray(summary.knownDomains));
  assert.ok(typeof summary.totalKnowledge === "number");
  assert.ok(Array.isArray(summary.suggestions));
});

test("generateGoalSuggestions respects maxSuggestions", () => {
  const suggestions = generateGoalSuggestions(2);
  assert.ok(suggestions.length <= 2);
});

test("suggestions are sorted by priority descending", () => {
  const suggestions = generateGoalSuggestions(10);
  for (let i = 1; i < suggestions.length; i++) {
    assert.ok(suggestions[i].priority <= suggestions[i - 1].priority,
      `Suggestion ${i} priority ${suggestions[i].priority} should be <= ${suggestions[i-1].priority}`);
  }
});
