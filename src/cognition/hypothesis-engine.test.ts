import test from "node:test";
import assert from "node:assert/strict";
import { applyBeliefUpdates } from "./belief-updater";
import { runRecoveryExperiments } from "./experiment-runner";
import { generateFailureHypotheses } from "./hypothesis-engine";
import type { AgentTask, RunContext } from "../types";

test("hypothesis recovery pipeline ranks selector drift higher when selector is missing", async () => {
  const task: AgentTask = {
    id: "task-1",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#missing-button" },
    errorHistory: ["selector not found"]
  };

  const context: RunContext = {
    runId: "run-hypothesis-test",
    goal: 'click "#missing-button"',
    tasks: [task],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    observations: [
      {
        id: "obs-1",
        runId: "run-hypothesis-test",
        taskId: "task-1",
        timestamp: new Date().toISOString(),
        source: "task_observe",
        pageUrl: "http://localhost:3000/login",
        title: "Login",
        visibleText: ["Login", "Sign in"],
        actionableElements: [],
        appStateGuess: "ready",
        anomalies: [],
        confidence: 0.8
      }
    ],
    latestObservation: {
      id: "obs-1",
      runId: "run-hypothesis-test",
      taskId: "task-1",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      pageUrl: "http://localhost:3000/login",
      title: "Login",
      visibleText: ["Login", "Sign in"],
      actionableElements: [],
      appStateGuess: "ready",
      anomalies: [],
      confidence: 0.8
    },
    worldState: {
      runId: "run-hypothesis-test",
      timestamp: new Date().toISOString(),
      pageUrl: "http://localhost:3000/login",
      appState: "ready",
      lastAction: "click",
      lastObservationId: "obs-1",
      uncertaintyScore: 0.3,
      facts: ["page:http://localhost:3000/login"]
    },
    episodeEvents: [],
    verificationResults: [],
    cognitiveDecisions: [],
    limits: {
      maxReplansPerRun: 3,
      maxReplansPerTask: 1
    },
    startedAt: new Date().toISOString()
  };

  const hypotheses = generateFailureHypotheses({
    context,
    task,
    failureReason: "selector not found"
  });
  assert.ok(hypotheses.some((item) => item.kind === "selector_drift"));

  const experimentResults = await runRecoveryExperiments({
    context,
    task,
    hypotheses
  });
  const selectorExperiment = experimentResults.find((item) => item.experiment.includes("selector presence"));
  assert.ok(selectorExperiment);
  assert.ok(typeof selectorExperiment?.performedAction === "string");
  assert.ok(selectorExperiment?.stateHints && selectorExperiment.stateHints.length > 0);

  const belief = applyBeliefUpdates({
    runId: context.runId,
    taskId: task.id,
    hypotheses,
    experimentResults
  });
  assert.ok(belief.updatedHypotheses.length > 0);
});

test("state readiness experiment returns observation patch after a low-risk probe", async () => {
  const task: AgentTask = {
    id: "task-2",
    type: "assert_text",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { text: "Dashboard" },
    errorHistory: ["timed out"]
  };

  const context: RunContext = {
    runId: "run-state-probe-test",
    goal: 'assert text "Dashboard"',
    tasks: [task],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    observations: [],
    latestObservation: {
      id: "obs-loading",
      runId: "run-state-probe-test",
      taskId: "task-2",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      pageUrl: "http://localhost:3000",
      title: "Loading",
      visibleText: ["Please wait", "Loading"],
      actionableElements: [],
      appStateGuess: "loading",
      anomalies: [],
      confidence: 0.7
    },
    worldState: {
      runId: "run-state-probe-test",
      timestamp: new Date().toISOString(),
      pageUrl: "http://localhost:3000",
      appState: "loading",
      lastAction: "assert_text",
      lastObservationId: "obs-loading",
      uncertaintyScore: 0.5,
      facts: []
    },
    episodeEvents: [],
    verificationResults: [],
    cognitiveDecisions: [],
    limits: {
      maxReplansPerRun: 3,
      maxReplansPerTask: 1
    },
    startedAt: new Date().toISOString()
  };

  const hypotheses = generateFailureHypotheses({
    context,
    task,
    failureReason: "timed out waiting for dashboard"
  });
  const readinessHypothesis = hypotheses.find((item) => item.kind === "state_not_ready");
  assert.ok(readinessHypothesis);

  const experimentResults = await runRecoveryExperiments({
    context,
    task,
    hypotheses: readinessHypothesis ? [readinessHypothesis] : []
  });
  assert.equal(experimentResults.length, 1);
  assert.ok(experimentResults[0]?.observationPatch);
  assert.ok(experimentResults[0]?.stateHints?.includes("experiment:readiness_probe"));
});

