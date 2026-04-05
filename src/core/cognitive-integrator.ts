/**
 * Cognitive Integrator — loop detection, anomaly detection, meta-cognition,
 * causal graph updates, and proactive exploration.
 *
 * Extracted from runtime.ts to isolate cognitive module integration from
 * the core execution loop.
 */

import { detectAnomalies } from "../cognition/anomaly-detector";
import { assessExperience, shouldRequestHelp, type MetaCognitionAssessment } from "../cognition/meta-cognition";
import { unifiedAssessment, shouldRequestHelpUnified, type UnifiedAssessment } from "../cognition/unified-assessment";
import type { AgentObservation, CognitiveDecision } from "../cognition/types";
import { inferCurrentState } from "../decomposer/causal-decomposer";
import { computeAdaptiveMultiplier } from "../learning/weight-optimizer";
import { publishEvent } from "../streaming/event-bus";
import type { AgentTask, RunContext } from "../types";
import { extractCausalTransitions } from "../world-model/extractor";
import { encodeObservation, detectLoop, assignCluster } from "../world-model/state-encoder";
import type { CausalGraph } from "../world-model/causal-graph";
import { appendEpisodeEvent } from "./run-lifecycle";
import { logModuleError } from "./module-logger";
import { requestDialogue, getDialogueAnswer, type DialogueType } from "../approval/gate";
import { runLookahead, type LookaheadResult } from "../cognition/lookahead";
import { extractPageModel, type PageModel } from "../world-model/page-model";

export interface CognitiveIntegrationResult {
  /** Whether a loop was detected that requires replan */
  loopDetected: boolean;
  loopRecoveryReason?: string;
  /** Experience assessment from meta-cognition */
  experienceAssessment: MetaCognitionAssessment;
  /** Whether the agent should request help */
  helpRequested: boolean;
}

/**
 * Run state embedding + loop detection after a task completes.
 * Returns true if a confirmed loop was detected.
 */
export function runLoopDetection(
  context: RunContext,
  afterObservation: AgentObservation,
  stateEmbeddingHistory: number[][],
  consecutiveLoopDetections: { value: number },
  index: number
): { isLoop: boolean; similarity: number; matchIndex: number } {
  if (process.env.DISABLE_LOOP_DETECTION) {
    return { isLoop: false, similarity: 0, matchIndex: -1 };
  }

  try {
    const stateEmb = encodeObservation(afterObservation);
    const loopCheck = detectLoop(stateEmb, stateEmbeddingHistory);
    stateEmbeddingHistory.push(stateEmb);
    if (stateEmbeddingHistory.length > 50) stateEmbeddingHistory.shift();

    const label = afterObservation.pageUrl ?? "unknown";
    const domain = inferCurrentState({ pageUrl: afterObservation.pageUrl }).split("|")[0] ?? "";
    assignCluster(stateEmb, label, domain);

    if (loopCheck.isLoop && loopCheck.similarity >= 0.99) {
      consecutiveLoopDetections.value++;
    } else {
      consecutiveLoopDetections.value = 0;
    }

    // Only trigger escape after 2 consecutive high-confidence loop detections
    // AND at least 3 tasks have been executed (avoid false positives on startup)
    if (consecutiveLoopDetections.value >= 2 && index >= 3) {
      const detections = consecutiveLoopDetections.value;
      consecutiveLoopDetections.value = 0;
      return { isLoop: true, similarity: loopCheck.similarity, matchIndex: loopCheck.matchIndex };
    }

    return { isLoop: false, similarity: loopCheck.similarity, matchIndex: loopCheck.matchIndex };
  } catch (error) {
    logModuleError("loop-detection", "optional", error, "state encoding failed");
    return { isLoop: false, similarity: 0, matchIndex: -1 };
  }
}

/**
 * Run anomaly detection between pre-task and post-task observations.
 */
export function runAnomalyDetection(
  context: RunContext,
  task: AgentTask,
  beforeObservation: AgentObservation,
  afterObservation: AgentObservation
): void {
  const anomalyReport = detectAnomalies(task, beforeObservation, afterObservation, context);
  if (anomalyReport.anomalies.length > 0) {
    appendEpisodeEvent(context, {
      taskId: task.id,
      kind: "observe",
      summary: `Anomaly detected: ${anomalyReport.summary}`,
      metadata: { anomalyCount: anomalyReport.anomalies.length, risk: anomalyReport.overallRisk }
    });
  }
}

