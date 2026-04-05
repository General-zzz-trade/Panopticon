/**
 * Learning Bridge — connects tactical learning (reflection-loop, knowledge store)
 * with strategic learning (outcome-analyzer, domain-strategy).
 *
 * Ensures data flows in both directions:
 * - Outcome analyzer feeds domain-strategy
 * - Domain-strategy informs planner via enriched context
 * - Reflection-loop priors are calibrated by outcome analyzer data
 */

import { analyzeDomain, getEffectiveStrategies, getIneffectiveStrategies } from "./outcome-analyzer";
import { computeDomainStrategy, type DomainStrategy } from "./domain-strategy";
import { findSkillsForGoal, composeSkills, type ComposedPlan, type Skill } from "./skill-composer";
import { logModuleError } from "../../core/module-logger";

export interface StrategicContext {
  /** Domain-level strategy (if enough data) */
  domainStrategy?: DomainStrategy;
  /** Matching skills for this goal */
  matchedSkills: Skill[];
  /** Composed plan from chaining skills (if possible) */
  composedPlan?: ComposedPlan;
  /** What strategies work in this domain */
  effectiveApproaches: string[];
  /** What to avoid */
  antiPatterns: string[];
}

/**
 * Build strategic context for a goal — used to enrich planner prompts.
 */
export function buildStrategicContext(goal: string, domain?: string): StrategicContext {
  const result: StrategicContext = {
    matchedSkills: [],
    effectiveApproaches: [],
    antiPatterns: []
  };

  // Find matching skills
  try {
    result.matchedSkills = findSkillsForGoal(goal);
  } catch (error) {
    logModuleError("learning-bridge", "optional", error, "finding skills for goal");
  }

  // Try to compose a plan from skills
  if (result.matchedSkills.length > 0) {
    try {
      const from = "initial";
      const to = "goal_achieved";
      const composed = composeSkills(from, to, result.matchedSkills);
      if (composed) result.composedPlan = composed;
    } catch (error) {
      logModuleError("learning-bridge", "optional", error, "composing skills");
    }
  }

  // Domain strategy
  if (domain) {
    try {
      const strategy = computeDomainStrategy(domain);
      if (strategy.confidence > 0) {
        result.domainStrategy = strategy;
        result.effectiveApproaches = strategy.approaches.map(a => a.name);
        result.antiPatterns = strategy.antiPatterns;
      }
    } catch (error) {
      logModuleError("learning-bridge", "optional", error, "computing domain strategy");
    }
  }

  return result;
}

/**
 * Format strategic context as a string for LLM prompt injection.
 */
export function formatStrategicContextForPrompt(ctx: StrategicContext): string {
  const parts: string[] = [];

  if (ctx.domainStrategy) {
    parts.push(`Domain strategy (confidence: ${(ctx.domainStrategy.confidence * 100).toFixed(0)}%):`);
    for (const approach of ctx.domainStrategy.approaches.slice(0, 3)) {
      parts.push(`  - ${approach.name}: ${approach.description}`);
    }
    if (ctx.antiPatterns.length > 0) {
      parts.push(`Avoid: ${ctx.antiPatterns.join(", ")}`);
    }
  }

  if (ctx.matchedSkills.length > 0) {
    parts.push(`Known skills: ${ctx.matchedSkills.map(s => s.name).join(", ")}`);
  }

  if (ctx.composedPlan) {
    parts.push(`Suggested plan (${ctx.composedPlan.skills.length} skills, est. success: ${(ctx.composedPlan.estimatedSuccessRate * 100).toFixed(0)}%):`);
    parts.push(`  ${ctx.composedPlan.skills.map(s => s.name).join(" → ")}`);
  }

  return parts.length > 0 ? parts.join("\n") : "";
}
