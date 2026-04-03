import test from "node:test";
import assert from "node:assert/strict";
import {
  createUsageLedger,
  finalizeUsageLedger,
  recordLLMPlannerCall,
  recordLLMTokenUsage,
  isTokenBudgetExceeded
} from "./usage-ledger";
import type { RunContext } from "../types";

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-test",
    goal: "test",
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
    ...overrides
  };
}

test("createUsageLedger initializes token counts to zero", () => {
  const ledger = createUsageLedger();
  assert.equal(ledger.totalInputTokens, 0);
  assert.equal(ledger.totalOutputTokens, 0);
});

test("recordLLMTokenUsage accumulates tokens", () => {
  const ctx = makeContext({ usageLedger: createUsageLedger() });
  recordLLMTokenUsage(ctx, 100, 50);
  recordLLMTokenUsage(ctx, 200, 80);
  assert.equal(ctx.usageLedger!.totalInputTokens, 300);
  assert.equal(ctx.usageLedger!.totalOutputTokens, 130);
});

test("finalizeUsageLedger computes totalLLMInteractions", () => {
  const ctx = makeContext({ usageLedger: createUsageLedger() });
  recordLLMPlannerCall(ctx);
  recordLLMPlannerCall(ctx);
  recordLLMTokenUsage(ctx, 500, 200);
  const ledger = finalizeUsageLedger(ctx);
  assert.equal(ledger.totalLLMInteractions, 2);
  assert.equal(ledger.totalInputTokens, 500);
  assert.equal(ledger.totalOutputTokens, 200);
});

test("isTokenBudgetExceeded returns false when under budget", () => {
  const ctx = makeContext({ usageLedger: createUsageLedger() });
  recordLLMTokenUsage(ctx, 100, 50);
  assert.equal(isTokenBudgetExceeded(ctx, 1000), false);
});

test("isTokenBudgetExceeded returns true when over budget", () => {
  const ctx = makeContext({ usageLedger: createUsageLedger() });
  recordLLMTokenUsage(ctx, 800, 300);
  assert.equal(isTokenBudgetExceeded(ctx, 1000), true);
});

test("isTokenBudgetExceeded returns false when no budget set (0)", () => {
  const ctx = makeContext({ usageLedger: createUsageLedger() });
  recordLLMTokenUsage(ctx, 999999, 999999);
  assert.equal(isTokenBudgetExceeded(ctx, 0), false);
});

test("recordLLMTokenUsage creates ledger if missing", () => {
  const ctx = makeContext();
  recordLLMTokenUsage(ctx, 100, 50);
  assert.equal(ctx.usageLedger!.totalInputTokens, 100);
});