/**
 * Record a successful state transition in the causal graph.
 */
export function updateCausalGraph(
  context: RunContext,
  task: AgentTask,
  beforeObservation: AgentObservation,
  afterObservation: AgentObservation,
  causalGraph: CausalGraph
): void {
  try {
    extractCausalTransitions(
      { ...context, tasks: [task], observations: [beforeObservation, afterObservation] } as RunContext,
      causalGraph
    );
  } catch (error) {
    logModuleError("causal-graph", "optional", error, "recording state transition");
  }
}

/**
 * Run meta-cognition: assess experience and compute adaptive confidence.
 * Uses unified assessment to blend real-time signals with historical self-model.
 */
export function runMetaCognition(
  context: RunContext,
  task: AgentTask
): MetaCognitionAssessment {
  // Try unified assessment (blends meta-cognition + self-model)
  const domain = context.goal.match(/https?:\/\/([^\/\s"]+)/)?.[1]?.replace(/^www\./, "");
  let assessment: MetaCognitionAssessment;

  try {
    assessment = unifiedAssessment(context, task, domain);
  } catch {
    // Fallback to basic meta-cognition
    assessment = assessExperience(context, task);
  }

  if (!process.env.DISABLE_ADAPTIVE_WEIGHTS) {
    try {
      assessment.confidenceMultiplier = computeAdaptiveMultiplier(
        assessment.domainFamiliarity,
        assessment.selectorRiskLevel,
        assessment.stuckLevel
      );
    } catch (error) {
      logModuleError("adaptive-weights", "optional", error, "computing adaptive multiplier");
    }
  }

  return assessment;
}

/**
 * Check if the agent should request help and handle approval flow.
 */
export async function handleHelpRequest(
  context: RunContext,
  task: AgentTask,
  assessment: MetaCognitionAssessment,
  confidence: number
): Promise<boolean> {
  if (!shouldRequestHelp(assessment)) return false;

  appendEpisodeEvent(context, {
    taskId: task.id,
    kind: "observe",
    summary: `Meta-cognition: requesting help — ${assessment.rationale} (confidence: ${confidence.toFixed(2)})`,
    metadata: {
      stuckLevel: assessment.stuckLevel,
      confidenceMultiplier: assessment.confidenceMultiplier
    }
  });

  publishEvent({
    type: "help_requested",
    runId: context.runId,
    taskId: task.id,
    timestamp: new Date().toISOString(),
    message: `Agent is stuck: ${assessment.rationale}. Confidence: ${confidence.toFixed(2)}`
  });

  if (context.policy?.approval?.enabled) {
    const { requestApproval } = await import("../approval/gate");
    const helpResponse = await requestApproval({
      runId: context.runId,
      taskId: task.id,
      taskType: task.type,
      taskPayload: task.payload as Record<string, unknown>,
      reason: `Agent is stuck (${assessment.rationale}). Should it continue with task "${task.type}"?`
    });
    if (helpResponse.status === "rejected") {
      throw new Error(`Human rejected continuation: agent was stuck (${assessment.rationale})`);
    }
  }

  return true;
}

/**
 * Extract semantic page model from observation.
 * Attaches the model to the world state for use by planner and verifier.
 */
export function extractAndRecordPageModel(
  context: RunContext,
  afterObservation: AgentObservation
): PageModel | undefined {
  try {
    const model = extractPageModel(afterObservation, context.worldState ?? undefined);
    // Attach to context for downstream use
    (context as RunContext & { pageModel?: PageModel }).pageModel = model;

    if (model.pageType !== "unknown") {
      appendEpisodeEvent(context, {
        kind: "observe",
        summary: `Page model: ${model.pageType} — ${model.forms.length} form(s), ${model.navigation.links.length} nav link(s)`,
        metadata: { pageType: model.pageType, formCount: model.forms.length, linkCount: model.navigation.links.length }
      });
    }
    return model;
  } catch (error) {
    logModuleError("page-model", "optional", error, "extracting page model");
    return undefined;
  }
}

/**
 * Run adaptive lookahead: predict upcoming task success probabilities.
 * Returns the result and optionally triggers dialogue if confidence is moderate.
 */
export function runAdaptiveLookahead(
  context: RunContext,
  currentIndex: number,
  causalGraph: CausalGraph,
  assessment: MetaCognitionAssessment
): LookaheadResult {
  try {
    const result = runLookahead(context, currentIndex, causalGraph, assessment);

    if (result.predictions.length > 0 && result.suggestedAction !== "continue") {
      appendEpisodeEvent(context, {
        taskId: context.tasks[currentIndex]?.id,
        kind: "observe",
        summary: `Lookahead (${result.horizon} steps): ${(result.overallConfidence * 100).toFixed(0)}% confidence. Action: ${result.suggestedAction}${result.replanReason ? ` — ${result.replanReason}` : ""}`,
        metadata: {
          horizon: result.horizon,
          overallConfidence: result.overallConfidence,
          suggestedAction: result.suggestedAction,
          predictionCount: result.predictions.length
        }
      });
    }

    return result;
  } catch (error) {
    logModuleError("lookahead", "optional", error, "adaptive lookahead prediction");
    return {
      horizon: 0,
      predictions: [],
      overallConfidence: 1.0,
      suggestedAction: "continue"
    };
  }
}

/**
 * Ask a targeted clarification question mid-run.
 * Only triggers if the approval system is enabled.
 * Returns the user's answer, or undefined if dialogue was skipped/rejected.
 */
export async function askClarification(
  context: RunContext,
  task: AgentTask,
  question: string,
  options?: string[]
): Promise<string | undefined> {
  if (!context.policy?.approval?.enabled) return undefined;

  const dialogueType: DialogueType = options ? "choice" : "clarification";

  appendEpisodeEvent(context, {
    taskId: task.id,
    kind: "observe",
    summary: `Mid-run dialogue: ${question}`,
    metadata: { dialogueType, optionCount: options?.length ?? 0 }
  });

  publishEvent({
    type: "dialogue_requested",
    runId: context.runId,
    taskId: task.id,
    timestamp: new Date().toISOString(),
    message: question
  });

  try {
    const response = await requestDialogue({
      runId: context.runId,
      taskId: task.id,
      taskType: task.type,
      dialogueType,
      question,
      options,
      reason: question
    });

    const answer = getDialogueAnswer(response);
    if (answer) {
      appendEpisodeEvent(context, {
        taskId: task.id,
        kind: "observe",
        summary: `User answered: ${answer}`,
        metadata: { dialogueType, answer }
      });
    }
    return answer;
  } catch (error) {
    logModuleError("dialogue", "optional", error, "mid-run clarification");
    return undefined;
  }
}

/**
 * Run proactive exploration at checkpoint intervals.
 */
export function runProactiveExploration(
  context: RunContext,
  task: AgentTask,
  causalGraph: CausalGraph,
  index: number
): void {
  if (index <= 0 || index % 5 !== 0) return;

  try {
    const { saveCheckpoint } = require("./checkpoint");
    saveCheckpoint(context, index - 1, []);
  } catch (error) {
    logModuleError("checkpoint", "optional", error, "saving checkpoint");
  }

  try {
    const { selectNextExplorationAction } = require("../exploration/proactive-explorer");
    const currentState = inferCurrentState({
      pageUrl: context.worldState?.pageUrl,
      appState: context.worldState?.appState,
      visibleText: context.latestObservation?.visibleText
    });
    const elements = (context.latestObservation?.actionableElements ?? []).map((el: { selector?: string; text?: string; role?: string }) => ({
      selector: el.selector ?? "",
      text: el.text ?? "",
      type: el.role ?? "button"
    }));
    const explorationHint = selectNextExplorationAction(currentState, causalGraph, new Map(), elements);
    if (explorationHint.action !== "stop") {
      appendEpisodeEvent(context, {
        taskId: task.id,
        kind: "observe",
        summary: `Proactive exploration hint: ${explorationHint.action} "${explorationHint.target ?? ""}" — ${explorationHint.reason}`,
        metadata: { explorationAction: explorationHint.action, target: explorationHint.target ?? "" }
      });
    }
  } catch (error) {
    logModuleError("proactive-exploration", "optional", error, "generating exploration hint");
  }
}
