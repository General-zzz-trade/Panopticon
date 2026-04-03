import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  classifyFailureType,
  classifyGoalCategory,
  createEscalationDecisionTrace,
  decideEscalation
} from "./escalation-policy";
import {
  createDiagnoserFromEnv,
  isLowQualityDiagnoserOutput,
  LLMDiagnoser,
  summarizeRecentRuns,
  validateLLMDiagnoserOutput
} from "../llm/diagnoser";
import { findFailurePatterns, loadRecentRuns } from "../memory";
import { recordDiagnoserTimeout, recordLLMDiagnoserCall } from "../observability/usage-ledger";
import { PlanQualitySummary, ProviderCapabilityHealth, ReflectionResult, RunContext } from "../types";

export interface ReflectOptions {
  diagnoser?: LLMDiagnoser;
}

export async function reflectOnRun(run: RunContext, options: ReflectOptions = {}): Promise<ReflectionResult> {
  const recentRuns = await loadRecentRuns(5);
  const failurePatterns = await findFailurePatterns();
  const completedTasks = run.tasks.filter((task) => task.status === "done").length;
  const summary = run.result?.success
    ? `Executed ${completedTasks} of ${run.tasks.length} planned task(s) successfully for goal: ${run.goal}`
    : `Execution failed for goal: ${run.goal}. Completed ${completedTasks} of ${run.tasks.length} planned task(s).`;

  const diagnosis = buildDiagnosis(run, recentRuns, failurePatterns);
  const improvementSuggestions = buildSuggestions(run, recentRuns, failurePatterns);
  const topRisks = buildTopRisks(run, recentRuns, failurePatterns);
  const diagnoser = options.diagnoser ?? createDiagnoserFromEnv();
  const providerHealth = buildProviderHealth(diagnoser);
  const plannerQuality: PlanQualitySummary["quality"] | "unknown" =
    run.plannerDecisionTrace?.qualitySummary.quality ?? "unknown";
  const escalationInput = {
    stage: "diagnoser" as const,
    goalCategory: classifyGoalCategory(run.goal),
    plannerQuality,
    currentFailureType: run.result?.success
      ? "none"
      : classifyFailureType(run.result?.error ?? run.terminationReason, {
          repeatedFailure: failurePatterns.some((pattern) => pattern.count >= 3)
        }),
    failurePatterns,
    usageLedger: run.usageLedger,
    policyMode: run.policy?.mode ?? "balanced",
    providerHealth
  };
  const escalationDecision = decideEscalation(escalationInput);
  const escalationTrace = createEscalationDecisionTrace({
    ...escalationInput,
    decision: escalationDecision
  });
  run.escalationDecisions.push(escalationTrace);

  if (!escalationDecision.useLLMDiagnoser || !diagnoser) {
    return buildRuleReflection(run, summary, diagnosis, topRisks, improvementSuggestions);
  }

  recordLLMDiagnoserCall(run);

  try {
    const llmDiagnosis = await diagnoser.diagnose({
      goal: run.goal,
      tasks: run.tasks,
      metrics: run.metrics,
      failurePatterns,
      recentRunsSummary: summarizeRecentRuns(recentRuns),
      terminationReason: run.terminationReason
    });

    if (!validateLLMDiagnoserOutput(llmDiagnosis)) {
      escalationTrace.decision.fallbackRationale = "LLM diagnoser returned an invalid schema.";
      return buildRuleReflection(run, summary, diagnosis, topRisks, improvementSuggestions);
    }

    if (isLowQualityDiagnoserOutput(llmDiagnosis)) {
      escalationTrace.decision.fallbackRationale = "LLM diagnoser output was too weak to trust.";
      return buildRuleReflection(run, summary, diagnosis, topRisks, improvementSuggestions);
    }

    return {
      success: run.result?.success ?? false,
      summary,
      diagnosis: `${diagnosis} ${llmDiagnosis.diagnosis}`.trim(),
      topRisks: llmDiagnosis.topRisks,
      suggestedNextImprovements: llmDiagnosis.suggestedNextImprovements,
      improvementSuggestions: [...improvementSuggestions, ...llmDiagnosis.suggestedNextImprovements]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM diagnoser error.";
    if (/timed out/i.test(message)) {
      recordDiagnoserTimeout(run);
    }
    escalationTrace.decision.fallbackRationale = message;
    return buildRuleReflection(run, summary, diagnosis, topRisks, improvementSuggestions);
  }
}

export async function saveReflectionToFile(
  reflection: ReflectionResult,
  outputPath = "artifacts/reflection.json"
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });

  await writeFile(outputPath, JSON.stringify(reflection, null, 2), "utf-8");
}

