/**
 * Recovery Pipeline — hypothesis generation, experiment execution,
 * belief updates, counterfactual reasoning, and program synthesis.
 *
 * Extracted from runtime.ts to isolate recovery logic from the core loop.
 */

import { applyBeliefUpdates } from "../cognition/belief-updater";
import { runRecoveryExperiments } from "../cognition/experiment-runner";
import { generateFailureHypotheses } from "../cognition/hypothesis-engine";
import { materializeObservation, observeEnvironment } from "../cognition/observation-engine";
import { updateWorldState } from "../cognition/state-store";
import type { RecoveryProgram } from "../cognition/types";
import { synthesizeRecovery, recordRecoveryOutcome, programToTasks } from "../cognition/recovery-synthesizer";
import { inferCurrentState, inferGoalState } from "../decomposer/causal-decomposer";
import { recordInRunFailure, suggestAdaptation, type OnlineAdapterState } from "../learning/online-adapter";
import { findFailurePatterns, loadRecentRuns } from "../memory";
import { canSpendTokens, recordTokenSpend, type TokenBudget } from "../observability/token-budget";
import { replanTasks } from "../planner/replanner";
import { publishEvent } from "../streaming/event-bus";
import type { AgentTask, RunContext } from "../types";
import { findPath, type CausalGraph } from "../world-model/causal-graph";
import { suggestAlternativeActions } from "../world-model/counterfactual";
import { appendEpisodeEvent, recordWorldState } from "./run-lifecycle";
import { logModuleError } from "./module-logger";
import type { RunOptions } from "./runtime";

/**
 * Analyze recovery options: generate hypotheses, run experiments,
 * update beliefs, check counterfactuals, and optionally synthesize programs.
 */
