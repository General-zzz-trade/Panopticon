import { FailurePattern } from "../memory";
import {
  EscalationDecisionTrace,
  EscalationPolicyDecision,
  EscalationPolicyMode,
  EscalationStage,
  FailurePatternSummary,
  FailureType,
  GoalCategory,
  PlanQualitySummary,
  ProviderHealth,
  UsageLedger
} from "../types";

export interface EscalationPolicyInput {
  stage: EscalationStage;
  goalCategory: GoalCategory;
  plannerQuality: PlanQualitySummary["quality"] | "unknown";
  currentFailureType: FailureType;
  failurePatterns: FailurePattern[];
  usageLedger?: UsageLedger;
  policyMode: EscalationPolicyMode;
  providerHealth: ProviderHealth;
}

export function decideEscalation(input: EscalationPolicyInput): EscalationPolicyDecision {
  if (input.stage === "planner") {
    return decidePlannerEscalation(input);
  }

  if (input.stage === "replanner") {
    return decideReplannerEscalation(input);
  }

  return decideDiagnoserEscalation(input);
}

export function classifyGoalCategory(goal: string): GoalCategory {
  const explicitSignals = [
    /start app/i,
    /wait for server/i,
    /open page/i,
    /assert text/i,
    /\bclick\s+"/i,
    /\btype\s+"/i,
    /\bselect\s+"/i,
    /\bhover\s+(?:over\s+)?"/i,
    /\bstop app\b/i
  ].filter((pattern) => pattern.test(goal)).length;
  const naturalSignals = [
    /launch/i,
    /using/i,
    /confirm/i,
    /appears/i,
    /make .* work/i,
    /prove/i,
    /leave evidence/i
  ].filter((pattern) => pattern.test(goal)).length;

  if (explicitSignals >= 2 && naturalSignals === 0) {
    return "explicit";
  }

  if (naturalSignals > 0) {
    return "semi-natural";
  }

  return "ambiguous";
}

export function classifyFailureType(
  value: string | undefined,
  options: {
    emptyResponse?: boolean;
    invalidJson?: boolean;
    lowQuality?: boolean;
    providerUnavailable?: boolean;
    repeatedFailure?: boolean;
  } = {}
): FailureType {
  if (options.providerUnavailable) {
    return "provider_unavailable";
  }

  if (options.emptyResponse) {
    return "empty_response";
  }

  if (options.invalidJson) {
    return "invalid_json";
  }

  if (options.lowQuality) {
    return "low_quality_output";
  }

  if (options.repeatedFailure) {
    return "repeated_failure";
  }

  if (!value) {
    return "none";
  }

  if (/assert|expected text|text.*not found|not found.*text/i.test(value)) {
    return "assert_mismatch";
  }

  if (/not editable|not interactable|element.*disabled|disabled.*element|readonly|read.only/i.test(value)) {
    return "selector_mismatch";
  }

  if (/option.*not found|no option.*match|no.*option.*value|value.*not.*option/i.test(value)) {
    return "selector_mismatch";
  }

  if (/selector|no node matched|locator/i.test(value)) {
    return "selector_mismatch";
  }

  if (/timeout|timed out|did not become available/i.test(value)) {
    return "timeout";
  }

  return "unknown";
}

export function summarizeFailurePatterns(failurePatterns: FailurePattern[]): FailurePatternSummary[] {
  return failurePatterns.slice(0, 5).map((pattern) => ({
    taskType: pattern.taskType,
    count: pattern.count
  }));
}

export function createEscalationDecisionTrace(input: EscalationPolicyInput & {
  decision: EscalationPolicyDecision;
  taskId?: string;
}): EscalationDecisionTrace {
  return {
    stage: input.stage,
    taskId: input.taskId,
    goalCategory: input.goalCategory,
    plannerQuality: input.plannerQuality,
    currentFailureType: input.currentFailureType,
    failurePatterns: summarizeFailurePatterns(input.failurePatterns),
    policyMode: input.policyMode,
    providerHealth: input.providerHealth,
    decision: input.decision,
    timestamp: new Date().toISOString()
  };
}

