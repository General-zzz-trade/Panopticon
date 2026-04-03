import type { BeliefUpdate, ExperimentResult, FailureHypothesis } from "./types";

export function applyBeliefUpdates(input: {
  runId: string;
  taskId?: string;
  hypotheses: FailureHypothesis[];
  experimentResults: ExperimentResult[];
}): {
  updatedHypotheses: FailureHypothesis[];
  beliefUpdates: BeliefUpdate[];
} {
  const updates: BeliefUpdate[] = [];
  const updatedHypotheses = input.hypotheses.map((hypothesis) => {
    const relatedResults = input.experimentResults.filter((result) => result.hypothesisId === hypothesis.id);
    const previousConfidence = hypothesis.confidence;
    const delta = relatedResults.reduce((sum, result) => {
      const weight = inferExperimentReliability(result.experiment);
      return sum + result.confidenceDelta * weight;
    }, 0);
    const nextConfidence = clamp(previousConfidence + delta, 0.05, 0.98);
    updates.push({
      id: `belief-${input.runId}-${Math.random().toString(36).slice(2, 8)}`,
      runId: input.runId,
      taskId: input.taskId,
      hypothesisId: hypothesis.id,
      previousConfidence,
      nextConfidence,
      rationale: relatedResults.length > 0
        ? `Updated from ${previousConfidence.toFixed(2)} to ${nextConfidence.toFixed(2)} after ${relatedResults.length} experiment(s).`
        : `No experiment updated this hypothesis; confidence remains ${nextConfidence.toFixed(2)}.`
    });

    return {
      ...hypothesis,
      confidence: nextConfidence
    };
  });

  return {
    updatedHypotheses: updatedHypotheses.sort((left, right) => right.confidence - left.confidence),
    beliefUpdates: updates
  };
}

function inferExperimentReliability(experimentName: string): number {
  const lower = experimentName.toLowerCase();
  if (lower.includes("selector")) return 1.0;
  if (lower.includes("page") && lower.includes("context")) return 0.9;
  if (lower.includes("readiness") || lower.includes("wait")) return 0.8;
  if (lower.includes("session") || lower.includes("authenticated")) return 0.7;
  if (lower.includes("assert") || lower.includes("text")) return 0.6;
  return 0.75;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
