import { AgentPolicy, EscalationPolicyMode } from "./types";

export interface PolicyOverrides extends Partial<AgentPolicy> {}

export function resolvePolicy(overrides: PolicyOverrides = {}): AgentPolicy {
  const mode = overrides.mode ?? readCostMode("AGENT_POLICY_MODE", "balanced");

  return {
    mode,
    plannerCostMode: overrides.plannerCostMode ?? readCostMode("AGENT_PLANNER_COST_MODE", mode),
    replannerCostMode: overrides.replannerCostMode ?? readCostMode("AGENT_REPLANNER_COST_MODE", mode),
    preferRuleSystemsOnCheapGoals:
      overrides.preferRuleSystemsOnCheapGoals ?? readBoolean("AGENT_PREFER_RULES_ON_CHEAP_GOALS", true),
    allowLLMReplannerForSimpleFailures:
      overrides.allowLLMReplannerForSimpleFailures ?? readBoolean("AGENT_ALLOW_LLM_REPLANNER_FOR_SIMPLE_FAILURES", false)
  };
}

function readCostMode(
  envName: string,
  fallback: EscalationPolicyMode
): EscalationPolicyMode {
  const value = process.env[envName]?.trim();
  if (value === "conservative" || value === "balanced" || value === "aggressive") {
    return value;
  }

  return fallback;
}

function readBoolean(envName: string, fallback: boolean): boolean {
  const value = process.env[envName]?.trim().toLowerCase();
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}
