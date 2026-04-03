import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGoalCategory,
  classifyFailureType,
  decideEscalation,
  type EscalationPolicyInput
} from "./escalation-policy";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const HEALTHY_PROVIDER = { configured: true, healthy: true, rationale: "ok" };
const UNCONFIGURED_PROVIDER = { configured: false, healthy: false, rationale: "not configured" };
const UNHEALTHY_PROVIDER = { configured: true, healthy: false, rationale: "circuit open" };

function plannerInput(
  overrides: Partial<EscalationPolicyInput> = {}
): EscalationPolicyInput {
  return {
    stage: "planner",
    goalCategory: "explicit",
    plannerQuality: "high",
    currentFailureType: "none",
    failurePatterns: [],
    policyMode: "balanced",
    providerHealth: {
      planner: HEALTHY_PROVIDER,
      replanner: HEALTHY_PROVIDER,
      diagnoser: HEALTHY_PROVIDER
    },
    ...overrides
  };
}

function replannerInput(
  overrides: Partial<EscalationPolicyInput> = {}
): EscalationPolicyInput {
  return {
    stage: "replanner",
    goalCategory: "explicit",
    plannerQuality: "high",
    currentFailureType: "timeout",
    failurePatterns: [],
    policyMode: "balanced",
    providerHealth: {
      planner: HEALTHY_PROVIDER,
      replanner: HEALTHY_PROVIDER,
      diagnoser: HEALTHY_PROVIDER
    },
    ...overrides
  };
}

