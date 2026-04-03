import test from "node:test";
import assert from "node:assert/strict";
import {
  createConversation,
  recordTurn,
  buildContinuationContext,
  isConversationActive,
  getConversationSummary,
  endConversation
} from "./conversation";
import type { RunContext } from "../types";

function makeRunContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-1", goal: "test goal", tasks: [
      { id: "t1", type: "open_page", status: "done", retries: 0, attempts: 1, replanDepth: 0, payload: { url: "http://localhost" } }
    ],
    artifacts: [], replanCount: 0, nextTaskSequence: 1, insertedTaskCount: 0,
    llmReplannerInvocations: 0, llmReplannerTimeoutCount: 0, llmReplannerFallbackCount: 0,
    escalationDecisions: [], limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    result: { success: true, message: "Goal completed" },
    worldState: {
      runId: "run-1", timestamp: new Date().toISOString(), appState: "ready",
      uncertaintyScore: 0.3, facts: [], pageUrl: "http://localhost"
    },
    ...overrides
  };
}

test("createConversation initializes with empty state", () => {
  const conv = createConversation("test-conv");
  assert.equal(conv.id, "test-conv");
  assert.equal(conv.turns.length, 0);
  assert.equal(conv.browserSession, undefined);
  assert.ok(conv.causalGraph);
});

test("createConversation generates ID when not provided", () => {
  const conv = createConversation();
  assert.ok(conv.id.startsWith("conv-"));
});

test("recordTurn adds turn and carries forward state", () => {
  const conv = createConversation();
  const ctx = makeRunContext({ goal: "open dashboard" });

  const turn = recordTurn(conv, ctx);
  assert.equal(turn.index, 0);
  assert.equal(turn.goal, "open dashboard");
  assert.equal(turn.success, true);
  assert.equal(conv.turns.length, 1);
  assert.ok(conv.worldState);
});

test("recordTurn accumulates multiple turns", () => {
  const conv = createConversation();
  recordTurn(conv, makeRunContext({ runId: "r1", goal: "step 1" }));
  recordTurn(conv, makeRunContext({ runId: "r2", goal: "step 2" }));
  recordTurn(conv, makeRunContext({ runId: "r3", goal: "step 3", result: { success: false, message: "failed" } }));

  assert.equal(conv.turns.length, 3);
  assert.equal(conv.turns[2].success, false);
});

test("buildContinuationContext includes previous turns", () => {
  const conv = createConversation();
  recordTurn(conv, makeRunContext({ goal: "open page" }));
  recordTurn(conv, makeRunContext({ goal: "click login" }));

  const ctx = buildContinuationContext(conv);
  assert.ok(ctx.previousTurns.includes("open page"));
  assert.ok(ctx.previousTurns.includes("click login"));
  assert.ok(ctx.worldState);
});

test("buildContinuationContext limits to last 5 turns", () => {
  const conv = createConversation();
  for (let i = 0; i < 8; i++) {
    recordTurn(conv, makeRunContext({ runId: `r${i}`, goal: `step ${i}` }));
  }

  const ctx = buildContinuationContext(conv);
  assert.ok(!ctx.previousTurns.includes("step 0"));  // oldest should be trimmed
  assert.ok(ctx.previousTurns.includes("step 7"));   // newest should be present
});

test("isConversationActive returns false without browser", () => {
  const conv = createConversation();
  assert.equal(isConversationActive(conv), false);
});

test("getConversationSummary formats correctly", () => {
  const conv = createConversation("test-summary");
  recordTurn(conv, makeRunContext({ goal: "open page" }));
  recordTurn(conv, makeRunContext({ goal: "click btn", result: { success: false, message: "failed" } }));

  const summary = getConversationSummary(conv);
  assert.ok(summary.includes("test-summary"));
  assert.ok(summary.includes("2 turns"));
  assert.ok(summary.includes("1 success"));
});

test("endConversation clears state", async () => {
  const conv = createConversation();
  recordTurn(conv, makeRunContext());
  assert.ok(conv.worldState);

  await endConversation(conv);
  assert.equal(conv.browserSession, undefined);
  assert.equal(conv.worldState, undefined);
});
