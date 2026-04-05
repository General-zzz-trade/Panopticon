/**
 * Unified Assessment — bridges meta-cognition (real-time) with self-model (historical)
 * to produce a single coherent capability assessment.
 *
 * Instead of running both independently, this module:
 * 1. Loads historical data from self-model
 * 2. Combines with real-time signals from meta-cognition
 * 3. Returns a single assessment that both modules agree on
 *
 * Also bridges reflection-loop with outcome-analyzer:
 * - outcome-analyzer records the data
 * - reflection-loop reads it for prior adjustment
 */

import { assessExperience, shouldRequestHelp, type MetaCognitionAssessment } from "./meta-cognition";
import { createSelfModel, getDomainProfile, getStrengthAssessment, suggestStrategyForDomain } from "../world-model/self-model";
import type { AgentTask, RunContext } from "../types";
import { logModuleError } from "../core/module-logger";

export interface UnifiedAssessment extends MetaCognitionAssessment {
  /** Historical strength from self-model */
  historicalStrength: "strong" | "moderate" | "weak" | "unknown";
  /** Strategy suggestions from self-model */
  strategySuggestions: string[];
  /** Whether we have enough historical data to trust the assessment */
  dataConfidence: number;
}

/**
 * Produce a unified assessment combining real-time meta-cognition with
 * historical self-model data.
 */
export function unifiedAssessment(
  context: RunContext,
  task: AgentTask,
  domain?: string
): UnifiedAssessment {
  // Real-time assessment from meta-cognition
  const realtime = assessExperience(context, task);

  // Historical assessment from self-model
  let historicalStrength: UnifiedAssessment["historicalStrength"] = "unknown";
  let strategySuggestions: string[] = [];
  let dataConfidence = 0;

  if (domain) {
    try {
      const model = createSelfModel();
      const strength = getStrengthAssessment(model, domain);
      historicalStrength = strength.strength;
      dataConfidence = strength.confidence;
      strategySuggestions = suggestStrategyForDomain(model, domain);

      // Blend: if we have historical data, use it to refine familiarity
      const profile = getDomainProfile(model, domain);
      if (profile && profile.totalRuns >= 3) {
        // Weighted blend: 60% historical, 40% real-time
        realtime.domainFamiliarity = realtime.domainFamiliarity * 0.4 + profile.successRate * 0.6;
        // Recalculate confidence multiplier with blended familiarity
        const familiarityFactor = 0.7 + realtime.domainFamiliarity * 0.3;
        const riskFactor = 1.0 - realtime.selectorRiskLevel * 0.3;
        const stuckFactor = 1.0 - realtime.stuckLevel * 0.4;
        realtime.confidenceMultiplier = Math.max(0.5, familiarityFactor * riskFactor * stuckFactor);
      }
    } catch (error) {
      logModuleError("unified-assessment", "optional", error, "loading self-model");
    }
  }

  return {
    ...realtime,
    historicalStrength,
    strategySuggestions,
    dataConfidence
  };
}

/**
 * Check if help should be requested, using unified assessment.
 */
export function shouldRequestHelpUnified(assessment: UnifiedAssessment): boolean {
  // If historically weak domain AND currently stuck, definitely ask
  if (assessment.historicalStrength === "weak" && assessment.stuckLevel > 0.3) {
    return true;
  }
  // Fall back to standard meta-cognition check
  return shouldRequestHelp(assessment);
}
