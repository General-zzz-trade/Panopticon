/**
 * Meta-Cognition — experience-aware confidence adjustment.
 * Modifies confidence scores based on domain familiarity,
 * historical failure patterns, and stuck detection.
 */

import { getKnowledgeStats } from "../knowledge/store";
import type { AgentTask, RunContext } from "../types";
import { logModuleError } from "../core/module-logger";

export interface MetaCognitionAssessment {
  domainFamiliarity: number;     // 0 = never seen, 1 = very familiar
  selectorRiskLevel: number;     // 0 = no known risk, 1 = high failure rate
  stuckLevel: number;            // 0 = progressing, 1 = completely stuck
  confidenceMultiplier: number;  // applied to decision confidence
  rationale: string;
}

/**
 * Assess the agent's experience level for current context.
 * Returns a confidence multiplier and rationale.
 */
export function assessExperience(context: RunContext, task: AgentTask): MetaCognitionAssessment {
  const domainFamiliarity = computeDomainFamiliarity(context);
  const selectorRiskLevel = computeSelectorRisk(context, task);
  const stuckLevel = computeStuckLevel(context);

  // Confidence multiplier: reduce confidence when unfamiliar or at risk
  // Range: [0.5, 1.0] — never boost above baseline, only reduce
  const familiarityFactor = 0.7 + domainFamiliarity * 0.3;    // [0.7, 1.0]
  const riskFactor = 1.0 - selectorRiskLevel * 0.3;           // [0.7, 1.0]
  const stuckFactor = 1.0 - stuckLevel * 0.4;                 // [0.6, 1.0]
  const confidenceMultiplier = Math.max(0.5, familiarityFactor * riskFactor * stuckFactor);

  const reasons: string[] = [];
  if (domainFamiliarity < 0.3) reasons.push("unfamiliar domain");
  if (selectorRiskLevel > 0.5) reasons.push("high-risk selector");
  if (stuckLevel > 0.5) reasons.push("appears stuck");
  if (reasons.length === 0) reasons.push("normal experience level");

  return {
    domainFamiliarity,
    selectorRiskLevel,
    stuckLevel,
    confidenceMultiplier,
    rationale: reasons.join(", ")
  };
}

/**
 * Domain familiarity: how many past runs and knowledge entries exist for this domain?
 * Returns 0-1 where 0 = completely new domain, 1 = very familiar.
 */
function computeDomainFamiliarity(context: RunContext): number {
  const domain = extractDomain(context);
  if (!domain) return 0;

  try {
    const stats = getKnowledgeStats();
    // Use total knowledge entries as a rough proxy for experience
    // 0 entries = 0 familiarity, 20+ entries = 1.0 familiarity
    const totalKnowledge = stats.selectors + stats.lessons + stats.templates;
    return Math.min(1, totalKnowledge / 20);
  } catch (error) {
    logModuleError("meta-cognition", "optional", error, "computing domain familiarity");
    return 0;
  }
}

/**
 * Selector risk: has this task's selector failed in recent tasks within this run?
 * Returns 0-1 where 0 = no known failures, 1 = consistently failing.
 */
function computeSelectorRisk(context: RunContext, task: AgentTask): number {
  const selector = String(task.payload.selector ?? "");
  if (!selector) return 0;

  // Check how many times this selector has failed in THIS run
  const sameSelector = context.tasks.filter(
    t => String(t.payload.selector ?? "") === selector
  );
  const failedCount = sameSelector.filter(t => t.status === "failed").length;
  const totalCount = sameSelector.length;

  if (totalCount === 0) return 0;
  return failedCount / totalCount;
}

/**
 * Stuck detection: are we making progress or repeating failures?
 * Returns 0-1 where 0 = progressing well, 1 = completely stuck.
 */
function computeStuckLevel(context: RunContext): number {
  const recentTasks = context.tasks.slice(-5);
  if (recentTasks.length === 0) return 0;

  const failedRecent = recentTasks.filter(t => t.status === "failed").length;
  const failureRatio = failedRecent / recentTasks.length;

  // Also check if replans are exhausting budget
  const replanExhaustion = context.limits.maxReplansPerRun > 0
    ? context.replanCount / context.limits.maxReplansPerRun
    : 0;

  // Combined stuck score
  return Math.min(1, failureRatio * 0.6 + replanExhaustion * 0.4);
}

function extractDomain(context: RunContext): string {
  const url = context.worldState?.pageUrl;
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    logModuleError("meta-cognition", "optional", error, "extracting domain from URL");
    return "";
  }
}

/**
 * Should the agent request human help instead of continuing?
 * Returns true when confidence is very low and stuck level is high.
 */
export function shouldRequestHelp(assessment: MetaCognitionAssessment): boolean {
  return assessment.stuckLevel > 0.7 && assessment.confidenceMultiplier < 0.6;
}