function buildSuggestions(
  run: RunContext,
  recentRuns: RunContext[],
  failurePatterns: Array<{ taskType: string; count: number }>
): string[] {
  const suggestions: string[] = [];

  if (!run.result?.success) {
    suggestions.push("Check whether the app start command and server URL are correct.");
    suggestions.push("Verify that click selectors match actual elements on the page.");
    suggestions.push("Add a wait or wait_for_server step before clicking, asserting, or taking a screenshot.");
  }

  if (!run.tasks.some((task) => task.type === "wait")) {
    suggestions.push("Consider adding a wait step when interacting with dynamic pages.");
  }

  if (run.tasks.some((task) => task.type === "start_app") && !run.tasks.some((task) => task.type === "wait_for_server")) {
    suggestions.push("Add a wait_for_server step after start_app so the page is only opened when the app is ready.");
  }

  if (run.tasks.some((task) => task.type === "click") && !run.tasks.some((task) => task.type === "screenshot")) {
    suggestions.push("Add a screenshot step after clicks to verify the page state change.");
  }

  if (!run.tasks.some((task) => task.type === "assert_text")) {
    suggestions.push("Add an assert_text step so the run validates UI behavior instead of only performing actions.");
  }

  const failedWithRetries = run.tasks.some((task) => task.status === "failed" && task.retries > 0);
  if (failedWithRetries) {
    suggestions.push("A retried task still failed. Inspect selectors, timing, or server readiness for that step.");
  }

  const repeatedClickFailures = failurePatterns.find((pattern) => pattern.taskType === "click" && pattern.count >= 2);
  if (repeatedClickFailures) {
    suggestions.push("Click has failed repeatedly across recent runs. Re-check selector stability and whether the target element is actually interactable.");
  }

  const repeatedAssertFailures = failurePatterns.find((pattern) => pattern.taskType === "assert_text" && pattern.count >= 2);
  if (repeatedAssertFailures) {
    suggestions.push("assert_text is failing frequently. Add a wait step or assert more stable page text.");
  }

  const repeatedServerTimeouts = recentRuns
    .flatMap((recentRun) => recentRun.tasks)
    .filter((task) => task.type === "wait_for_server" && task.errorHistory?.some((entry) => entry.includes("did not become available")))
    .length;
  if (repeatedServerTimeouts >= 2) {
    suggestions.push("wait_for_server has timed out repeatedly. Verify the startup command, port, and actual service readiness endpoint.");
  }

  if (run.metrics && run.metrics.totalReplans >= run.limits.maxReplansPerRun) {
    suggestions.push("The run hit the replan budget. Increase the budget only after improving task stability.");
  }

  if (run.terminationReason === "task_replan_budget_exceeded") {
    suggestions.push("A single task exhausted its replan budget. Narrow the diagnosis to that task before adding more replans.");
  }

  if (run.terminationReason === "replan_budget_exceeded") {
    suggestions.push("The run exhausted its total replan budget. Reduce repeated unstable branches before increasing the budget.");
  }

  if (run.result?.success && suggestions.length === 0) {
    suggestions.push("The workflow succeeded. Keep selectors and URLs stable to maintain reliability.");
  }

  return suggestions;
}

function buildDiagnosis(
  run: RunContext,
  recentRuns: RunContext[],
  failurePatterns: Array<{ taskType: string; count: number }>
): string {
  const unstablePattern = failurePatterns[0];
  const firstFailedTask = run.tasks.find((task) => task.status === "failed");
  const recentFailureCount = recentRuns.filter((recentRun) => recentRun.result?.success === false).length;
  const metricsSummary = run.metrics
    ? `tasks=${run.metrics.totalTasks}, done=${run.metrics.doneTasks}, failed=${run.metrics.failedTasks}, retries=${run.metrics.totalRetries}, replans=${run.metrics.totalReplans}, avgDuration=${run.metrics.averageTaskDurationMs}ms`
    : "metrics unavailable";

  const unstableTaskType = unstablePattern?.taskType ?? firstFailedTask?.type ?? "none";
  const interruptionPoint = firstFailedTask?.id ?? "none";

  return `Run diagnosis: ${metricsSummary}. termination=${run.terminationReason ?? "unknown"}. Most unstable task type: ${unstableTaskType}. Most common interruption point: ${interruptionPoint}. Recent failed runs: ${recentFailureCount}.`;
}

function buildTopRisks(
  run: RunContext,
  recentRuns: RunContext[],
  failurePatterns: Array<{ taskType: string; count: number }>
): string[] {
  const topRiskTask = failurePatterns[0]?.taskType ?? run.tasks.find((task) => task.status === "failed")?.type ?? "none";
  const recentRunFailures = recentRuns.filter((recentRun) => recentRun.result?.success === false).length;

  return [
    `Termination reason: ${run.terminationReason ?? "unknown"}`,
    `Most unstable task type: ${topRiskTask}`,
    `Recent failed runs observed: ${recentRunFailures}`
  ];
}

function buildProviderHealth(diagnoser: LLMDiagnoser | undefined): {
  planner: ProviderCapabilityHealth;
  replanner: ProviderCapabilityHealth;
  diagnoser: ProviderCapabilityHealth;
} {
  const unavailable = {
    configured: false,
    healthy: false,
    rationale: "Not evaluated in this diagnoser stage."
  };

  return {
    planner: unavailable,
    replanner: unavailable,
    diagnoser: diagnoser
      ? {
          configured: true,
          healthy: true,
          rationale: `Diagnoser provider ${diagnoser.config.provider} is available.`
        }
      : {
          configured: false,
          healthy: false,
          rationale: "Diagnoser provider is not configured."
        }
  };
}

function buildRuleReflection(
  run: RunContext,
  summary: string,
  diagnosis: string,
  topRisks: string[],
  improvementSuggestions: string[]
): ReflectionResult {
  return {
    success: run.result?.success ?? false,
    summary,
    diagnosis,
    topRisks,
    suggestedNextImprovements: improvementSuggestions,
    improvementSuggestions
  };
}