export async function analyzeRecoveryOptions(
  context: RunContext,
  task: RunContext["tasks"][number],
  failureReason: string,
  causalGraph?: CausalGraph,
  tokenBudget?: TokenBudget
): Promise<string> {
  // Causal graph: check if there's a known alternative path to the goal
  if (causalGraph && causalGraph.edges.size > 0) {
    const currentState = inferCurrentState({
      pageUrl: context.worldState?.pageUrl,
      appState: context.worldState?.appState,
      visibleText: context.latestObservation?.visibleText
    });
    const goalState = inferGoalState(context.goal);
    const altPath = findPath(causalGraph, currentState, goalState);
    if (altPath.length > 0) {
      const pathHint = altPath.map(e => `${e.action}("${e.actionDetail}")`).join(" → ");
      failureReason = `${failureReason} [Causal graph suggests alternative path: ${pathHint}]`;
    }
  }

  // Token budget gate: skip LLM hypothesis generation if budget exhausted
  if (tokenBudget && !canSpendTokens(tokenBudget, "hypothesis", 500)) {
    return `${failureReason} [Token budget exhausted for hypothesis generation]`;
  }

  const hypotheses = await generateFailureHypotheses({ context, task, failureReason });
  if (tokenBudget) recordTokenSpend(tokenBudget, "hypothesis", 500);

  appendEpisodeEvent(context, {
    taskId: task.id,
    kind: "hypothesize",
    summary: `Generated ${hypotheses.length} recovery hypothesis(es). Top=${hypotheses[0]?.kind ?? "none"}`,
    metadata: {
      topHypothesis: hypotheses[0]?.kind ?? "none",
      topConfidence: hypotheses[0]?.confidence ?? 0
    }
  });

  const experimentResults = await runRecoveryExperiments({ context, task, hypotheses });
  context.experimentResults ??= [];
  context.experimentResults.push(...experimentResults);
  applyExperimentOutcomes(context, task, experimentResults);

  for (const result of experimentResults) {
    appendEpisodeEvent(context, {
      taskId: task.id,
      kind: "experiment",
      summary: `${result.outcome.toUpperCase()} ${result.experiment}`,
      metadata: {
        hypothesisId: result.hypothesisId,
        confidenceDelta: result.confidenceDelta,
        action: result.performedAction ?? "none"
      }
    });
  }

  const belief = applyBeliefUpdates({
    runId: context.runId,
    taskId: task.id,
    hypotheses,
    experimentResults
  });
  context.beliefUpdates ??= [];
  context.beliefUpdates.push(...belief.beliefUpdates);
  context.hypotheses ??= [];
  context.hypotheses.push(...belief.updatedHypotheses);

  const topHypothesis = belief.updatedHypotheses[0] ?? hypotheses[0];
  if (!topHypothesis) return failureReason;

  appendEpisodeEvent(context, {
    taskId: task.id,
    kind: "recover",
    summary: `Top recovery hypothesis is ${topHypothesis.kind} (${topHypothesis.confidence.toFixed(2)}).`,
    metadata: { topHypothesis: topHypothesis.kind, topConfidence: topHypothesis.confidence }
  });

  // Counterfactual reasoning — suggest alternative actions
  if (causalGraph && causalGraph.edges.size > 0 && !process.env.DISABLE_COUNTERFACTUAL) {
    try {
      const currentState = inferCurrentState({
        pageUrl: context.worldState?.pageUrl,
        appState: context.worldState?.appState,
        visibleText: context.latestObservation?.visibleText
      });
      const alternatives = suggestAlternativeActions(causalGraph, currentState, task.type);
      if (alternatives.length > 0) {
        const topAlt = alternatives[0];
        const altHint = alternatives.slice(0, 3).map(a =>
          `${a.action}("${a.detail}") ${(a.successProbability * 100).toFixed(0)}%`
        ).join(", ");
        failureReason = `${failureReason} [Counterfactual alternatives: ${altHint}]`;
        appendEpisodeEvent(context, {
          taskId: task.id,
          kind: "recover",
          summary: `Counterfactual: ${alternatives.length} alternative(s). Top: ${topAlt.action}("${topAlt.detail}") p=${topAlt.successProbability.toFixed(2)}`,
          metadata: { topAlternative: topAlt.action, probability: topAlt.successProbability }
        });
        if (topAlt.successProbability >= 0.6 && topAlt.detail) {
          topHypothesis.recoveryHint =
            `Counterfactual-driven: use ${topAlt.action}("${topAlt.detail}") instead (causal p=${topAlt.successProbability.toFixed(2)})`;
        }
      }
    } catch (error) {
      logModuleError("counterfactual", "optional", error, "suggesting alternatives");
    }
  }

  // Program synthesis recovery — try LLM-synthesized recovery
  if (process.env.DISABLE_RECOVERY_SYNTHESIS) {
    return `${failureReason} Top hypothesis=${topHypothesis.kind} confidence=${topHypothesis.confidence.toFixed(2)}. ${topHypothesis.recoveryHint}`;
  }
  if (tokenBudget && !canSpendTokens(tokenBudget, "recovery", 1000)) {
    return `${failureReason} Top hypothesis=${topHypothesis.kind} confidence=${topHypothesis.confidence.toFixed(2)}. ${topHypothesis.recoveryHint} [Recovery token budget exhausted]`;
  }

  try {
    const previousAttempts = context.hypotheses
      ?.filter(h => h.taskId === task.id)
      .map(h => h.recoveryHint) ?? [];
    const recoveryProgram = await synthesizeRecovery({ context, task, error: failureReason, previousAttempts });
    if (recoveryProgram) {
      const recoveryTasks = programToTasks(recoveryProgram, task.id);
      if (recoveryTasks.length > 0) {
        appendEpisodeEvent(context, {
          taskId: task.id,
          kind: "recover",
          summary: `Synthesized recovery program: ${recoveryTasks.length} step(s)`,
          metadata: { programId: recoveryProgram.id, steps: recoveryTasks.length }
        });
        (context as unknown as Record<string, unknown>).__pendingRecoveryProgram = recoveryProgram;
      }
    }
  } catch (error) {
    logModuleError("recovery-synthesis", "optional", error, "synthesizing recovery program");
  }

  return `${failureReason} Top hypothesis=${topHypothesis.kind} confidence=${topHypothesis.confidence.toFixed(2)}. ${topHypothesis.recoveryHint}`;
}

