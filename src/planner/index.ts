import { decideEscalation, GoalCategory } from "../escalation-policy";
import { createPlannerFromEnv, validateLLMPlannerOutput } from "../llm-planner";
import { summarizeRecentRuns } from "../llm-diagnoser";
import { findFailurePatterns, loadRecentRuns } from "../memory";
import { AgentPolicy, AgentTask, PlanQualitySummary, PlannerDecisionTrace, PlannerTieBreakerPolicy } from "../types";
import { evaluateTaskSequenceQuality } from "./quality";
import { createRegexPlan } from "./regex-planner";
import { matchTemplatePlan } from "./templates";
import { TaskBlueprint } from "./task-id";
import { validateAndMaterializeTasks } from "./validation";

export type PlannerMode = "auto" | "template" | "regex" | "llm";
type ConcretePlanner = "template" | "regex" | "llm";

export interface PlanTasksOptions {
  runId: string;
  mode?: PlannerMode;
  maxLLMPlannerCalls?: number;
  tieBreakerPolicy?: PlannerTieBreakerPolicy;
  policy?: AgentPolicy;
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
}

export async function planTasks(goal: string, options: PlanTasksOptions): Promise<PlanTasksResult> {
  const trimmedGoal = goal.trim();

  if (!trimmedGoal) {
    return emptyPlanResult([], undefined, options.maxLLMPlannerCalls ?? 1);
  }

  const mode = options.mode ?? "auto";
  const llmUsageCap = options.maxLLMPlannerCalls ?? 1;
  const tieBreakerPolicy = options.tieBreakerPolicy ?? {
    preferStablePlannerOnTie: true,
    preferRulePlannerOnTie: true,
    preferLowerTaskCountOnTie: true
  };
  const policy = options.policy ?? {
    plannerCostMode: "balanced",
    replannerCostMode: "balanced",
    preferRuleSystemsOnCheapGoals: true,
    allowLLMReplannerForSimpleFailures: false
  };
  const goalCategory = classifyGoal(trimmedGoal);
  const initialEscalation = decideEscalation({
    goalCategory,
    plannerQuality: undefined,
    currentFailureType: "none",
    failurePatterns: [],
    usageLedger: {
      rulePlannerAttempts: 1, llmPlannerCalls: 0, ruleReplannerAttempts: 0, llmReplannerCalls: 0, llmDiagnoserCalls: 0,
      plannerCalls: 0, replannerCalls: 0, diagnoserCalls: 0, plannerTimeouts: 0, replannerTimeouts: 0, fallbackCounts: 0, plannerFallbacks: 0, replannerFallbacks: 0, totalLLMInteractions: 0
    },
    policyMode: policy.plannerCostMode,
    providerHealth: { plannerHealthy: Boolean(createPlannerFromEnv()), replannerHealthy: true, diagnoserHealthy: true }
  });

  if (mode === "template") {
    return finalizeCandidate(
      buildCandidate("template", trimmedGoal, materializePlan(options.runId, matchTemplatePlan(trimmedGoal))),
      [],
      undefined,
      llmUsageCap,
      0
    );
  }

  if (mode === "regex") {
    return finalizeCandidate(
      buildCandidate("regex", trimmedGoal, materializePlan(options.runId, createRegexPlan(trimmedGoal))),
      [],
      undefined,
      llmUsageCap,
      0
    );
  }

  if (mode === "llm") {
    return await planWithLLMOnly(trimmedGoal, options.runId, llmUsageCap);
  }

  const evaluatedCandidates: PlanCandidate[] = [];
  let fallbackReason: string | undefined;
  let llmInvocations = 0;
  let timeoutCount = 0;

  const templateCandidate = buildCandidate(
    "template",
    trimmedGoal,
    materializePlan(options.runId, matchTemplatePlan(trimmedGoal))
  );
  evaluatedCandidates.push(templateCandidate);

  if (goalCategory === "explicit" && policy.preferRuleSystemsOnCheapGoals && isAcceptable(templateCandidate, "high")) {
    return finalizeCandidate(templateCandidate, evaluatedCandidates, undefined, llmUsageCap, llmInvocations, timeoutCount);
  }

  fallbackReason =
    goalCategory === "explicit"
      ? "Template plan was incomplete or low quality."
      : `Template plan was not trusted for ${goalCategory} goal phrasing.`;

  const regexCandidate = buildCandidate(
    "regex",
    trimmedGoal,
    materializePlan(options.runId, createRegexPlan(trimmedGoal))
  );
  evaluatedCandidates.push(regexCandidate);

  const llmTriggerReason = initialEscalation.useLLMPlanner ? decideLLMTrigger(goalCategory, regexCandidate, policy) : undefined;
  if (!llmTriggerReason && isAcceptable(regexCandidate, "medium")) {
    return finalizeCandidate(regexCandidate, evaluatedCandidates, fallbackReason, llmUsageCap, llmInvocations, timeoutCount);
  }

  fallbackReason = llmTriggerReason
    ? `Triggered LLM planner: ${llmTriggerReason}. ${initialEscalation.llmUsageRationale}`
    : `Regex plan was incomplete or low quality. ${initialEscalation.fallbackRationale}`;

  if (llmUsageCap <= 0) {
    const stableFallback = chooseStableFallback(evaluatedCandidates, tieBreakerPolicy);
    if (stableFallback) {
      return finalizeCandidate(
        stableFallback,
        evaluatedCandidates,
        "LLM planner was eligible but disabled by usage cap; kept the most stable non-LLM plan.",
        llmUsageCap,
        llmInvocations,
        timeoutCount
      );
    }

    return emptyPlanResult(evaluatedCandidates, "LLM planner was eligible but disabled by usage cap.", llmUsageCap);
  }

  const llmPlanner = createPlannerFromEnv();
  if (!llmPlanner) {
    const stableFallback = chooseStableFallback(evaluatedCandidates, tieBreakerPolicy);
    if (stableFallback) {
      return finalizeCandidate(
        stableFallback,
        evaluatedCandidates,
        "LLM planner was eligible but not configured; kept the most stable non-LLM plan.",
        llmUsageCap,
        llmInvocations,
        timeoutCount
      );
    }

    return emptyPlanResult(evaluatedCandidates, "LLM planner was eligible but not configured.", llmUsageCap);
  }

  const [recentRuns, failurePatterns] = await Promise.all([
    loadRecentRuns(5),
    findFailurePatterns()
  ]);

  llmInvocations += 1;

  try {
    const llmBlueprints = await llmPlanner.plan({
      goal: trimmedGoal,
      recentRunsSummary: summarizeRecentRuns(recentRuns),
      failurePatterns
    });

    if (!validateLLMPlannerOutput(llmBlueprints)) {
      evaluatedCandidates.push(
        invalidCandidate("llm", "LLM output failed schema validation.", llmBlueprints.length, llmTriggerReason)
      );
      const stableFallback = chooseStableFallback(evaluatedCandidates, tieBreakerPolicy);
      if (stableFallback) {
        return finalizeCandidate(
          stableFallback,
          evaluatedCandidates,
          "LLM planner returned invalid tasks; kept the more stable fallback plan.",
          llmUsageCap,
          llmInvocations,
          timeoutCount
        );
      }

      return emptyPlanResult(evaluatedCandidates, "LLM planner returned invalid tasks.", llmUsageCap, llmInvocations, timeoutCount);
    }

    const llmCandidate = buildCandidate(
      "llm",
      trimmedGoal,
      materializePlan(options.runId, llmBlueprints),
      llmTriggerReason
    );
    evaluatedCandidates.push(llmCandidate);

    if (!llmCandidate.valid || llmCandidate.qualitySummary.quality === "low") {
      const stableFallback = chooseStableFallback(evaluatedCandidates, tieBreakerPolicy);
      if (stableFallback) {
        return finalizeCandidate(
          stableFallback,
          evaluatedCandidates,
          `LLM plan was low quality; kept the more stable ${stableFallback.planner} plan.`,
          llmUsageCap,
          llmInvocations,
          timeoutCount
        );
      }
    }

    const bestCandidate = chooseBestCandidate(evaluatedCandidates, tieBreakerPolicy);
    if (!bestCandidate) {
      return emptyPlanResult(evaluatedCandidates, "No planner produced a valid plan.", llmUsageCap, llmInvocations, timeoutCount);
    }

    if (bestCandidate.planner === "llm") {
      return finalizeCandidate(llmCandidate, evaluatedCandidates, fallbackReason, llmUsageCap, llmInvocations, timeoutCount);
    }

    return finalizeCandidate(
      bestCandidate,
      evaluatedCandidates,
      `LLM plan was lower quality than ${bestCandidate.planner}; kept the more stable fallback plan.`,
      llmUsageCap,
      llmInvocations,
      timeoutCount
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM planner error.";
    if (/timed out/i.test(message)) {
      timeoutCount += 1;
    }

    evaluatedCandidates.push(invalidCandidate("llm", message, 0, llmTriggerReason, /timed out/i.test(message)));
    const stableFallback = chooseStableFallback(evaluatedCandidates, tieBreakerPolicy);
    if (stableFallback) {
      return finalizeCandidate(
        stableFallback,
        evaluatedCandidates,
        `LLM planner failed (${message}); kept the more stable ${stableFallback.planner} plan.`,
        llmUsageCap,
        llmInvocations,
        timeoutCount
      );
    }

    return emptyPlanResult(evaluatedCandidates, `LLM planner failed: ${message}`, llmUsageCap, llmInvocations, timeoutCount);
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

function isAcceptable(candidate: PlanCandidate, minimumQuality: "high" | "medium"): boolean {
  if (!candidate.valid || !candidate.qualitySummary.complete) {
    return false;
  }

  return minimumQuality === "high"
    ? candidate.qualitySummary.quality === "high"
    : candidate.qualitySummary.quality !== "low";
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
  timeoutCount = 0
): PlanTasksResult {
  const candidateTraces = candidates.map((candidate) => ({
    planner: candidate.planner,
    qualitySummary: candidate.qualitySummary,
    taskCount: candidate.tasks.length,
    valid: candidate.valid,
    triggerReason: candidate.triggerReason,
    timeout: candidate.timeout,
    fallbackReason: candidate.fallbackReason
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
      triggerReason: chosen.triggerReason,
      fallbackReason,
      llmInvocations,
      llmUsageCap,
      timeoutCount
    }
  };
}

async function planWithLLMOnly(goal: string, runId: string, llmUsageCap: number): Promise<PlanTasksResult> {
  if (llmUsageCap <= 0) {
    return emptyPlanResult([], "LLM planner disabled by usage cap.", llmUsageCap);
  }

  const llmPlanner = createPlannerFromEnv();
  if (!llmPlanner) {
    return emptyPlanResult([], "LLM planner is not configured.", llmUsageCap);
  }

  const [recentRuns, failurePatterns] = await Promise.all([
    loadRecentRuns(5),
    findFailurePatterns()
  ]);

  try {
    const llmBlueprints = await llmPlanner.plan({
      goal,
      recentRunsSummary: summarizeRecentRuns(recentRuns),
      failurePatterns
    });

    if (!validateLLMPlannerOutput(llmBlueprints)) {
      return emptyPlanResult(
        [invalidCandidate("llm", "LLM output failed schema validation.", llmBlueprints.length, "Forced llm mode")],
        "LLM planner returned invalid tasks.",
        llmUsageCap,
        1
      );
    }

    const llmCandidate = buildCandidate("llm", goal, materializePlan(runId, llmBlueprints), "Forced llm mode");
    return finalizeCandidate(llmCandidate, [llmCandidate], undefined, llmUsageCap, 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM planner error.";
    return emptyPlanResult(
      [invalidCandidate("llm", message, 0, "Forced llm mode", /timed out/i.test(message))],
      `LLM planner failed: ${message}`,
      llmUsageCap,
      1,
      /timed out/i.test(message) ? 1 : 0
    );
  }
}

function emptyPlanResult(
  candidates: PlanCandidate[],
  fallbackReason?: string,
  llmUsageCap = 1,
  llmInvocations = 0,
  timeoutCount = 0
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
      fallbackReason,
      llmInvocations,
      llmUsageCap,
      timeoutCount
    }
  };
}

function classifyGoal(goal: string): GoalCategory {
  const explicitSignals = [
    /start app/i,
    /wait for server/i,
    /open page/i,
    /assert text/i,
    /\bclick\s+"/i,
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

function decideLLMTrigger(
  goalCategory: GoalCategory,
  regexCandidate: PlanCandidate,
  policy: AgentPolicy
): string | undefined {
  if (policy.plannerCostMode === "aggressive" && goalCategory !== "explicit") {
    return `Goal classified as ${goalCategory}.`;
  }

  if (goalCategory === "ambiguous") {
    return "Goal classified as ambiguous.";
  }

  if (goalCategory === "semi-natural" && policy.plannerCostMode !== "conservative") {
    return "Goal classified as semi-natural.";
  }

  const threshold = policy.plannerCostMode === "conservative" ? 60 : policy.plannerCostMode === "balanced" ? 75 : 85;
  if (regexCandidate.qualitySummary.score < threshold || regexCandidate.qualitySummary.quality === "low") {
    return `Regex quality score ${regexCandidate.qualitySummary.score} is below threshold.`;
  }

  return undefined;
}
