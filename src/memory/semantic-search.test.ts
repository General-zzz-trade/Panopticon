import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity } from "./semantic-search";
import { localEmbedding } from "./embedding";
import { generateEpisodeSummary, extractDomainFromRun } from "./episode-generator";
import type { RunContext } from "../types";

test("cosineSimilarity: identical vectors return 1", () => {
  const v = [1, 0, 0, 1];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1.0) < 0.001);
});

test("cosineSimilarity: orthogonal vectors return 0", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 0.001);
});

test("cosineSimilarity: opposite vectors return -1", () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) - (-1)) < 0.001);
});

test("cosineSimilarity: empty vectors return 0", () => {
  assert.equal(cosineSimilarity([], []), 0);
});

test("localEmbedding: similar texts produce similar embeddings", () => {
  const e1 = localEmbedding("click login button and enter password");
  const e2 = localEmbedding("click the login button then type password");
  const e3 = localEmbedding("download file from server via http");

  const sim12 = cosineSimilarity(e1, e2);
  const sim13 = cosineSimilarity(e1, e3);

  assert.ok(sim12 > sim13, `Similar texts should have higher similarity: ${sim12} vs ${sim13}`);
});

test("localEmbedding: returns normalized vector", () => {
  const e = localEmbedding("test embedding normalization");
  const norm = Math.sqrt(e.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1.0) < 0.01, `Norm should be ~1.0, got ${norm}`);
});

test("generateEpisodeSummary: includes goal and outcome", () => {
  const ctx: RunContext = {
    runId: "run-1", goal: "open dashboard", tasks: [
      { id: "t1", type: "open_page", status: "done", retries: 0, attempts: 1, replanDepth: 0, payload: { url: "http://localhost" } }
    ],
    artifacts: [], replanCount: 0, nextTaskSequence: 1, insertedTaskCount: 0,
    llmReplannerInvocations: 0, llmReplannerTimeoutCount: 0, llmReplannerFallbackCount: 0,
    escalationDecisions: [], limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    result: { success: true, message: "ok" }
  };
  const summary = generateEpisodeSummary(ctx);
  assert.ok(summary.includes("open dashboard"));
  assert.ok(summary.includes("SUCCESS"));
});

test("generateEpisodeSummary: includes failure info", () => {
  const ctx: RunContext = {
    runId: "run-2", goal: "click missing button", tasks: [
      { id: "t1", type: "click", status: "failed", retries: 1, attempts: 2, replanDepth: 0, payload: {}, error: "selector not found" }
    ],
    artifacts: [], replanCount: 1, nextTaskSequence: 1, insertedTaskCount: 0,
    llmReplannerInvocations: 0, llmReplannerTimeoutCount: 0, llmReplannerFallbackCount: 0,
    escalationDecisions: [], limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    result: { success: false, message: "failed" }
  };
  const summary = generateEpisodeSummary(ctx);
  assert.ok(summary.includes("FAILURE"));
  assert.ok(summary.includes("selector not found"));
  assert.ok(summary.includes("Replans: 1"));
});

test("extractDomainFromRun: extracts from open_page task", () => {
  const ctx = { tasks: [{ type: "open_page", payload: { url: "https://www.github.com/login" } }] } as any;
  assert.equal(extractDomainFromRun(ctx), "github.com");
});

test("extractDomainFromRun: returns empty for no open_page", () => {
  const ctx = { tasks: [{ type: "click", payload: {} }] } as any;
  assert.equal(extractDomainFromRun(ctx), "");
});
