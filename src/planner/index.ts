import {
  classifyFailureType,
  classifyGoalCategory,
  createEscalationDecisionTrace,
  decideEscalation
} from "../core/escalation-policy";
import { createPlannerFromEnv, validateLLMPlannerOutput } from "../llm/planner";
import { summarizeRecentRuns } from "../llm/diagnoser";
import { findFailurePatterns, loadRecentRuns } from "../memory";
import {
  createUsageLedger,
  recordLLMPlannerCall,
  recordPlannerFallback,
  recordPlannerTimeout,
  recordRulePlannerAttempt
} from "../observability/usage-ledger";
import {
  AgentPolicy,
  AgentTask,
  EscalationPolicyDecision,
  GoalCategory,
  PlanQualitySummary,
  PriorAwarePlanningTrace,
  PlannerDecisionTrace,
  PlannerTieBreakerPolicy,
  ProviderCapabilityHealth,
  UsageLedger
} from "../types";
import { evaluateTaskSequenceQuality } from "./quality";
import { createRegexPlan } from "./regex-planner";
import { matchTemplatePlan } from "./templates";
import { TaskBlueprint } from "./task-id";
import { validateAndMaterializeTasks } from "./validation";
import { planFromKnowledge } from "./knowledge-template-planner";
import { applyPlanningPriors } from "./prior-aware-planner";
import { causalDecompose, inferGoalState, inferCurrentState } from "../decomposer/causal-decomposer";
import { createCausalGraph, deserializeGraph, type CausalGraph } from "../world-model/causal-graph";

export type PlannerMode = "auto" | "template" | "regex" | "llm";
type ConcretePlanner = "template" | "regex" | "llm";

export interface PlanTasksOptions {
  runId: string;
  mode?: PlannerMode;
  maxLLMPlannerCalls?: number;
  tieBreakerPolicy?: PlannerTieBreakerPolicy;
  policy?: AgentPolicy;
  usageLedger?: UsageLedger;
}

export interface PlanTasksResult {
  tasks: AgentTask[];
  plannerUsed: Exclude<PlannerMode, "auto"> | "none";
  qualitySummary: PlanQualitySummary;
  fallbackReason?: string;
  decisionTrace: PlannerDecisionTrace;
}

interface PlanCandidate {
  planner: ConcretePlanner;
  tasks: AgentTask[];
  qualitySummary: PlanQualitySummary;
  valid: boolean;
  triggerReason?: string;
  timeout: boolean;
  fallbackReason?: string;
  priorAwarePlanning?: PriorAwarePlanningTrace;
}

