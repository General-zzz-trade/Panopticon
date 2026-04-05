import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeAnswer,
  parseAgentResponse,
  computeWeightedVote,
  type AgentResponse,
} from "./debate";

test("normalizeAnswer collapses whitespace and lowercases", () => {
  assert.equal(
    normalizeAnswer("  Hello   WORLD\n\tfoo  "),
    "hello world foo"
  );
});

test("normalizeAnswer truncates to first 100 characters", () => {
  const long = "a".repeat(200);
  const normalized = normalizeAnswer(long);
  assert.equal(normalized.length, 100);
  assert.equal(normalized, "a".repeat(100));
});

test("parseAgentResponse extracts fields from strict JSON", () => {
  const raw = '{"answer": "Paris", "reasoning": "Capital of France", "confidence": 0.9}';
  const parsed = parseAgentResponse(raw);
  assert.equal(parsed.answer, "Paris");
  assert.equal(parsed.confidence, 0.9);
  assert.equal(parsed.reasoning, "Capital of France");
});

test("parseAgentResponse extracts JSON embedded in surrounding text", () => {
  const raw = 'Here is my response: {"answer": "42", "confidence": 0.75} done.';
  const parsed = parseAgentResponse(raw);
  assert.equal(parsed.answer, "42");
  assert.equal(parsed.confidence, 0.75);
});

test("parseAgentResponse falls back to whole text for non-JSON input", () => {
  const raw = "The answer is simply yes.";
  const parsed = parseAgentResponse(raw);
  assert.equal(parsed.answer, "The answer is simply yes.");
  assert.equal(parsed.confidence, 0.5);
});

test("parseAgentResponse clamps out-of-range confidence", () => {
  const raw = '{"answer": "x", "confidence": 2.5}';
  const parsed = parseAgentResponse(raw);
  assert.equal(parsed.confidence, 1);

  const raw2 = '{"answer": "x", "confidence": -0.5}';
  const parsed2 = parseAgentResponse(raw2);
  assert.equal(parsed2.confidence, 0);
});

test("parseAgentResponse handles empty input", () => {
  const parsed = parseAgentResponse("");
  assert.equal(parsed.answer, "");
  assert.equal(parsed.confidence, 0.5);
});

test("computeWeightedVote picks the highest-weighted answer", () => {
  const responses: AgentResponse[] = [
    { agentId: "a0", answer: "Paris", confidence: 0.9 },
    { agentId: "a1", answer: "London", confidence: 0.8 },
    { agentId: "a2", answer: "Paris", confidence: 0.7 },
  ];
  const weights = [1, 1, 1];
  const { winner, score } = computeWeightedVote(responses, weights);
  assert.equal(winner, "Paris");
  // 0.9 + 0.7 = 1.6 vs 0.8
  assert.equal(Math.round(score * 100) / 100, 1.6);
});

test("computeWeightedVote respects per-agent weights", () => {
  const responses: AgentResponse[] = [
    { agentId: "a0", answer: "Yes", confidence: 0.5 },
    { agentId: "a1", answer: "No", confidence: 0.5 },
  ];
  const { winner } = computeWeightedVote(responses, [10, 1]);
  assert.equal(winner, "Yes");
});

test("computeWeightedVote groups answers via normalization", () => {
  const responses: AgentResponse[] = [
    { agentId: "a0", answer: "  paris  ", confidence: 0.6 },
    { agentId: "a1", answer: "PARIS", confidence: 0.6 },
    { agentId: "a2", answer: "Berlin", confidence: 0.9 },
  ];
  const { winner } = computeWeightedVote(responses, [1, 1, 1]);
  // grouped paris: 1.2 > berlin: 0.9
  assert.equal(normalizeAnswer(winner), "paris");
});

test("computeWeightedVote handles ties by preferring earliest answer", () => {
  const responses: AgentResponse[] = [
    { agentId: "a0", answer: "Alpha", confidence: 0.5 },
    { agentId: "a1", answer: "Beta", confidence: 0.5 },
  ];
  const { winner, score } = computeWeightedVote(responses, [1, 1]);
  assert.equal(winner, "Alpha");
  assert.equal(score, 0.5);
});

test("computeWeightedVote handles empty responses", () => {
  const { winner, score } = computeWeightedVote([], []);
  assert.equal(winner, "");
  assert.equal(score, 0);
});