function decidePlannerEscalation(input: EscalationPolicyInput): EscalationPolicyDecision {
  const provider = input.providerHealth.planner;
  const rationale: string[] = [];
  const lowRuleQuality = input.plannerQuality === "low";
  const nonExplicitGoal = input.goalCategory !== "explicit";
  const repeatedFailures = hasRepeatedFailures(input.failurePatterns);
  const budgetTight = (input.usageLedger?.llmPlannerCalls ?? 0) > 0 && input.policyMode === "conservative";

  let useLLMPlanner = false;

  if (!provider.configured) {
    rationale.push("Planner provider is not configured.");
  } else if (!provider.healthy) {
    rationale.push(`Planner provider is unhealthy: ${provider.rationale}`);
  } else if (budgetTight) {
    rationale.push("Planner LLM budget is already used under conservative mode.");
  } else if (input.policyMode === "aggressive" && (nonExplicitGoal || lowRuleQuality)) {
    useLLMPlanner = true;
    rationale.push("Aggressive mode escalates planning when the goal is not explicit or rule quality is low.");
  } else if (input.goalCategory === "ambiguous") {
    useLLMPlanner = true;
    rationale.push("Ambiguous goals are escalated to the LLM planner.");
  } else if (input.goalCategory === "semi-natural" && input.policyMode !== "conservative") {
    useLLMPlanner = true;
    rationale.push("Semi-natural goals are escalated outside conservative mode.");
  } else if (lowRuleQuality) {
    useLLMPlanner = true;
    rationale.push("Low rule planner quality triggers LLM escalation.");
  } else if (repeatedFailures && input.policyMode === "aggressive") {
    useLLMPlanner = true;
    rationale.push("Repeated historical failures trigger an aggressive planner escalation.");
  } else {
    rationale.push("Rule planners are sufficient for the current goal and quality level.");
  }

  const fallbackToRules = !useLLMPlanner;

  return {
    useRulePlanner: true,
    useLLMPlanner,
    useRuleReplanner: false,
    useLLMReplanner: false,
    useRuleDiagnoser: false,
    useLLMDiagnoser: false,
    fallbackToRules,
    abortEarly: false,
    rationale,
    llmUsageRationale: useLLMPlanner ? rationale.at(-1) : undefined,
    fallbackRationale: fallbackToRules ? rationale.at(-1) : undefined
  };
}

function decideReplannerEscalation(input: EscalationPolicyInput): EscalationPolicyDecision {
  const provider = input.providerHealth.replanner;
  const rationale: string[] = [];
  const repeatedFailures = hasRepeatedFailures(input.failurePatterns);
  const llmBudgetUsed = (input.usageLedger?.llmReplannerCalls ?? 0) > 0 && input.policyMode === "conservative";
  const complexFailure =
    input.currentFailureType === "selector_mismatch" ||
    input.currentFailureType === "assert_mismatch" ||
    input.currentFailureType === "low_quality_output" ||
    input.currentFailureType === "repeated_failure";

  let useLLMReplanner = false;

  if (!provider.configured) {
    rationale.push("Replanner provider is not configured.");
  } else if (!provider.healthy) {
    rationale.push(`Replanner provider is unhealthy: ${provider.rationale}`);
  } else if (llmBudgetUsed) {
    rationale.push("Replanner LLM budget is already used under conservative mode.");
  } else if (complexFailure) {
    useLLMReplanner = true;
    rationale.push(`Failure type ${input.currentFailureType} is complex enough to justify LLM replanning.`);
  } else if (input.currentFailureType === "timeout" && input.policyMode === "aggressive") {
    useLLMReplanner = true;
    rationale.push("Aggressive mode escalates timeout recovery to the LLM replanner.");
  } else if (repeatedFailures && input.policyMode !== "conservative") {
    useLLMReplanner = true;
    rationale.push("Repeated failures justify LLM replanning outside conservative mode.");
  } else {
    rationale.push("Rule replanning is sufficient for the current failure.");
  }

  const fallbackToRules = !useLLMReplanner;
  const abortEarly =
    input.currentFailureType === "repeated_failure" &&
    !useLLMReplanner &&
    input.policyMode === "conservative" &&
    repeatedFailures;

  if (abortEarly) {
    rationale.push("Abort early because the same failure pattern keeps repeating under conservative mode.");
  }

  return {
    useRulePlanner: false,
    useLLMPlanner: false,
    useRuleReplanner: true,
    useLLMReplanner,
    useRuleDiagnoser: false,
    useLLMDiagnoser: false,
    fallbackToRules,
    abortEarly,
    rationale,
    llmUsageRationale: useLLMReplanner ? rationale.at(-1) : undefined,
    fallbackRationale: fallbackToRules ? rationale.at(-1) : undefined
  };
}

function decideDiagnoserEscalation(input: EscalationPolicyInput): EscalationPolicyDecision {
  const provider = input.providerHealth.diagnoser;
  const rationale: string[] = [];
  const repeatedFailures = hasRepeatedFailures(input.failurePatterns);
  const shouldEscalate =
    input.policyMode === "aggressive" ||
    input.currentFailureType !== "none" ||
    repeatedFailures ||
    input.goalCategory !== "explicit";

  let useLLMDiagnoser = false;

  if (!provider.configured) {
    rationale.push("Diagnoser provider is not configured.");
  } else if (!provider.healthy) {
    rationale.push(`Diagnoser provider is unhealthy: ${provider.rationale}`);
  } else if (shouldEscalate) {
    useLLMDiagnoser = true;
    rationale.push("Run outcome and failure history justify an LLM diagnosis.");
  } else {
    rationale.push("Rule diagnosis is sufficient for this run.");
  }

  return {
    useRulePlanner: false,
    useLLMPlanner: false,
    useRuleReplanner: false,
    useLLMReplanner: false,
    useRuleDiagnoser: true,
    useLLMDiagnoser,
    fallbackToRules: !useLLMDiagnoser,
    abortEarly: false,
    rationale,
    llmUsageRationale: useLLMDiagnoser ? rationale.at(-1) : undefined,
    fallbackRationale: !useLLMDiagnoser ? rationale.at(-1) : undefined
  };
}

function hasRepeatedFailures(failurePatterns: FailurePattern[]): boolean {
  return failurePatterns.some((pattern) => pattern.count >= 3);
}
