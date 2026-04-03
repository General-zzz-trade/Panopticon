import test from "node:test";
import assert from "node:assert/strict";
import { runRecoveryExperiments } from "./experiment-runner";
import type { AgentTask, RunContext } from "../types";
import type { FailureHypothesis } from "./types";

function makeContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run-test",
    goal: "test goal",
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

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#btn" },
    ...overrides
  };
}

function makeHypothesis(kind: FailureHypothesis["kind"], overrides: Partial<FailureHypothesis> = {}): FailureHypothesis {
  return {
    id: `hyp-${kind}`,
    kind,
    explanation: `Hypothesis: ${kind}`,
    confidence: 0.6,
    suggestedExperiments: [],
    recoveryHint: "Recover",
    ...overrides
  };
}

test("state_not_ready experiment produces observation patch without browser", async () => {
  const ctx = makeContext({
    worldState: {
      runId: "run-test",
      timestamp: new Date().toISOString(),
      appState: "loading",
      uncertaintyScore: 0.5,
      facts: []
    },
    latestObservation: {
      id: "obs-1",
      runId: "run-test",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      visibleText: ["Please wait", "Loading..."],
      anomalies: [],
      confidence: 0.7
    }
  });
  const results = await runRecoveryExperiments({
    context: ctx,
    task: makeTask(),
    hypotheses: [makeHypothesis("state_not_ready")]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "support");
  assert.ok(results[0].confidenceDelta > 0);
  assert.ok(results[0].observationPatch);
});

test("selector_drift experiment returns inconclusive without browser", async () => {
  const ctx = makeContext();
  const results = await runRecoveryExperiments({
    context: ctx,
    task: makeTask({ payload: { selector: "#missing" } }),
    hypotheses: [makeHypothesis("selector_drift")]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "inconclusive");
  assert.equal(results[0].confidenceDelta, 0);
});

test("assertion_phrase_changed experiment supports when partial overlap exists", async () => {
  const ctx = makeContext({
    latestObservation: {
      id: "obs-1",
      runId: "run-test",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      visibleText: ["Welcome to the application dashboard"],
      anomalies: [],
      confidence: 0.8
    }
  });
  const results = await runRecoveryExperiments({
    context: ctx,
    task: makeTask({ type: "assert_text", payload: { text: "Welcome dashboard" } }),
    hypotheses: [makeHypothesis("assertion_phrase_changed")]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "support");
  assert.ok(results[0].confidenceDelta > 0);
});

test("session_not_established supports when login text visible and no session", async () => {
  const ctx = makeContext({
    latestObservation: {
      id: "obs-1",
      runId: "run-test",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      visibleText: ["Please sign in to continue"],
      anomalies: [],
      confidence: 0.8
    },
    worldState: {
      runId: "run-test",
      timestamp: new Date().toISOString(),
      appState: "ready",
      uncertaintyScore: 0.3,
      facts: []
    }
  });
  const results = await runRecoveryExperiments({
    context: ctx,
    task: makeTask(),
    hypotheses: [makeHypothesis("session_not_established")]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "support");
  assert.ok(results[0].observationPatch);
});

test("missing_page_context supports when no browser but worldState has URL", async () => {
  const ctx = makeContext({
    worldState: {
      runId: "run-test",
      timestamp: new Date().toISOString(),
      appState: "ready",
      uncertaintyScore: 0.3,
      facts: [],
      pageUrl: "http://localhost:3000"
    }
  });
  const results = await runRecoveryExperiments({
    context: ctx,
    task: makeTask(),
    hypotheses: [makeHypothesis("missing_page_context")]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "support");
  assert.ok(results[0].confidenceDelta > 0);
});

test("unknown hypothesis returns inconclusive with zero delta", async () => {
  const ctx = makeContext();
  const results = await runRecoveryExperiments({
    context: ctx,
    task: makeTask(),
    hypotheses: [makeHypothesis("unknown")]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "inconclusive");
  assert.equal(results[0].confidenceDelta, 0);
});

test("multiple hypotheses produce one result each", async () => {
  const ctx = makeContext({
    worldState: {
      runId: "run-test",
      timestamp: new Date().toISOString(),
      appState: "loading",
      uncertaintyScore: 0.5,
      facts: [],
      pageUrl: "http://localhost:3000"
    },
    latestObservation: {
      id: "obs-1",
      runId: "run-test",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      visibleText: ["Loading..."],
      anomalies: [],
      confidence: 0.7
    }
  });
  const results = await runRecoveryExperiments({
    context: ctx,
    task: makeTask({ payload: { selector: "#btn" } }),
    hypotheses: [
      makeHypothesis("state_not_ready"),
      makeHypothesis("selector_drift"),
      makeHypothesis("missing_page_context")
    ]
  });
  assert.equal(results.length, 3);
});
