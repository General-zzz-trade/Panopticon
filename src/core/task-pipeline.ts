/**
 * Task Pipeline — single-task execution: observe → execute → verify → decide.
 *
 * Extracted from runtime.ts to isolate per-task logic from the main loop.
 */

import { decideNextStep } from "../cognition/executive-controller";
import { isLLMDecisionConfigured, llmDecideNextStep } from "../cognition/llm-decision";
import { observeEnvironment } from "../cognition/observation-engine";
import { updateWorldState } from "../cognition/state-store";
import type { AgentObservation, CognitiveDecision } from "../cognition/types";
import { executeTask } from "./executor";
import { verifyActionResult } from "../verifier/action-verifier";
import { verifyGoalProgress } from "../verifier/goal-verifier";
import { verifyStateResult } from "../verifier/state-verifier";
import type { AgentTask, RunContext } from "../types";
import type { CausalGraph } from "../world-model/causal-graph";
import type { OnlineAdapterState } from "../learning/online-adapter";
import type { TokenBudget } from "../observability/token-budget";
import {
  appendEpisodeEvent,
  recordVerification,
  recordDecision,
  recordWorldState,
  shouldRunGoalVerification,
  createFailureVerification,
  getErrorMessage
} from "./run-lifecycle";
import {
  runLoopDetection,
  runAnomalyDetection,
  updateCausalGraph,
  runMetaCognition,
  handleHelpRequest,
  runProactiveExploration,
  runAdaptiveLookahead,
  askClarification,
  extractAndRecordPageModel
} from "./cognitive-integrator";
import { analyzeRecoveryOptions, handleReplan, handleTaskFailure } from "./recovery-pipeline";
import {
  stepWorkingMemory,
  updateFocus,
  recordReasoning,
  recordObservationFacts,
  recordFailurePattern,
  switchFocus,
  getFailurePatterns,
  getAllFacts,
  type WorkingMemory
} from "../cognition/working-memory";
import { saveWorkingMemory } from "../cognition/working-memory-persistence";
import {
  recordDecisionTrace,
  buildDecisionContext,
  buildDecisionOptions,
  type ReasoningTrace
} from "../cognition/reasoning-trace";
import type { RunOptions } from "./runtime";

export type TaskOutcome = "continue" | "replan" | "abort";

export interface TaskPipelineResult {
  outcome: TaskOutcome;
  nextIndex: number | null;
}

export interface TaskPipelineContext {
  options: RunOptions;
  summaries: string[];
  causalGraph: CausalGraph;
  onlineAdapter: OnlineAdapterState;
  stateEmbeddingHistory: number[][];
  consecutiveLoopDetections: { value: number };
  tokenBudget: TokenBudget;
  workingMemory: WorkingMemory;
  reasoningTrace: ReasoningTrace;
}

/**
 * Execute a single task through the full pipeline:
 * observe → execute → verify → cognitive integration → decide → (replan)
 */