/**
 * Handle replanning: invoke replanner, manage task list mutations.
 */
export async function handleReplan(
  context: RunContext,
  task: RunContext["tasks"][number],
  errorMessage: string,
  options: RunOptions,
  summaries: string[],
  index: number,
  observeAndRecordFn: (ctx: RunContext, t: AgentTask, summary: string, source?: "task_observe" | "recovery_followup") => Promise<any>
): Promise<{ nextIndex: number | null }> {
  const recentRuns = await loadRecentRuns(5);
  const failurePatterns = await findFailurePatterns();
  const decision = await replanTasks({
    context,
    task,
    error: errorMessage,
    recentRuns,
    failurePatterns,
    maxLLMReplannerCalls: options.maxLLMReplannerCalls ?? 1,
    maxLLMReplannerTimeouts: options.maxLLMReplannerTimeouts ?? 1
  });

  summaries.push(`Observed failure in ${task.id}: ${errorMessage}`);
  summaries.push(`Replan decision: ${decision.reason}`);
  appendEpisodeEvent(context, {
    taskId: task.id,
    kind: decision.abort ? "abort" : "recover",
    summary: decision.reason,
    metadata: {
      insertTasks: decision.insertTasks.length,
      replaceTasks: decision.replaceWith.length,
      abort: decision.abort
    }
  });

  publishEvent({
    type: "replan",
    runId: context.runId,
    taskId: task.id,
    timestamp: new Date().toISOString(),
    message: decision.reason
  });

  if (decision.abort && decision.reason.includes("budget exceeded")) {
    throw new Error(decision.reason);
  }

  if (decision.replaceWith.length > 0) {
    context.replanCount += 1;
    context.tasks.splice(index, 1, ...decision.replaceWith);
    await observeAndRecordFn(context, task, "Recovery follow-up observation", "recovery_followup");
    return { nextIndex: index };
  }

  if (decision.insertTasks.length > 0) {
    context.replanCount += 1;
    context.insertedTaskCount += decision.insertTasks.length;
    context.tasks.splice(index + 1, 0, ...decision.insertTasks);
    await observeAndRecordFn(context, task, "Recovery follow-up observation", "recovery_followup");
  }

  // Execute synthesized recovery program if replanner produced nothing
  if (decision.insertTasks.length === 0 && decision.replaceWith.length === 0 && !decision.abort) {
    const pendingProgram = (context as unknown as Record<string, unknown>).__pendingRecoveryProgram as
      RecoveryProgram | undefined;
    if (pendingProgram && pendingProgram.steps.length > 0) {
      const recoveryTasks = programToTasks(pendingProgram, task.id);
      context.insertedTaskCount += recoveryTasks.length;
      context.tasks.splice(index + 1, 0, ...recoveryTasks);
      appendEpisodeEvent(context, {
        taskId: task.id,
        kind: "recover",
        summary: `Executing synthesized recovery program (${recoveryTasks.length} steps)`,
        metadata: { programId: pendingProgram.id, steps: recoveryTasks.length }
      });
      (context as unknown as Record<string, unknown>).__pendingRecoveryProgram = undefined;
      await observeAndRecordFn(context, task, "Recovery program follow-up observation", "recovery_followup");
      return { nextIndex: index + 1 };
    }
  }

  if (decision.abort) return { nextIndex: null };
  return { nextIndex: index + 1 };
}

/**
 * Apply experiment outcomes: merge observation patches and state hints.
 */
