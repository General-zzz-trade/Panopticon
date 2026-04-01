import { AgentPolicy, PlanQualitySummary, UsageLedger } from "./types";

export type GoalCategory = "explicit" | "semi-natural" | "ambiguous";
export type FailureType = "none" | "timeout" | "selector_mismatch" | "assert_mismatch" | "invalid_response" | "unknown";
export type PolicyMode = "conservative" | "balanced" | "aggressive";

export interface ProviderHealth {
  plannerHealthy: boolean;
  replannerHealthy: boolean;
  diagnoserHealthy: boolean;
}

export interface EscalationPolicyInput {
  goalCategory: GoalCategory;
  plannerQuality?: PlanQualitySummary;
  currentFailureType: FailureType;
  failurePatterns: Array<{ taskType: string; count: number }>;
  usageLedger: UsageLedger;
  policyMode: PolicyMode;
  providerHealth: ProviderHealth;
}

export interface EscalationDecision {
  useRulePlanner: boolean;
  useLLMPlanner: boolean;
  useRuleReplanner: boolean;
  useLLMReplanner: boolean;
  fallbackToRules: boolean;
  abortEarly: boolean;
  useDiagnoser: boolean;
  llmUsageRationale: string;
  fallbackRationale: string;
}

export function decideEscalation(input: EscalationPolicyInput): EscalationDecision {
  const frequentFailures = input.failurePatterns.some((pattern) => pattern.count >= 3);
  const llmBudgetUsed = input.usageLedger.totalLLMInteractions >= 6;
  const lowQualityPlan = input.plannerQuality?.quality === "low" || (input.plannerQuality?.score ?? 100) < 70;
  const hasComplexFailure = input.currentFailureType === "selector_mismatch" || input.currentFailureType === "assert_mismatch";
  const timeoutFailure = input.currentFailureType === "timeout";

  const useRulePlanner = true;
  const useRuleReplanner = true;

  const useLLMPlanner =
    input.providerHealth.plannerHealthy &&
    !llmBudgetUsed &&
    (input.policyMode === "aggressive" || input.goalCategory !== "explicit" || lowQualityPlan);

  const useLLMReplanner =
    input.providerHealth.replannerHealthy &&
    !llmBudgetUsed &&
    (hasComplexFailure || (timeoutFailure && input.policyMode === "aggressive") || frequentFailures);

  const useDiagnoser =
    input.providerHealth.diagnoserHealthy &&
    !llmBudgetUsed &&
    (input.currentFailureType !== "none" || frequentFailures || lowQualityPlan);

  const abortEarly =
    frequentFailures &&
    input.policyMode === "conservative" &&
    (input.currentFailureType === "timeout" || input.currentFailureType === "unknown");

  const fallbackToRules = !input.providerHealth.plannerHealthy || !input.providerHealth.replannerHealthy || llmBudgetUsed;

  return {
    useRulePlanner,
    useLLMPlanner,
    useRuleReplanner,
    useLLMReplanner,
    fallbackToRules,
    abortEarly,
    useDiagnoser,
    llmUsageRationale: buildLLMRationale(input, { useLLMPlanner, useLLMReplanner, useDiagnoser }),
    fallbackRationale: buildFallbackRationale(input, { fallbackToRules, abortEarly })
  };
}

function buildLLMRationale(
  input: EscalationPolicyInput,
  flags: { useLLMPlanner: boolean; useLLMReplanner: boolean; useDiagnoser: boolean }
): string {
  const reasons: string[] = [];
  if (flags.useLLMPlanner) reasons.push(`LLM planner enabled for ${input.goalCategory} goal`);
  if (flags.useLLMReplanner) reasons.push(`LLM replanner enabled for ${input.currentFailureType} failure`);
  if (flags.useDiagnoser) reasons.push("LLM diagnoser enabled to summarize failure risks");
  if (reasons.length === 0) reasons.push("LLM path skipped due to policy, provider health, or usage budget");
  return reasons.join("; ");
}

function buildFallbackRationale(
  input: EscalationPolicyInput,
  flags: { fallbackToRules: boolean; abortEarly: boolean }
): string {
  const reasons: string[] = [];
  if (flags.fallbackToRules) reasons.push("Rule fallback selected due to provider health or LLM budget cap");
  if (flags.abortEarly) reasons.push("Abort-early selected due to repeated unsafe failures in conservative mode");
  if (reasons.length === 0) reasons.push(`No forced fallback; policy mode ${input.policyMode}`);
  return reasons.join("; ");
}