export async function runTaskPipeline(
  context: RunContext,
  index: number,
  pipeline: TaskPipelineContext
): Promise<TaskPipelineResult> {
  const task = context.tasks[index];
  const beforeObservation = await observeAndRecord(context, task, "Pre-task observation");
  recordWorldState(context, updateWorldState(context.worldState!, {
    observation: beforeObservation
  }), "task_observe", "pre_task_observation");

  try {
    // Execute
    const output = await executeTask(context, task);
    pipeline.summaries.push(output.summary);
    appendEpisodeEvent(context, {
      taskId: task.id,
      kind: "execute",
      summary: output.summary,
      metadata: { attempts: task.attempts, retries: task.retries }
    });
    if (output.artifacts) context.artifacts.push(...output.artifacts);

    // Working memory: record observation facts
    const wm = pipeline.workingMemory;

    // Verify
    const afterObservation = await observeAndRecord(context, task, "Post-task observation");
    const actionVerification = await verifyActionResult(context, task, afterObservation);
    const stateVerification = await verifyStateResult(context, task, afterObservation);
    const goalVerification = shouldRunGoalVerification(task, index, context.tasks.length)
      ? await verifyGoalProgress(context, afterObservation)
      : undefined;

    recordVerification(context, actionVerification);
    recordVerification(context, stateVerification);
    if (goalVerification) recordVerification(context, goalVerification);

    recordWorldState(context, updateWorldState(context.worldState!, {
      observation: afterObservation,
      verification: stateVerification.passed ? stateVerification : actionVerification,
      taskType: task.type,
      stateHints: output.stateHints
    }), "task_observe", "post_task_verification");

    // Cognitive integration: loop detection
    const loopResult = runLoopDetection(
      context, afterObservation,
      pipeline.stateEmbeddingHistory,
      pipeline.consecutiveLoopDetections,
      index
    );
    if (loopResult.isLoop) {
      appendEpisodeEvent(context, {
        taskId: task.id,
        kind: "observe",
        summary: `Confirmed loop (similarity ${loopResult.similarity.toFixed(2)}). Triggering replan.`,
        metadata: { similarity: loopResult.similarity, matchIndex: loopResult.matchIndex }
      });
      const loopRecovery = await analyzeRecoveryOptions(
        context, task,
        `Confirmed loop: agent stuck revisiting state from step ${loopResult.matchIndex}`,
        pipeline.causalGraph, pipeline.tokenBudget
      );
      const handled = await handleReplan(
        context, task, loopRecovery, pipeline.options, pipeline.summaries, index, observeAndRecord
      );
      if (handled.nextIndex !== null) return { outcome: "replan", nextIndex: handled.nextIndex };
    }

    // Working memory: record observation facts + update focus
    recordObservationFacts(wm, afterObservation, task.id);
    updateFocus(wm, task, actionVerification.passed);

    // Page model: extract semantic understanding of current page
    extractAndRecordPageModel(context, afterObservation);

    // Cognitive integration: anomaly detection + causal graph + meta-cognition
    runAnomalyDetection(context, task, beforeObservation, afterObservation);
    updateCausalGraph(context, task, beforeObservation, afterObservation, pipeline.causalGraph);
    const experienceAssessment = runMetaCognition(context, task);

    // Predictive planning: adaptive lookahead
    const lookahead = runAdaptiveLookahead(context, index, pipeline.causalGraph, experienceAssessment);
    if (lookahead.suggestedAction === "replan_now") {
      // Proactive replan before failure occurs
      const handled = await handleReplan(
        context, task,
        lookahead.replanReason ?? "Lookahead predicts low success",
        pipeline.options, pipeline.summaries, index, observeAndRecord
      );
      if (handled.nextIndex !== null) return { outcome: "replan", nextIndex: handled.nextIndex };
    } else if (lookahead.suggestedAction === "ask_user") {
      // Ask user if we should continue
      const answer = await askClarification(
        context, task,
        `I'm ${(lookahead.overallConfidence * 100).toFixed(0)}% confident the next ${lookahead.predictions.length} steps will succeed. ${lookahead.replanReason ?? "Should I continue or try a different approach?"}`,
        ["Continue as planned", "Try a different approach"]
      );
      if (answer === "Try a different approach") {
        const handled = await handleReplan(
          context, task,
          `User requested replan after lookahead uncertainty (${(lookahead.overallConfidence * 100).toFixed(0)}%)`,
          pipeline.options, pipeline.summaries, index, observeAndRecord
        );
        if (handled.nextIndex !== null) return { outcome: "replan", nextIndex: handled.nextIndex };
      }
    }

    // Decide
    const rawDecision = isLLMDecisionConfigured()
      ? await llmDecideNextStep({
          task,
          goal: context.goal,
          actionVerification,
          stateVerification,
          goalVerification,
          replanCount: context.replanCount,
          maxReplans: context.limits.maxReplansPerRun,
          visibleText: afterObservation.visibleText,
          pageUrl: afterObservation.pageUrl,
          completedTasks: context.tasks.filter(t => t.status === "done").map(t => `${t.type}(${t.id})`),
          remainingTasks: context.tasks.filter(t => t.status === "pending").map(t => `${t.type}(${t.id})`),
          failureHistory: context.tasks.filter(t => t.error).map(t => `${t.type}: ${t.error}`)
        })
      : decideNextStep({
          task,
          actionVerification,
          stateVerification,
          goalVerification,
          replanCount: context.replanCount,
          maxReplans: context.limits.maxReplansPerRun
        });

    const cognitiveDecision = {
      ...rawDecision,
      confidence: rawDecision.confidence * experienceAssessment.confidenceMultiplier
    };

    // Help request
    await handleHelpRequest(context, task, experienceAssessment, cognitiveDecision.confidence);
    recordDecision(context, task.id, cognitiveDecision.rationale, cognitiveDecision);

    // Act on decision
    if (cognitiveDecision.nextAction === "abort") {
      throw new Error(cognitiveDecision.rationale);
    }

    if (cognitiveDecision.nextAction === "reobserve") {
      const refreshObservation = await observeAndRecord(context, task, "Refresh observation after goal verification");
      recordWorldState(context, updateWorldState(context.worldState!, {
        observation: refreshObservation,
        taskType: task.type
      }), "task_observe", "goal_reobserve");
    }

    if (cognitiveDecision.nextAction === "replan" || cognitiveDecision.nextAction === "retry_task") {
      const verificationFailed = !actionVerification.passed || !stateVerification.passed;
      const recoveryReason = verificationFailed
        ? await analyzeRecoveryOptions(
            context, task,
            `${task.type} verification requested recovery: ${cognitiveDecision.rationale}`,
            pipeline.causalGraph, pipeline.tokenBudget
          )
        : `${task.type}: ${cognitiveDecision.rationale}`;
      const handled = await handleReplan(
        context, task, recoveryReason, pipeline.options, pipeline.summaries, index, observeAndRecord
      );
      if (handled.nextIndex !== null) return { outcome: "replan", nextIndex: handled.nextIndex };
    }

    // Working memory: record decision and step
    recordReasoning(wm, task.id, cognitiveDecision.nextAction, cognitiveDecision.rationale, cognitiveDecision.confidence);
    stepWorkingMemory(wm);

    // Persist working memory for crash recovery
    saveWorkingMemory(context.runId, wm);

    // Reasoning trace: record full decision context for explainability
    const failurePatterns = getFailurePatterns(wm);
    const traceContext = buildDecisionContext({
      pageUrl: afterObservation.pageUrl,
      appState: afterObservation.appStateGuess,
      visibleText: afterObservation.visibleText,
      elementCount: afterObservation.actionableElements?.length,
      anomalyCount: afterObservation.anomalies.length,
      verifications: [actionVerification, stateVerification, ...(goalVerification ? [goalVerification] : [])],
      hypotheses: context.hypotheses,
      lookahead: lookahead.predictions.length > 0 ? {
        horizon: lookahead.horizon,
        overallConfidence: lookahead.overallConfidence,
        suggestedAction: lookahead.suggestedAction
      } : undefined,
      momentum: wm.focus.momentum,
      failurePatternCount: failurePatterns.length,
      dominantPattern: failurePatterns[0]?.errorPattern,
      factCount: Object.keys(getAllFacts(wm)).length
    });
    const traceOptions = buildDecisionOptions(
      cognitiveDecision,
      actionVerification.passed,
      context.limits.maxReplansPerRun - context.replanCount
    );
    recordDecisionTrace(pipeline.reasoningTrace, {
      taskId: task.id,
      taskType: task.type,
      stepIndex: index,
      context: traceContext,
      options: traceOptions,
      chosen: traceOptions.find(o => o.action === cognitiveDecision.nextAction) ?? { action: cognitiveDecision.nextAction, score: cognitiveDecision.confidence, rationale: cognitiveDecision.rationale },
      confidence: cognitiveDecision.confidence
    });

    // Proactive exploration at checkpoints
    runProactiveExploration(context, task, pipeline.causalGraph, index);

    return { outcome: "continue", nextIndex: index + 1 };
  } catch (error) {
    const message = getErrorMessage(error);

    // Working memory: record failure pattern
    recordFailurePattern(pipeline.workingMemory, task, message);

    // Online learning + adaptation
    handleTaskFailure(context, task, message, pipeline.onlineAdapter, index);

    // Observe failure state
    const failureObservation = await observeAndRecord(context, task, `Failure observation: ${message}`);
    const failureVerification = createFailureVerification(context, task.id, message);
    recordVerification(context, failureVerification);
    recordWorldState(context, updateWorldState(context.worldState!, {
      observation: failureObservation,
      verification: failureVerification,
      taskType: task.type,
      taskError: message
    }), "task_observe", "failure_observation");

    const cognitiveDecision = decideNextStep({
      task,
      stateVerification: failureVerification,
      replanCount: context.replanCount,
      maxReplans: context.limits.maxReplansPerRun
    });
    recordDecision(context, task.id, cognitiveDecision.rationale, cognitiveDecision);

    if (cognitiveDecision.nextAction === "abort") {
      throw error;
    }

    const recoveryReason = await analyzeRecoveryOptions(
      context, task, message, pipeline.causalGraph, pipeline.tokenBudget
    );
    const handled = await handleReplan(
      context, task, recoveryReason, pipeline.options, pipeline.summaries, index, observeAndRecord
    );
    if (handled.nextIndex !== null) return { outcome: "replan", nextIndex: handled.nextIndex };

    throw error;
  }
}

/**
 * Observe environment and record to context.
 */
async function observeAndRecord(
  context: RunContext,
  task: RunContext["tasks"][number],
  summary: string,
  source: "task_observe" | "recovery_followup" = "task_observe"
): Promise<AgentObservation> {
  const observation = await observeEnvironment(context, task);
  observation.source = source;
  context.observations ??= [];
  context.observations.push(observation);
  context.latestObservation = observation;
  appendEpisodeEvent(context, {
    taskId: task.id,
    kind: "observe",
    summary,
    observationId: observation.id,
    metadata: { confidence: observation.confidence, anomalyCount: observation.anomalies.length }
  });
  return observation;
}