function applyExperimentOutcomes(
  context: RunContext,
  task: RunContext["tasks"][number],
  experimentResults: NonNullable<RunContext["experimentResults"]>
): void {
  for (const result of experimentResults) {
    if (result.observationPatch) {
      const mergedObservation = materializeObservation({
        runId: context.runId,
        taskId: task.id,
        source: "experiment_refresh",
        pageUrl: result.observationPatch.pageUrl ?? context.latestObservation?.pageUrl ?? context.worldState?.pageUrl,
        title: result.observationPatch.title ?? context.latestObservation?.title,
        visibleText: result.observationPatch.visibleText ?? context.latestObservation?.visibleText,
        actionableElements: context.latestObservation?.actionableElements,
        appStateGuess: result.observationPatch.appStateGuess ?? context.latestObservation?.appStateGuess,
        anomalies: result.observationPatch.anomalies ?? context.latestObservation?.anomalies ?? [],
        confidence: result.observationPatch.confidence ?? context.latestObservation?.confidence ?? 0.55
      });
      context.latestObservation = mergedObservation;
      context.observations ??= [];
      context.observations.push(mergedObservation);
      recordWorldState(context, updateWorldState(context.worldState!, {
        observation: mergedObservation,
        taskType: task.type,
        stateHints: result.stateHints
      }), "experiment_refresh", result.experiment);
    } else if (result.stateHints && result.stateHints.length > 0) {
      recordWorldState(context, updateWorldState(context.worldState!, {
        taskType: task.type,
        stateHints: result.stateHints
      }), "state_update", result.experiment);
    }
  }
}

/**
 * Handle task failure: record in-run learning, suggest adaptation, apply it.
 */
export function handleTaskFailure(
  context: RunContext,
  task: AgentTask,
  message: string,
  onlineAdapter: OnlineAdapterState,
  index: number
): void {
  const inRunLesson = recordInRunFailure(onlineAdapter, task, message, index);
  appendEpisodeEvent(context, {
    taskId: task.id,
    kind: "observe",
    summary: `In-run learning: ${inRunLesson.suggestedStrategy}`,
    metadata: { adapter: "online", selector: inRunLesson.selector || "none" }
  });

  const adaptation = suggestAdaptation(onlineAdapter, task);
  if (adaptation) {
    appendEpisodeEvent(context, {
      taskId: task.id,
      kind: "recover",
      summary: `Online adaptation suggested: ${adaptation.strategy} — ${adaptation.reason}`,
      metadata: { strategy: adaptation.strategy }
    });
    applyOnlineAdaptation(context, task, adaptation, index);
  }
}

/**
 * Apply online adaptation to upcoming tasks.
 */
function applyOnlineAdaptation(
  context: RunContext,
  failedTask: RunContext["tasks"][number],
  adaptation: { strategy: string; reason: string },
  currentIndex: number
): void {
  const strategy = adaptation.strategy;

  if (strategy.startsWith("visual_")) {
    const visualType = strategy as AgentTask["type"];
    for (let i = currentIndex + 1; i < context.tasks.length; i++) {
      const upcoming = context.tasks[i];
      if (
        upcoming.status === "pending" &&
        upcoming.payload.selector === failedTask.payload.selector &&
        (upcoming.type === "click" || upcoming.type === "type" || upcoming.type === "select")
      ) {
        const originalType = upcoming.type;
        upcoming.type = visualType;
        upcoming.payload.description = upcoming.payload.description ?? upcoming.payload.selector;
        appendEpisodeEvent(context, {
          taskId: upcoming.id,
          kind: "recover",
          summary: `Adapted task from ${originalType} to ${visualType}: ${adaptation.reason}`,
          metadata: { originalType, newType: visualType }
        });
        break;
      }
    }
    return;
  }

  if (strategy === "add_wait") {
    const waitTask: AgentTask = {
      id: `${context.runId}-${context.nextTaskSequence}-adaptive_wait`,
      type: "wait",
      status: "pending",
      retries: 0,
      attempts: 0,
      replanDepth: 0,
      payload: { ms: 1000 }
    };
    context.nextTaskSequence += 1;
    context.tasks.splice(currentIndex + 1, 0, waitTask);
    context.insertedTaskCount += 1;
    appendEpisodeEvent(context, {
      taskId: waitTask.id,
      kind: "recover",
      summary: `Inserted adaptive wait: ${adaptation.reason}`,
      metadata: { strategy: "add_wait", waitMs: 1000 }
    });
  }
}
