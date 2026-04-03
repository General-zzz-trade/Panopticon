import type { AgentTask } from "../types";
import type { CognitiveDecision, VerificationResult } from "./types";

export function decideNextStep(input: {
  task: AgentTask;
  actionVerification?: VerificationResult;
  stateVerification?: VerificationResult;
  goalVerification?: VerificationResult;
  replanCount: number;
  maxReplans?: number;
}): CognitiveDecision {
  const failedVerification = [
    input.actionVerification,
    input.stateVerification,
    input.goalVerification
  ].find((result) => result && !result.passed);

  if (!failedVerification) {
    return {
      nextAction: "continue",
      rationale: "Action and state verification passed, so execution can continue.",
      confidence: 0.9
    };
  }

  if (failedVerification.verifier === "goal") {
    return {
      nextAction: "reobserve",
      rationale: "Goal verification failed while action completed; refresh observation before escalating.",
      confidence: 0.7
    };
  }

  const maxReplans = input.maxReplans ?? 0;
  const budgetRatio = maxReplans > 0 ? (maxReplans - input.replanCount) / maxReplans : 0;

  if (maxReplans > 0 && input.replanCount < maxReplans) {
    const replanConfidence = 0.6 + budgetRatio * 0.2;
    return {
      nextAction: "replan",
      rationale: `Verification failed in ${failedVerification.verifier}; replan budget remains available (${maxReplans - input.replanCount}/${maxReplans}).`,
      confidence: replanConfidence
    };
  }

  if (input.task.retries === 0) {
    return {
      nextAction: "retry_task",
      rationale: "Verification failed but the task has not been retried yet.",
      confidence: 0.6
    };
  }

  const exhaustionFactor = Math.min(1, (input.task.attempts ?? 1) / 5);
  const abortConfidence = 0.8 + exhaustionFactor * 0.15;
  return {
    nextAction: "abort",
    rationale: "Verification failed and no safe retry or replan budget remains.",
    confidence: abortConfidence
  };
}