function diagnoserInput(
  overrides: Partial<EscalationPolicyInput> = {}
): EscalationPolicyInput {
  return {
    stage: "diagnoser",
    goalCategory: "explicit",
    plannerQuality: "high",
    currentFailureType: "none",
    failurePatterns: [],
    policyMode: "balanced",
    providerHealth: {
      planner: HEALTHY_PROVIDER,
      replanner: HEALTHY_PROVIDER,
      diagnoser: HEALTHY_PROVIDER
    },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// classifyGoalCategory
// ---------------------------------------------------------------------------

test("classifyGoalCategory: explicit goal with 2+ signal words", () => {
  const goal = 'start app "npm run dev" and open page "http://localhost:3000"';
  assert.equal(classifyGoalCategory(goal), "explicit");
});

test("classifyGoalCategory: explicit goal – all 6 signal words", () => {
  const goal = 'start app "x" and wait for server "http://x" and open page "http://x" and click "#btn" and assert text "ok" and stop app';
  assert.equal(classifyGoalCategory(goal), "explicit");
});

test("classifyGoalCategory: semi-natural – has 'launch'", () => {
  const goal = 'launch the app and check dashboard';
  assert.equal(classifyGoalCategory(goal), "semi-natural");
});

test("classifyGoalCategory: semi-natural – has 'using'", () => {
  const goal = 'start app using "npm run dev" and open page "http://localhost:3000"';
  assert.equal(classifyGoalCategory(goal), "semi-natural");
});

test("classifyGoalCategory: semi-natural – has 'prove' and signal words", () => {
  const goal = 'prove the login works by clicking "#login"';
  assert.equal(classifyGoalCategory(goal), "semi-natural");
});

test("classifyGoalCategory: ambiguous – only one signal word", () => {
  const goal = 'open page "http://example.com"';
  assert.equal(classifyGoalCategory(goal), "ambiguous");
});

test("classifyGoalCategory: ambiguous – no recognizable patterns", () => {
  assert.equal(classifyGoalCategory("check if everything is working"), "ambiguous");
});

// ---------------------------------------------------------------------------
// classifyFailureType
// ---------------------------------------------------------------------------

test("classifyFailureType: selector mismatch from error message", () => {
  assert.equal(classifyFailureType("no node matched selector #foo"), "selector_mismatch");
});

test("classifyFailureType: timeout from error message", () => {
  assert.equal(classifyFailureType("server did not become available"), "timeout");
});

test("classifyFailureType: timeout keyword", () => {
  assert.equal(classifyFailureType("operation timed out after 5000ms"), "timeout");
});

test("classifyFailureType: assert mismatch from error message", () => {
  assert.equal(classifyFailureType("expected text not found on page"), "assert_mismatch");
});

test("classifyFailureType: provider unavailable flag overrides message", () => {
  assert.equal(classifyFailureType("timeout in response", { providerUnavailable: true }), "provider_unavailable");
});

test("classifyFailureType: emptyResponse flag", () => {
  assert.equal(classifyFailureType(undefined, { emptyResponse: true }), "empty_response");
});

test("classifyFailureType: invalidJson flag", () => {
  assert.equal(classifyFailureType(undefined, { invalidJson: true }), "invalid_json");
});

test("classifyFailureType: lowQuality flag", () => {
  assert.equal(classifyFailureType(undefined, { lowQuality: true }), "low_quality_output");
});

test("classifyFailureType: repeatedFailure flag", () => {
  assert.equal(classifyFailureType(undefined, { repeatedFailure: true }), "repeated_failure");
});

test("classifyFailureType: unknown error message", () => {
  assert.equal(classifyFailureType("something went wrong"), "unknown");
});

test("classifyFailureType: undefined value with no flags", () => {
  assert.equal(classifyFailureType(undefined), "none");
});

// ---------------------------------------------------------------------------
// decideEscalation – planner stage
// ---------------------------------------------------------------------------

test("planner: explicit goal + high quality → use rule planner only", () => {
  const decision = decideEscalation(plannerInput());
  assert.equal(decision.useRulePlanner, true);
  assert.equal(decision.useLLMPlanner, false);
});

test("planner: ambiguous goal → escalate to LLM", () => {
  const decision = decideEscalation(plannerInput({ goalCategory: "ambiguous" }));
  assert.equal(decision.useLLMPlanner, true);
});

test("planner: semi-natural goal + balanced mode → escalate to LLM", () => {
  const decision = decideEscalation(plannerInput({ goalCategory: "semi-natural", policyMode: "balanced" }));
  assert.equal(decision.useLLMPlanner, true);
});

test("planner: semi-natural goal + conservative mode → stay with rules", () => {
  const decision = decideEscalation(plannerInput({ goalCategory: "semi-natural", policyMode: "conservative" }));
  assert.equal(decision.useLLMPlanner, false);
});

test("planner: low rule quality → escalate to LLM", () => {
  const decision = decideEscalation(plannerInput({ plannerQuality: "low" }));
  assert.equal(decision.useLLMPlanner, true);
});

test("planner: aggressive mode + non-explicit goal → escalate to LLM", () => {
  const decision = decideEscalation(plannerInput({ policyMode: "aggressive", goalCategory: "semi-natural" }));
  assert.equal(decision.useLLMPlanner, true);
});

test("planner: aggressive mode + repeated failures → escalate to LLM", () => {
  const decision = decideEscalation(plannerInput({
    policyMode: "aggressive",
    failurePatterns: [{ taskType: "click", count: 5, latestMessages: [] }]
  }));
  assert.equal(decision.useLLMPlanner, true);
});

test("planner: provider not configured → no LLM", () => {
  const decision = decideEscalation(plannerInput({
    goalCategory: "ambiguous",
    providerHealth: {
      planner: UNCONFIGURED_PROVIDER,
      replanner: HEALTHY_PROVIDER,
      diagnoser: HEALTHY_PROVIDER
    }
  }));
  assert.equal(decision.useLLMPlanner, false);
});

test("planner: provider unhealthy → no LLM", () => {
  const decision = decideEscalation(plannerInput({
    goalCategory: "ambiguous",
    providerHealth: {
      planner: UNHEALTHY_PROVIDER,
      replanner: HEALTHY_PROVIDER,
      diagnoser: HEALTHY_PROVIDER
    }
  }));
  assert.equal(decision.useLLMPlanner, false);
});

test("planner: conservative mode + prior LLM call → no more LLM", () => {
  const decision = decideEscalation(plannerInput({
    policyMode: "conservative",
    goalCategory: "ambiguous",
    usageLedger: {
      rulePlannerAttempts: 1, llmPlannerCalls: 1,
      ruleReplannerAttempts: 0, llmReplannerCalls: 0,
      llmDiagnoserCalls: 0, plannerTimeouts: 0, replannerTimeouts: 0,
      diagnoserTimeouts: 0, plannerFallbacks: 0, replannerFallbacks: 0,
      totalLLMInteractions: 1,
      totalInputTokens: 0, totalOutputTokens: 0
    }
  }));
  assert.equal(decision.useLLMPlanner, false);
});

// ---------------------------------------------------------------------------
// decideEscalation – replanner stage
// ---------------------------------------------------------------------------

test("replanner: timeout + balanced mode → rule replanner (not complex)", () => {
  const decision = decideEscalation(replannerInput({ currentFailureType: "timeout", policyMode: "balanced" }));
  assert.equal(decision.useRuleReplanner, true);
  assert.equal(decision.useLLMReplanner, false);
});

test("replanner: timeout + aggressive mode → escalate to LLM", () => {
  const decision = decideEscalation(replannerInput({ currentFailureType: "timeout", policyMode: "aggressive" }));
  assert.equal(decision.useLLMReplanner, true);
});

test("replanner: selector_mismatch → escalate to LLM", () => {
  const decision = decideEscalation(replannerInput({ currentFailureType: "selector_mismatch" }));
  assert.equal(decision.useLLMReplanner, true);
});

test("replanner: assert_mismatch → escalate to LLM", () => {
  const decision = decideEscalation(replannerInput({ currentFailureType: "assert_mismatch" }));
  assert.equal(decision.useLLMReplanner, true);
});

test("replanner: low_quality_output → escalate to LLM", () => {
  const decision = decideEscalation(replannerInput({ currentFailureType: "low_quality_output" }));
  assert.equal(decision.useLLMReplanner, true);
});

test("replanner: repeated_failure + non-conservative → escalate to LLM", () => {
  const decision = decideEscalation(replannerInput({
    currentFailureType: "repeated_failure",
    policyMode: "balanced",
    failurePatterns: [{ taskType: "click", count: 4, latestMessages: [] }]
  }));
  assert.equal(decision.useLLMReplanner, true);
});

test("replanner: repeated_failure + conservative → abort early", () => {
  const decision = decideEscalation(replannerInput({
    currentFailureType: "repeated_failure",
    policyMode: "conservative",
    failurePatterns: [{ taskType: "click", count: 4, latestMessages: [] }],
    providerHealth: {
      planner: HEALTHY_PROVIDER,
      replanner: UNCONFIGURED_PROVIDER,
      diagnoser: HEALTHY_PROVIDER
    }
  }));
  assert.equal(decision.abortEarly, true);
});

test("replanner: provider unconfigured + complex failure → no LLM, fallback to rules", () => {
  const decision = decideEscalation(replannerInput({
    currentFailureType: "selector_mismatch",
    providerHealth: {
      planner: HEALTHY_PROVIDER,
      replanner: UNCONFIGURED_PROVIDER,
      diagnoser: HEALTHY_PROVIDER
    }
  }));
  assert.equal(decision.useLLMReplanner, false);
  assert.equal(decision.fallbackToRules, true);
});

// ---------------------------------------------------------------------------
// decideEscalation – diagnoser stage
// ---------------------------------------------------------------------------

test("diagnoser: explicit goal + no failure + balanced → rule only", () => {
  const decision = decideEscalation(diagnoserInput());
  assert.equal(decision.useRuleDiagnoser, true);
  assert.equal(decision.useLLMDiagnoser, false);
});

test("diagnoser: non-none failure type → escalate to LLM", () => {
  const decision = decideEscalation(diagnoserInput({ currentFailureType: "timeout" }));
  assert.equal(decision.useLLMDiagnoser, true);
});

test("diagnoser: repeated failures → escalate to LLM", () => {
  const decision = decideEscalation(diagnoserInput({
    failurePatterns: [{ taskType: "assert_text", count: 3, latestMessages: [] }]
  }));
  assert.equal(decision.useLLMDiagnoser, true);
});

test("diagnoser: ambiguous goal → escalate to LLM", () => {
  const decision = decideEscalation(diagnoserInput({ goalCategory: "ambiguous" }));
  assert.equal(decision.useLLMDiagnoser, true);
});

test("diagnoser: aggressive mode → escalate to LLM", () => {
  const decision = decideEscalation(diagnoserInput({ policyMode: "aggressive" }));
  assert.equal(decision.useLLMDiagnoser, true);
});

test("diagnoser: provider not configured → no LLM", () => {
  const decision = decideEscalation(diagnoserInput({
    currentFailureType: "timeout",
    providerHealth: {
      planner: HEALTHY_PROVIDER,
      replanner: HEALTHY_PROVIDER,
      diagnoser: UNCONFIGURED_PROVIDER
    }
  }));
  assert.equal(decision.useLLMDiagnoser, false);
});

test("diagnoser: provider unhealthy → no LLM", () => {
  const decision = decideEscalation(diagnoserInput({
    currentFailureType: "timeout",
    providerHealth: {
      planner: HEALTHY_PROVIDER,
      replanner: HEALTHY_PROVIDER,
      diagnoser: UNHEALTHY_PROVIDER
    }
  }));
  assert.equal(decision.useLLMDiagnoser, false);
});

// ---------------------------------------------------------------------------
// Decision shape invariants
// ---------------------------------------------------------------------------

test("planner decision never sets replanner or diagnoser flags", () => {
  const decision = decideEscalation(plannerInput({ goalCategory: "ambiguous" }));
  assert.equal(decision.useRuleReplanner, false);
  assert.equal(decision.useLLMReplanner, false);
  assert.equal(decision.useRuleDiagnoser, false);
  assert.equal(decision.useLLMDiagnoser, false);
});

test("replanner decision never sets planner or diagnoser flags", () => {
  const decision = decideEscalation(replannerInput({ currentFailureType: "selector_mismatch" }));
  assert.equal(decision.useRulePlanner, false);
  assert.equal(decision.useLLMPlanner, false);
  assert.equal(decision.useRuleDiagnoser, false);
  assert.equal(decision.useLLMDiagnoser, false);
});

test("diagnoser decision never sets planner or replanner flags", () => {
  const decision = decideEscalation(diagnoserInput({ policyMode: "aggressive" }));
  assert.equal(decision.useRulePlanner, false);
  assert.equal(decision.useLLMPlanner, false);
  assert.equal(decision.useRuleReplanner, false);
  assert.equal(decision.useLLMReplanner, false);
});

test("rationale array is always non-empty", () => {
  for (const input of [plannerInput(), replannerInput(), diagnoserInput()]) {
    const decision = decideEscalation(input);
    assert.ok(decision.rationale.length > 0, "rationale must not be empty");
  }
});