export async function planTasks(goal: string, options: PlanTasksOptions): Promise<PlanTasksResult> {
  const trimmedGoal = goal.trim();
  const usageLedger = options.usageLedger ?? createUsageLedger();
  const mode = options.mode ?? "auto";
  const llmUsageCap = options.maxLLMPlannerCalls ?? 1;
  const tieBreakerPolicy = options.tieBreakerPolicy ?? {
    preferStablePlannerOnTie: true,
    preferRulePlannerOnTie: true,
    preferLowerTaskCountOnTie: true
  };
  const policy = options.policy ?? {
    mode: "balanced",
    plannerCostMode: "balanced",
    replannerCostMode: "balanced",
    preferRuleSystemsOnCheapGoals: true,
    allowLLMReplannerForSimpleFailures: false
  };
  const goalCategory = classifyGoalCategory(trimmedGoal);
  const failurePatterns = trimmedGoal ? await findFailurePatterns() : [];

  if (!trimmedGoal) {
    const decision = forcedRuleDecision("template", "Goal was empty; planner aborted before execution.");
    const escalationTrace = createEscalationDecisionTrace({
      stage: "planner",
      goalCategory,
      plannerQuality: "unknown",
      currentFailureType: "unknown",
      failurePatterns,
      usageLedger,
      policyMode: policy.mode,
      providerHealth: buildProviderHealth(undefined, llmUsageCap),
      decision
    });

    return emptyPlanResult([], "Goal was empty.", llmUsageCap, 0, 0, goalCategory, policy.mode, escalationTrace);
  }

  if (mode === "template") {
    recordRulePlannerAttempt({ usageLedger });
    const candidate = buildRuleCandidate("template", trimmedGoal, options.runId, matchTemplatePlan(trimmedGoal));
    const escalationTrace = createEscalationDecisionTrace({
      stage: "planner",
      goalCategory,
      plannerQuality: candidate.qualitySummary.quality,
      currentFailureType: candidate.valid ? "none" : classifyFailureType(undefined, { lowQuality: true }),
      failurePatterns,
      usageLedger,
      policyMode: policy.mode,
      providerHealth: buildProviderHealth(undefined, llmUsageCap),
      decision: forcedRuleDecision("template", "Planner mode forced to template.")
    });

    return finalizeCandidate(candidate, [candidate], undefined, llmUsageCap, 0, 0, goalCategory, policy.mode, escalationTrace);
  }

  if (mode === "regex") {
    recordRulePlannerAttempt({ usageLedger });
    const candidate = buildRuleCandidate("regex", trimmedGoal, options.runId, createRegexPlan(trimmedGoal));
    const escalationTrace = createEscalationDecisionTrace({
      stage: "planner",
      goalCategory,
      plannerQuality: candidate.qualitySummary.quality,
      currentFailureType: candidate.valid ? "none" : classifyFailureType(undefined, { lowQuality: true }),
      failurePatterns,
      usageLedger,
      policyMode: policy.mode,
      providerHealth: buildProviderHealth(undefined, llmUsageCap),
      decision: forcedRuleDecision("regex", "Planner mode forced to regex.")
    });

    return finalizeCandidate(candidate, [candidate], undefined, llmUsageCap, 0, 0, goalCategory, policy.mode, escalationTrace);
  }

  if (mode === "llm") {
    return await planWithLLMOnly(trimmedGoal, options.runId, llmUsageCap, goalCategory, policy, usageLedger, failurePatterns);
  }

  // Try knowledge-template planner first — learned from past runs
  const knowledgeResult = planFromKnowledge(trimmedGoal);
  if (knowledgeResult.matched && knowledgeResult.confidence >= 0.6 && knowledgeResult.blueprints.length > 0) {
      const knowledgeTasks = materializePlan(options.runId, knowledgeResult.blueprints);
    if (knowledgeTasks.length > 0) {
      const knowledgeCandidate = buildRuleCandidate(
        "template",
        trimmedGoal,
        options.runId,
        knowledgeResult.blueprints,
        `Knowledge template matched (confidence: ${Math.round(knowledgeResult.confidence * 100)}%, pattern: "${knowledgeResult.templatePattern}")`
      );
      if (knowledgeCandidate.valid && knowledgeCandidate.qualitySummary.quality !== "low") {
        const decision = forcedRuleDecision("template", "Knowledge template planner matched with sufficient confidence.");
        const escalationTrace = createEscalationDecisionTrace({
          stage: "planner",
          goalCategory,
          plannerQuality: knowledgeCandidate.qualitySummary.quality,
          currentFailureType: "none",
          failurePatterns,
          usageLedger,
          policyMode: policy.mode,
          providerHealth: buildProviderHealth(undefined, llmUsageCap),
          decision
        });
        return finalizeCandidate(knowledgeCandidate, [knowledgeCandidate], undefined, llmUsageCap, 0, 0, goalCategory, policy.mode, escalationTrace);
      }
    }
  }

  // Try causal decomposer — uses learned causal graph from past runs
  const causalResult = tryCausalPlan(trimmedGoal, options.runId);
  if (causalResult) {
    const decision = forcedRuleDecision("template", "Causal decomposer matched a known path from the causal graph.");
    const escalationTrace = createEscalationDecisionTrace({
      stage: "planner",
      goalCategory,
      plannerQuality: causalResult.qualitySummary.quality,
      currentFailureType: "none",
      failurePatterns,
      usageLedger,
      policyMode: policy.mode,
      providerHealth: buildProviderHealth(undefined, llmUsageCap),
      decision
    });
    return finalizeCandidate(causalResult, [causalResult], undefined, llmUsageCap, 0, 0, goalCategory, policy.mode, escalationTrace);
  }

  const evaluatedCandidates: PlanCandidate[] = [];
  recordRulePlannerAttempt({ usageLedger });
  const templateCandidate = buildRuleCandidate("template", trimmedGoal, options.runId, matchTemplatePlan(trimmedGoal));
  evaluatedCandidates.push(templateCandidate);

  recordRulePlannerAttempt({ usageLedger });
  const regexCandidate = buildRuleCandidate("regex", trimmedGoal, options.runId, createRegexPlan(trimmedGoal));
  evaluatedCandidates.push(regexCandidate);

  const bestRuleCandidate = chooseStableFallback(evaluatedCandidates, tieBreakerPolicy);
  const provider = createPlannerFromEnv();
  const providerHealth = buildProviderHealth(provider, llmUsageCap);
  const plannerQuality: PlanQualitySummary["quality"] | "unknown" = bestRuleCandidate?.qualitySummary.quality ?? "unknown";
  const currentFailureType = bestRuleCandidate && bestRuleCandidate.qualitySummary.quality !== "low"
    ? "none"
    : classifyFailureType(undefined, {
        lowQuality: true,
        providerUnavailable: !providerHealth.planner.configured && !bestRuleCandidate
      });
  const escalationInput = {
    stage: "planner" as const,
    goalCategory,
    plannerQuality,
    currentFailureType,
    failurePatterns,
    usageLedger,
    policyMode: policy.mode,
    providerHealth
  };
  const escalationDecision = decideEscalation(escalationInput);
  const escalationTrace = createEscalationDecisionTrace({
    ...escalationInput,
    decision: escalationDecision
  });

  let llmInvocations = 0;
  let timeoutCount = 0;

  if (!escalationDecision.useLLMPlanner || !provider) {
    const fallbackReason = choosePlannerFallbackReason(bestRuleCandidate, escalationDecision);
    if (fallbackReason) {
      recordPlannerFallback({ usageLedger });
    }

    if (bestRuleCandidate) {
      return finalizeCandidate(
        bestRuleCandidate,
        evaluatedCandidates,
        fallbackReason,
        llmUsageCap,
        llmInvocations,
        timeoutCount,
        goalCategory,
        policy.mode,
        escalationTrace
      );
    }

    return emptyPlanResult(
      evaluatedCandidates,
      fallbackReason ?? "No valid rule planner result was produced.",
      llmUsageCap,
      llmInvocations,
      timeoutCount,
      goalCategory,
      policy.mode,
      escalationTrace
    );
  }

  const [recentRuns] = await Promise.all([loadRecentRuns(5)]);

  llmInvocations += 1;
  recordLLMPlannerCall({ usageLedger });

  try {
    const llmBlueprints = await provider.plan({
      goal: trimmedGoal,
      recentRunsSummary: summarizeRecentRuns(recentRuns),
      failurePatterns
    });

    if (!validateLLMPlannerOutput(llmBlueprints)) {
      evaluatedCandidates.push(
        invalidCandidate("llm", "LLM output failed schema validation.", llmBlueprints.length, escalationDecision.llmUsageRationale)
      );

      const fallbackReason = "LLM planner returned invalid tasks; fell back to the best rule plan.";
      recordPlannerFallback({ usageLedger });
      return finalizePlannerFallback(
        bestRuleCandidate,
        evaluatedCandidates,
        fallbackReason,
        llmUsageCap,
        llmInvocations,
        timeoutCount,
        goalCategory,
        policy.mode,
        escalationTrace
      );
    }

    const llmCandidate = buildCandidate(
      "llm",
      trimmedGoal,
      materializePlan(options.runId, llmBlueprints),
      escalationDecision.llmUsageRationale
    );
    evaluatedCandidates.push(llmCandidate);

    if (!llmCandidate.valid || llmCandidate.qualitySummary.quality === "low") {
      const fallbackReason = "LLM planner returned low-quality tasks; fell back to the best rule plan.";
      recordPlannerFallback({ usageLedger });
      return finalizePlannerFallback(
        bestRuleCandidate,
        evaluatedCandidates,
        fallbackReason,
        llmUsageCap,
        llmInvocations,
        timeoutCount,
        goalCategory,
        policy.mode,
        escalationTrace
      );
    }

    const bestCandidate = chooseBestCandidate(evaluatedCandidates, tieBreakerPolicy);
    if (!bestCandidate) {
      return emptyPlanResult(
        evaluatedCandidates,
        "No planner produced a valid plan.",
        llmUsageCap,
        llmInvocations,
        timeoutCount,
        goalCategory,
        policy.mode,
        escalationTrace
      );
    }

    if (bestCandidate.planner === "llm") {
      return finalizeCandidate(
        llmCandidate,
        evaluatedCandidates,
        undefined,
        llmUsageCap,
        llmInvocations,
        timeoutCount,
        goalCategory,
        policy.mode,
        escalationTrace
      );
    }

    const fallbackReason = `LLM planner produced low-quality output relative to ${bestCandidate.planner}; kept the more stable rule plan.`;
    recordPlannerFallback({ usageLedger });
    return finalizeCandidate(
      bestCandidate,
      evaluatedCandidates,
      fallbackReason,
      llmUsageCap,
      llmInvocations,
      timeoutCount,
      goalCategory,
      policy.mode,
      escalationTrace
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM planner error.";
    const timedOut = /timed out/i.test(message);
    if (timedOut) {
      timeoutCount += 1;
      recordPlannerTimeout({ usageLedger });
    }

    evaluatedCandidates.push(invalidCandidate("llm", message, 0, escalationDecision.llmUsageRationale, timedOut));
    const fallbackReason = `LLM planner failed (${message}); fell back to the best rule plan.`;
    recordPlannerFallback({ usageLedger });
    return finalizePlannerFallback(
      bestRuleCandidate,
      evaluatedCandidates,
      fallbackReason,
      llmUsageCap,
      llmInvocations,
      timeoutCount,
      goalCategory,
      policy.mode,
      escalationTrace
    );
  }
}

function materializePlan(runId: string, blueprints: TaskBlueprint[] | null): AgentTask[] {
  if (!blueprints || blueprints.length === 0) {
    return [];
  }

  return validateAndMaterializeTasks(runId, blueprints) ?? [];
}

function emptyQuality(issue = "No valid plan was produced."): PlanQualitySummary {
  return {
    complete: false,
    score: 0,
    quality: "low",
    issues: [issue]
  };
}

function buildCandidate(
  planner: ConcretePlanner,
  goal: string,
  tasks: AgentTask[],
  triggerReason?: string
): PlanCandidate {
  const qualitySummary = evaluateTaskSequenceQuality(goal, tasks);
  return {
    planner,
    tasks,
    qualitySummary,
    valid: tasks.length > 0 && qualitySummary.issues.length < 8,
    triggerReason,
    timeout: false
  };
}

function buildRuleCandidate(
  planner: "template" | "regex",
  goal: string,
  runId: string,
  blueprints: TaskBlueprint[] | null,
  triggerReason?: string
): PlanCandidate {
  const baseBlueprints = blueprints ?? [];
  const priorAware = applyPlanningPriors(goal, baseBlueprints);
  const originalTasks = materializePlan(runId, baseBlueprints);
  const rewrittenTasks = materializePlan(runId, priorAware.blueprints);
  const combinedTriggerReason = [triggerReason, ...priorAware.notes].filter(Boolean).join(" | ") || undefined;
  const candidate = buildCandidate(planner, goal, rewrittenTasks, combinedTriggerReason);
  const originalQuality = evaluateTaskSequenceQuality(goal, originalTasks);
  candidate.priorAwarePlanning = {
    applied: priorAware.notes.length > 0,
    notes: priorAware.notes,
    matchedPriors: priorAware.matchedPriors,
    originalTaskCount: originalTasks.length,
    rewrittenTaskCount: rewrittenTasks.length,
    qualityDelta: candidate.qualitySummary.score - originalQuality.score
  };
  return candidate;
}

function invalidCandidate(
  planner: ConcretePlanner,
  issue: string,
  taskCount: number,
  triggerReason?: string,
  timeout = false
): PlanCandidate {
  return {
    planner,
    tasks: [],
    valid: false,
    qualitySummary: emptyQuality(issue),
    triggerReason,
    timeout,
    fallbackReason: issue
  };
}

function chooseStableFallback(candidates: PlanCandidate[], tieBreakerPolicy: PlannerTieBreakerPolicy): PlanCandidate | undefined {
  return chooseBestCandidate(candidates.filter((candidate) => candidate.planner !== "llm"), tieBreakerPolicy);
}

function chooseBestCandidate(candidates: PlanCandidate[], tieBreakerPolicy: PlannerTieBreakerPolicy): PlanCandidate | undefined {
  const validCandidates = candidates.filter((candidate) => candidate.valid);
  if (validCandidates.length === 0) {
    return undefined;
  }

  return [...validCandidates].sort((left, right) => compareCandidates(left, right, tieBreakerPolicy))[0];
}

function compareCandidates(
  left: PlanCandidate,
  right: PlanCandidate,
  tieBreakerPolicy: PlannerTieBreakerPolicy
): number {
  if (right.qualitySummary.score !== left.qualitySummary.score) {
    return right.qualitySummary.score - left.qualitySummary.score;
  }

  if (tieBreakerPolicy.preferStablePlannerOnTie) {
    if (left.planner !== "llm" && right.planner === "llm") {
      return -1;
    }

    if (left.planner === "llm" && right.planner !== "llm") {
      return 1;
    }
  }

  if (tieBreakerPolicy.preferRulePlannerOnTie) {
    if (left.planner === "template" && right.planner !== "template") {
      return -1;
    }

    if (right.planner === "template" && left.planner !== "template") {
      return 1;
    }

    if (left.planner === "regex" && right.planner === "llm") {
      return -1;
    }

    if (right.planner === "regex" && left.planner === "llm") {
      return 1;
    }
  }

  if (tieBreakerPolicy.preferLowerTaskCountOnTie) {
    return left.tasks.length - right.tasks.length;
  }

  return left.planner.localeCompare(right.planner);
}

function finalizeCandidate(
  chosen: PlanCandidate,
  candidates: PlanCandidate[],
  fallbackReason: string | undefined,
  llmUsageCap: number,
  llmInvocations: number,
  timeoutCount: number,
  goalCategory: GoalCategory,
  policyMode: AgentPolicy["mode"],
  escalationTrace: PlannerDecisionTrace["escalationDecision"]
): PlanTasksResult {
  const candidateTraces = candidates.map((candidate) => ({
    planner: candidate.planner,
    qualitySummary: candidate.qualitySummary,
    taskCount: candidate.tasks.length,
    valid: candidate.valid,
    triggerReason: candidate.triggerReason,
    timeout: candidate.timeout,
    fallbackReason: candidate.fallbackReason,
    priorAwarePlanning: candidate.priorAwarePlanning
  }));

  return {
    tasks: chosen.tasks,
    plannerUsed: chosen.valid ? chosen.planner : "none",
    qualitySummary: chosen.qualitySummary,
    fallbackReason,
    decisionTrace: {
      candidatePlanners: candidateTraces,
      chosenPlanner: chosen.valid ? chosen.planner : "none",
      qualitySummary: chosen.qualitySummary,
      qualityScore: chosen.qualitySummary.score,
      goalCategory,
      policyMode,
      triggerReason: chosen.triggerReason,
      fallbackReason,
      llmUsageRationale: escalationTrace.decision.llmUsageRationale,
      fallbackRationale: fallbackReason ?? escalationTrace.decision.fallbackRationale,
      escalationDecision: escalationTrace,
      llmInvocations,
      llmUsageCap,
      timeoutCount,
      chosenPriorAwarePlanning: chosen.priorAwarePlanning
    }
  };
}

async function planWithLLMOnly(
  goal: string,
  runId: string,
  llmUsageCap: number,
  goalCategory: GoalCategory,
  policy: AgentPolicy,
  usageLedger: UsageLedger,
  failurePatterns: Awaited<ReturnType<typeof findFailurePatterns>>
): Promise<PlanTasksResult> {
  const provider = createPlannerFromEnv();
  const providerHealth = buildProviderHealth(provider, llmUsageCap);
  const llmAllowed = providerHealth.planner.configured && providerHealth.planner.healthy;
  const decision: EscalationPolicyDecision = {
    useRulePlanner: false,
    useLLMPlanner: llmAllowed,
    useRuleReplanner: false,
    useLLMReplanner: false,
    useRuleDiagnoser: false,
    useLLMDiagnoser: false,
    fallbackToRules: false,
    abortEarly: !llmAllowed,
    rationale: [llmAllowed ? "Planner mode forced to llm." : providerHealth.planner.rationale],
    llmUsageRationale: llmAllowed ? "Planner mode forced to llm." : undefined,
    fallbackRationale: !llmAllowed ? providerHealth.planner.rationale : undefined
  };
  const escalationTrace = createEscalationDecisionTrace({
    stage: "planner",
    goalCategory,
    plannerQuality: "unknown",
    currentFailureType: llmAllowed ? "none" : classifyFailureType(undefined, { providerUnavailable: true }),
    failurePatterns,
    usageLedger,
    policyMode: policy.mode,
    providerHealth,
    decision
  });

  if (!provider || !llmAllowed) {
    return emptyPlanResult([], decision.fallbackRationale ?? "LLM planner is unavailable.", llmUsageCap, 0, 0, goalCategory, policy.mode, escalationTrace);
  }

  const [recentRuns] = await Promise.all([loadRecentRuns(5)]);

  recordLLMPlannerCall({ usageLedger });

  try {
    const llmBlueprints = await provider.plan({
      goal,
      recentRunsSummary: summarizeRecentRuns(recentRuns),
      failurePatterns
    });

    if (!validateLLMPlannerOutput(llmBlueprints)) {
      recordPlannerFallback({ usageLedger });
      return emptyPlanResult(
        [invalidCandidate("llm", "LLM output failed schema validation.", llmBlueprints.length, "Forced llm mode")],
        "LLM planner returned invalid tasks.",
        llmUsageCap,
        1,
        0,
        goalCategory,
        policy.mode,
        escalationTrace
      );
    }

    const llmCandidate = buildCandidate("llm", goal, materializePlan(runId, llmBlueprints), "Forced llm mode");
    if (!llmCandidate.valid || llmCandidate.qualitySummary.quality === "low") {
      recordPlannerFallback({ usageLedger });
      return emptyPlanResult(
        [llmCandidate],
        "LLM planner returned low-quality tasks.",
        llmUsageCap,
        1,
        0,
        goalCategory,
        policy.mode,
        escalationTrace
      );
    }

    return finalizeCandidate(llmCandidate, [llmCandidate], undefined, llmUsageCap, 1, 0, goalCategory, policy.mode, escalationTrace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM planner error.";
    const timedOut = /timed out/i.test(message);
    if (timedOut) {
      recordPlannerTimeout({ usageLedger });
    }
    recordPlannerFallback({ usageLedger });
    return emptyPlanResult(
      [invalidCandidate("llm", message, 0, "Forced llm mode", timedOut)],
      `LLM planner failed: ${message}`,
      llmUsageCap,
      1,
      timedOut ? 1 : 0,
      goalCategory,
      policy.mode,
      escalationTrace
    );
  }
}

function emptyPlanResult(
  candidates: PlanCandidate[],
  fallbackReason: string | undefined,
  llmUsageCap: number,
  llmInvocations: number,
  timeoutCount: number,
  goalCategory: GoalCategory,
  policyMode: AgentPolicy["mode"],
  escalationTrace: PlannerDecisionTrace["escalationDecision"]
): PlanTasksResult {
  const qualitySummary = emptyQuality();
  return {
    tasks: [],
    plannerUsed: "none",
    qualitySummary,
    fallbackReason,
    decisionTrace: {
      candidatePlanners: candidates.map((candidate) => ({
        planner: candidate.planner,
        qualitySummary: candidate.qualitySummary,
        taskCount: candidate.tasks.length,
        valid: candidate.valid,
        triggerReason: candidate.triggerReason,
        timeout: candidate.timeout,
        fallbackReason: candidate.fallbackReason
      })),
      chosenPlanner: "none",
      qualitySummary,
      qualityScore: 0,
      goalCategory,
      policyMode,
      fallbackReason,
      llmUsageRationale: escalationTrace.decision.llmUsageRationale,
      fallbackRationale: fallbackReason ?? escalationTrace.decision.fallbackRationale,
      escalationDecision: escalationTrace,
      llmInvocations,
      llmUsageCap,
      timeoutCount,
      chosenPriorAwarePlanning: undefined
    }
  };
}

function finalizePlannerFallback(
  bestRuleCandidate: PlanCandidate | undefined,
  candidates: PlanCandidate[],
  fallbackReason: string,
  llmUsageCap: number,
  llmInvocations: number,
  timeoutCount: number,
  goalCategory: GoalCategory,
  policyMode: AgentPolicy["mode"],
  escalationTrace: PlannerDecisionTrace["escalationDecision"]
): PlanTasksResult {
  if (!bestRuleCandidate) {
    return emptyPlanResult(candidates, fallbackReason, llmUsageCap, llmInvocations, timeoutCount, goalCategory, policyMode, escalationTrace);
  }

  return finalizeCandidate(
    bestRuleCandidate,
    candidates,
    fallbackReason,
    llmUsageCap,
    llmInvocations,
    timeoutCount,
    goalCategory,
    policyMode,
    escalationTrace
  );
}

function buildProviderHealth(
  provider: ReturnType<typeof createPlannerFromEnv> | undefined,
  llmUsageCap: number
): {
  planner: ProviderCapabilityHealth;
  replanner: ProviderCapabilityHealth;
  diagnoser: ProviderCapabilityHealth;
} {
  const planner = buildPlannerCapabilityHealth(provider, llmUsageCap);
  const unavailable = {
    configured: false,
    healthy: false,
    rationale: "Not evaluated in this planner stage."
  };

  return {
    planner,
    replanner: unavailable,
    diagnoser: unavailable
  };
}

function buildPlannerCapabilityHealth(
  provider: ReturnType<typeof createPlannerFromEnv> | undefined,
  llmUsageCap: number
): ProviderCapabilityHealth {
  if (!provider) {
    return {
      configured: false,
      healthy: false,
      rationale: "Planner provider is not configured."
    };
  }

  if (llmUsageCap <= 0) {
    return {
      configured: true,
      healthy: false,
      rationale: "Planner LLM usage cap is zero."
    };
  }

  return {
    configured: true,
    healthy: true,
    rationale: `Planner provider ${provider.config.provider} is available.`
  };
}

function choosePlannerFallbackReason(
  bestRuleCandidate: PlanCandidate | undefined,
  decision: EscalationPolicyDecision
): string | undefined {
  if (!bestRuleCandidate) {
    return decision.fallbackRationale ?? "No valid rule planner result was produced.";
  }

  if (decision.useLLMPlanner) {
    return undefined;
  }

  return decision.fallbackRationale ?? `Kept the ${bestRuleCandidate.planner} rule plan.`;
}

function tryCausalPlan(
  goal: string,
  runId: string
): PlanCandidate | null {
  try {
    const graph = loadCausalGraph();
    if (!graph || graph.edges.size === 0) return null;

    const goalState = inferGoalState(goal);
    const currentState = inferCurrentState({});  // No observation yet at planning time
    const result = causalDecompose(goal, currentState, goalState, graph);

    if (!result.decomposed || !result.causalPath || result.causalPath.length === 0) {
      return null;
    }

    // Convert causal path to task blueprints
    const blueprints: TaskBlueprint[] = result.causalPath.map((edge, i) => ({
      type: edge.action as TaskBlueprint["type"],
      payload: {
        selector: edge.actionDetail || undefined,
        url: edge.action === "open_page" ? edge.actionDetail : undefined,
        description: `Causal step ${i + 1}: ${edge.action} "${edge.actionDetail}" (confidence: ${edge.confidence.toFixed(2)})`
      }
    }));

    const tasks = validateAndMaterializeTasks(runId, blueprints);
    if (!tasks || tasks.length === 0) return null;

    const qualitySummary = evaluateTaskSequenceQuality(goal, tasks);
    if (qualitySummary.quality === "low") return null;

    return {
      planner: "template",
      tasks,
      qualitySummary,
      valid: true,
      triggerReason: `Causal graph path (${result.causalPath.length} steps, avg confidence: ${(result.causalPath.reduce((sum, e) => sum + e.confidence, 0) / result.causalPath.length).toFixed(2)})`,
      timeout: false
    };
  } catch {
    return null;
  }
}

function loadCausalGraph(): CausalGraph | null {
  try {
    const fs = require("fs");
    const path = require("path");
    const graphPath = path.join(process.cwd(), "artifacts", "causal-graph.json");
    if (!fs.existsSync(graphPath)) return null;
    const json = fs.readFileSync(graphPath, "utf-8");
    return deserializeGraph(json);
  } catch {
    return null;
  }
}

function forcedRuleDecision(planner: "template" | "regex", reason: string): EscalationPolicyDecision {
  return {
    useRulePlanner: true,
    useLLMPlanner: false,
    useRuleReplanner: false,
    useLLMReplanner: false,
    useRuleDiagnoser: false,
    useLLMDiagnoser: false,
    fallbackToRules: true,
    abortEarly: false,
    rationale: [reason],
    fallbackRationale: reason,
    llmUsageRationale: undefined
  };
}
