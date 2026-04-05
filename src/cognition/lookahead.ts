/**
 * Adaptive Lookahead — predicts upcoming task outcomes using the causal graph.
 *
 * Looks N steps ahead (adaptive based on domain familiarity) and estimates
 * the probability of success for each upcoming task. If overall confidence
 * is low, suggests proactive replanning before failure occurs.
 *
 * Horizon logic:
 *   domainFamiliarity > 0.7  → horizon = 1 (trust the plan)
 *   domainFamiliarity 0.3-0.7 → horizon = 3 (moderate lookahead)
 *   domainFamiliarity < 0.3  → horizon = 5 (unfamiliar, look far)
 *   causal graph < 3 edges   → horizon = 1 (not enough data)
 */

import type { AgentTask, RunContext } from "../types";
import type { CausalGraph, CausalEdge } from "../world-model/causal-graph";
import { inferCurrentState } from "../decomposer/causal-decomposer";
import type { MetaCognitionAssessment } from "./meta-cognition";

export interface TaskPrediction {
  taskId: string;
  taskType: string;
  /** Predicted success probability (0-1) from causal graph */
  predictedSuccess: number;
  /** Expected state after this task */
  predictedState: string;
  /** Why this task might fail */
  riskFactors: string[];
}

export interface LookaheadResult {
  /** How many steps we looked ahead */
  horizon: number;
  /** Per-task predictions */
  predictions: TaskPrediction[];
  /** Product of individual predicted successes */
  overallConfidence: number;
  /** Recommended action based on predictions */
  suggestedAction: "continue" | "replan_now" | "ask_user";
  /** Why replanning is suggested (if applicable) */
  replanReason?: string;
}

/**
 * Compute adaptive lookahead horizon based on domain familiarity and graph size.
 */
export function computeHorizon(
  assessment: MetaCognitionAssessment,
  graphEdgeCount: number
): number {
  // Not enough causal data to predict
  if (graphEdgeCount < 3) return 1;

  if (assessment.domainFamiliarity > 0.7) return 1;
  if (assessment.domainFamiliarity > 0.3) return 3;
  return 5;
}

/**
 * Run adaptive lookahead: predict outcomes of upcoming tasks.
 */
export function runLookahead(
  context: RunContext,
  currentIndex: number,
  causalGraph: CausalGraph,
  assessment: MetaCognitionAssessment
): LookaheadResult {
  const horizon = computeHorizon(assessment, causalGraph.edges.size);
  const upcomingTasks = context.tasks.slice(currentIndex + 1, currentIndex + 1 + horizon);

  if (upcomingTasks.length === 0) {
    return {
      horizon,
      predictions: [],
      overallConfidence: 1.0,
      suggestedAction: "continue"
    };
  }

  // Infer current state from latest observation
  let currentState = inferCurrentState({
    pageUrl: context.worldState?.pageUrl,
    appState: context.worldState?.appState,
    visibleText: context.latestObservation?.visibleText
  });

  const predictions: TaskPrediction[] = [];

  for (const task of upcomingTasks) {
    const prediction = predictTaskOutcome(task, currentState, causalGraph);
    predictions.push(prediction);

    // Advance simulated state for next prediction
    if (prediction.predictedState !== "unknown") {
      currentState = prediction.predictedState;
    }
  }

  const overallConfidence = predictions.reduce((prod, p) => prod * p.predictedSuccess, 1.0);

  // Decision logic
  let suggestedAction: LookaheadResult["suggestedAction"] = "continue";
  let replanReason: string | undefined;

  if (overallConfidence < 0.3) {
    suggestedAction = "replan_now";
    const worstTask = predictions.reduce((worst, p) =>
      p.predictedSuccess < worst.predictedSuccess ? p : worst
    );
    replanReason = `Lookahead predicts low success (${(overallConfidence * 100).toFixed(0)}%). Weakest: ${worstTask.taskType} (${(worstTask.predictedSuccess * 100).toFixed(0)}%). Risks: ${worstTask.riskFactors.join(", ")}`;
  } else if (overallConfidence < 0.5) {
    suggestedAction = "ask_user";
    replanReason = `Moderate uncertainty ahead (${(overallConfidence * 100).toFixed(0)}% predicted success over ${predictions.length} steps)`;
  }

  return {
    horizon,
    predictions,
    overallConfidence,
    suggestedAction,
    replanReason
  };
}

/**
 * Predict a single task's outcome using the causal graph.
 */
function predictTaskOutcome(
  task: AgentTask,
  currentState: string,
  graph: CausalGraph
): TaskPrediction {
  const riskFactors: string[] = [];

  // Find edges from current state matching this task type
  const outEdges = graph.edgesBySource.get(currentState) ?? [];
  const matchingEdges = outEdges.filter(e => e.action === task.type);

  // Also check for edges matching the specific action detail (selector/url)
  const actionDetail = String(task.payload.selector ?? task.payload.url ?? task.payload.text ?? "");
  const exactEdges = matchingEdges.filter(e => e.actionDetail === actionDetail);

  let predictedSuccess: number;
  let predictedState = "unknown";

  if (exactEdges.length > 0) {
    // Exact match: use the edge's confidence directly
    const bestEdge = exactEdges.reduce((best, e) =>
      e.confidence > best.confidence ? e : best
    );
    predictedSuccess = bestEdge.confidence;
    predictedState = bestEdge.toState;

    if (bestEdge.failureCount > 0) {
      riskFactors.push(`${bestEdge.failureCount} past failures on this exact action`);
    }
  } else if (matchingEdges.length > 0) {
    // Type match: use average confidence of similar actions
    const avgConfidence = matchingEdges.reduce((s, e) => s + e.confidence, 0) / matchingEdges.length;
    predictedSuccess = avgConfidence * 0.8; // Discount for non-exact match
    predictedState = matchingEdges[0].toState;
    riskFactors.push("no exact causal match, using similar actions");
  } else {
    // No match at all: unknown territory
    predictedSuccess = 0.5; // Neutral prior
    riskFactors.push("no causal data for this action from current state");
  }

  // Additional risk factors
  if (task.retries > 0) {
    riskFactors.push(`already retried ${task.retries} time(s)`);
    predictedSuccess *= 0.7;
  }

  if (task.replanDepth > 0) {
    riskFactors.push(`replan depth ${task.replanDepth}`);
    predictedSuccess *= 0.8;
  }

  return {
    taskId: task.id,
    taskType: task.type,
    predictedSuccess: Math.max(0, Math.min(1, predictedSuccess)),
    predictedState,
    riskFactors
  };
}