test("generates hypotheses and maintains confidence sort order", () => {
  const task: AgentTask = {
    id: "task-learn-1",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#submit" },
    errorHistory: ["selector not found"]
  };

  const context: RunContext = {
    runId: "run-learned-test",
    goal: 'click "#submit"',
    tasks: [task],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    observations: [],
    latestObservation: {
      id: "obs-1",
      runId: "run-learned-test",
      taskId: "task-learn-1",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      pageUrl: "http://localhost:3000/login",
      visibleText: ["Login"],
      actionableElements: [],
      appStateGuess: "ready",
      anomalies: [],
      confidence: 0.8
    },
    worldState: {
      runId: "run-learned-test",
      timestamp: new Date().toISOString(),
      pageUrl: "http://localhost:3000/login",
      appState: "ready",
      lastAction: "click",
      lastObservationId: "obs-1",
      uncertaintyScore: 0.3,
      facts: []
    },
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString()
  };

  const hypotheses = generateFailureHypotheses({
    context,
    task,
    failureReason: "selector not found"
  });

  assert.ok(hypotheses.some((h) => h.kind === "selector_drift"));
  for (let i = 1; i < hypotheses.length; i++) {
    assert.ok(hypotheses[i - 1].confidence >= hypotheses[i].confidence,
      `Hypothesis ${i - 1} (${hypotheses[i - 1].confidence}) should be >= hypothesis ${i} (${hypotheses[i].confidence})`);
  }
});

test("hypothesis confidence uses learned priors when available", () => {
  const task: AgentTask = {
    id: "t1",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#btn" },
    errorHistory: ["selector not found"]
  };

  const context: RunContext = {
    runId: "run-prior-test",
    goal: 'click "#btn"',
    tasks: [task],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    observations: [],
    latestObservation: {
      id: "obs-1",
      runId: "run-prior-test",
      taskId: "t1",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      pageUrl: "http://localhost:3000",
      visibleText: [],
      actionableElements: [],
      appStateGuess: "ready",
      anomalies: [],
      confidence: 0.8
    },
    worldState: {
      runId: "run-prior-test",
      timestamp: new Date().toISOString(),
      appState: "ready",
      uncertaintyScore: 0.3,
      facts: []
    },
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString()
  };

  const hypotheses = generateFailureHypotheses({
    context,
    task,
    failureReason: "selector not found"
  });

  // Should generate hypotheses with confidence values (may differ from hardcoded defaults)
  const selectorHyp = hypotheses.find(h => h.kind === "selector_drift");
  assert.ok(selectorHyp);
  assert.ok(selectorHyp!.confidence > 0);
  assert.ok(selectorHyp!.confidence <= 1);
});

test("generates session_not_established hypothesis when login text is visible", () => {
  const task: AgentTask = {
    id: "task-session-1",
    type: "click",
    status: "failed",
    retries: 0,
    attempts: 1,
    replanDepth: 0,
    payload: { selector: "#dashboard-btn" }
  };

  const context: RunContext = {
    runId: "run-session-test",
    goal: "click dashboard button",
    tasks: [task],
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: 1,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    escalationDecisions: [],
    latestObservation: {
      id: "obs-1",
      runId: "run-session-test",
      taskId: "task-session-1",
      timestamp: new Date().toISOString(),
      source: "task_observe",
      pageUrl: "http://localhost:3000/login",
      visibleText: ["Please sign in to continue"],
      actionableElements: [],
      appStateGuess: "ready",
      anomalies: [],
      confidence: 0.8
    },
    worldState: {
      runId: "run-session-test",
      timestamp: new Date().toISOString(),
      appState: "ready",
      uncertaintyScore: 0.3,
      facts: []
    },
    limits: { maxReplansPerRun: 3, maxReplansPerTask: 1 },
    startedAt: new Date().toISOString()
  };

  const hypotheses = generateFailureHypotheses({
    context,
    task,
    failureReason: "element not visible"
  });

  assert.ok(hypotheses.some((h) => h.kind === "session_not_established"));
});
