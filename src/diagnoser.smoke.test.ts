import test from "node:test";
import assert from "node:assert/strict";
import { reflectOnRun } from "./reflector";
import { LLMDiagnoser, LLMDiagnoserOutput } from "./llm/diagnoser";
import { RunContext } from "./types";
import { createUsageLedger } from "./usage-ledger";

const MOCK_CONFIG = { provider: "mock", model: "mock", timeoutMs: 1000, maxTokens: 100, temperature: 0 };

function mockDiagnoser(fn: () => Promise<LLMDiagnoserOutput>): LLMDiagnoser {
  return { config: MOCK_CONFIG, diagnose: fn };
}

function runFixture(): RunContext {
  return {
    runId: "diag-smoke",
    goal: "verify dashboard",
    tasks: [],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 0,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    limits: { maxReplansPerRun: 2, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString(),
    usageLedger: createUsageLedger(),
    escalationDecisions: [],
    result: { success: false, message: "failed" },
    terminationReason: "task_failure"
  };
}

test("diagnoser smoke: success", async () => {
  const diagnoser = mockDiagnoser(async () => ({ diagnosis: "all ok: login flow completed successfully", topRisks: ["risk"], suggestedNextImprovements: ["improve"] }));
  const reflection = await reflectOnRun(runFixture(), { diagnoser });
  assert.ok(reflection.diagnosis.includes("all ok"));
});

test("diagnoser smoke: timeout", async () => {
  const diagnoser = mockDiagnoser(async () => { throw new Error("timed out"); });
  const reflection = await reflectOnRun(runFixture(), { diagnoser });
  assert.ok(reflection.diagnosis.length > 0);
});

test("diagnoser smoke: empty response", async () => {
  const diagnoser = mockDiagnoser(async () => ({ diagnosis: "", topRisks: [], suggestedNextImprovements: [] }));
  const reflection = await reflectOnRun(runFixture(), { diagnoser });
  assert.ok(reflection.suggestedNextImprovements && reflection.suggestedNextImprovements.length > 0);
});

test("diagnoser smoke: invalid json", async () => {
  const diagnoser = mockDiagnoser(async () => { throw new Error("invalid json"); });
  const reflection = await reflectOnRun(runFixture(), { diagnoser });
  assert.ok(reflection.topRisks && reflection.topRisks.length > 0);
});

test("diagnoser smoke: low-quality output fallback", async () => {
  const diagnoser = mockDiagnoser(async () => ({ diagnosis: "weak", topRisks: ["only"], suggestedNextImprovements: [] }));
  const reflection = await reflectOnRun(runFixture(), { diagnoser });
  assert.ok(reflection.improvementSuggestions.length > 0);
});
