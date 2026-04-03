import test from "node:test";
import assert from "node:assert/strict";
import { createConversation, recordTurn, buildContinuationContext, endConversation, getConversationSummary } from "./conversation";
import type { RunContext } from "../types";

function mockRunContext(goal: string, success: boolean): RunContext {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    goal,
    tasks: [],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 0,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    result: { success, message: success ? "done" : "failed" }
  } as unknown as RunContext;
}

test("conversation lifecycle: create, record turns, end", async () => {
  const conv = createConversation();
  assert.ok(conv.id.startsWith("conv-"));
  assert.equal(conv.turns.length, 0);

  recordTurn(conv, mockRunContext("open dashboard", true));
  assert.equal(conv.turns.length, 1);
  assert.equal(conv.turns[0].success, true);

  recordTurn(conv, mockRunContext("click settings", false));
  assert.equal(conv.turns.length, 2);

  await endConversation(conv);
  assert.equal(conv.browserSession, undefined);
});

test("buildContinuationContext returns previous turns", () => {
  const conv = createConversation();
  recordTurn(conv, mockRunContext("step 1", true));
  recordTurn(conv, mockRunContext("step 2", true));

  const ctx = buildContinuationContext(conv);
  assert.ok(ctx.previousTurns.includes("step 1"));
  assert.ok(ctx.previousTurns.includes("step 2"));
});

test("getConversationSummary includes turn count", () => {
  const conv = createConversation();
  recordTurn(conv, mockRunContext("test", true));
  const summary = getConversationSummary(conv);
  assert.ok(summary.includes("1 turns"));
  assert.ok(summary.includes("1 success"));
});

test("buildContinuationContext carries forward worldState", () => {
  const conv = createConversation();
  const ctx = mockRunContext("open page", true);
  ctx.worldState = {
    runId: ctx.runId,
    goal: ctx.goal,
    pageUrl: "http://localhost:3000/dashboard",
    appState: "authenticated"
  } as any;
  recordTurn(conv, ctx);

  const continuation = buildContinuationContext(conv);
  assert.ok(continuation.worldState);
  assert.equal(continuation.worldState!.pageUrl, "http://localhost:3000/dashboard");
});

test("RunOptions accepts browserSession and keepBrowserAlive", () => {
  // Verify the new RunOptions fields exist by constructing one
  const options: import("../core/runtime").RunOptions = {
    browserSession: undefined,
    worldState: undefined,
    keepBrowserAlive: true
  };
  assert.ok(typeof options.keepBrowserAlive === "boolean");
  assert.equal(options.browserSession, undefined);
  assert.equal(options.worldState, undefined);
});
