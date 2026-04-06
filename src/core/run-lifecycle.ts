/**
 * Run Lifecycle — initialization, finalization, persistence, and reflection.
 * Extracted from runtime.ts to isolate setup/teardown concerns.
 */

import { closeBrowserSession } from "../browser";
import { attachWorldStateRunId, createInitialWorldState } from "../cognition/state-store";
import { EpisodeEvent, VerificationResult } from "../cognition/types";
import { extractKnowledgeFromRun } from "../knowledge/extractor";
import { findFailurePatterns, loadRecentRuns, saveRun } from "../memory";
import { calculateRunMetrics } from "../observability/run-metrics";
import { resolvePolicy } from "./policy";
import { PlannerMode, planTasks, PlanTasksResult } from "../planner";
import { reflectOnRun, saveReflectionToFile } from "./reflector";
import { stopApp } from "../shell";
import { createUsageLedger, finalizeUsageLedger } from "../observability/usage-ledger";
import { AgentPolicy, AgentTask, PlannerTieBreakerPolicy, RunContext, RunLimits, TerminationReason } from "../types";
import { publishEvent, closeEmitter } from "../streaming/event-bus";
import { createOnlineAdapterState, type OnlineAdapterState } from "../learning/online-adapter";
import { initEpisodesTable } from "../memory/episode-store";
import { findSimilarEpisodes, formatEpisodesAsContext } from "../memory/semantic-search";
import type { CausalGraph } from "../world-model/causal-graph";
import { getOrCreateCausalGraph, setActiveCausalGraph } from "../world-model/causal-graph-registry";
import { restoreAllLearning, persistAllLearning } from "../learning/persistence";
import { createTokenBudget, type TokenBudget } from "../observability/token-budget";
import { generateEpisodeSummary, extractDomainFromRun } from "../memory/episode-generator";
import { computeEmbedding } from "../memory/embedding";
import { saveEpisode } from "../memory/episode-store";
import { extractCausalTransitions } from "../world-model/extractor";
import { recordPlannerOutcome } from "../planner/thompson-sampling";
import { updateWeights, computeAdaptiveMultiplier } from "../learning/weight-optimizer";
import { runReflection } from "../learning/reflection-loop";
import { applyInsights } from "../learning/strategy-updater";
import { logModuleError, tryCritical, tryOptional, tryCriticalAsync, tryOptionalAsync } from "./module-logger";
import { parseGoalSync } from "../goal/parser";
import { resolveIntent } from "../goal/intent-resolver";
import type { Goal } from "../goal/types";
import { buildStrategicContext, formatStrategicContextForPrompt } from "../learning/strategic/learning-bridge";
import { recordRunStart, recordRunEnd } from "../observability/heartbeat";
import { createWorkingMemory, type WorkingMemory } from "../cognition/working-memory";
import { restoreWorkingMemory, clearWorkingMemory } from "../cognition/working-memory-persistence";
import { createReasoningTrace, type ReasoningTrace } from "../cognition/reasoning-trace";
import type { RunOptions } from "./runtime";

export interface RuntimeState {
  context: RunContext;
  onlineAdapter: OnlineAdapterState;
  causalGraph: CausalGraph;
  stateEmbeddingHistory: number[][];
  consecutiveLoopDetections: number;
  tokenBudget: TokenBudget;
  workingMemory: WorkingMemory;
  reasoningTrace: ReasoningTrace;
  summaries: string[];
  index: number;
}

/**
 * Initialize all runtime state: limits, policies, ledgers, planning, context.
 */
export async function initializeRun(goal: string, options: RunOptions): Promise<RuntimeState> {
  const limits: RunLimits = {
    maxReplansPerRun: options.maxReplansPerRun ?? 3,
    maxReplansPerTask: options.maxReplansPerTask ?? 1
  };
  const runId = options.runId ?? createRunId();
  const policy = resolvePolicy(options.policy);
  const tieBreakerPolicy: PlannerTieBreakerPolicy = {
    preferStablePlannerOnTie: options.tieBreakerPolicy?.preferStablePlannerOnTie ?? true,
    preferRulePlannerOnTie: options.tieBreakerPolicy?.preferRulePlannerOnTie ?? true,
    preferLowerTaskCountOnTie: options.tieBreakerPolicy?.preferLowerTaskCountOnTie ?? true
  };
  const usageLedger = createUsageLedger();
  const onlineAdapter = createOnlineAdapterState();
  const causalGraph = getOrCreateCausalGraph();
  tryCritical("learning", () => restoreAllLearning(), "restoring learned state on startup");
  const tokenBudget = createTokenBudget();

  // Parse goal into structured form with success criteria
  const parsedGoal = parseGoalSync(goal);

  // Intent resolution: enrich criteria from knowledge store patterns
  const domain = goal.match(/https?:\/\/([^\/\s"]+)/)?.[1]?.replace(/^www\./, "");
  tryOptional("intent-resolver", () => {
    const resolved = resolveIntent(goal, domain);
    if (resolved.inferredCriteria.length > 0) {
      // Merge inferred criteria (don't duplicate existing)
      const existingValues = new Set(parsedGoal.successCriteria.map(c => c.value));
      for (const c of resolved.inferredCriteria) {
        if (!existingValues.has(c.value)) {
          parsedGoal.successCriteria.push(c);
        }
      }
    }
  }, "resolving intent");

  const episodeContext = await loadEpisodeContext(goal);

  // Strategic context: domain strategy + skill composition
  let strategicContextStr = "";
  tryOptional("strategic-context", () => {
    const strategicCtx = buildStrategicContext(goal, domain);
    strategicContextStr = formatStrategicContextForPrompt(strategicCtx);
  }, "building strategic context");
  const enrichedContext = [episodeContext, strategicContextStr].filter(Boolean).join("\n\n");

  publishEvent({
    type: "planning",
    runId,
    timestamp: new Date().toISOString(),
    summary: "Planning tasks",
    message: goal
  });

  const planResult = await planTasks(goal, {
    runId,
    mode: options.plannerMode ?? "auto",
    maxLLMPlannerCalls: options.maxLLMPlannerCalls ?? 1,
    tieBreakerPolicy,
    policy,
    usageLedger,
    episodeContext: enrichedContext
  });

  publishEvent({
    type: "planning",
    runId,
    timestamp: new Date().toISOString(),
    summary: `Planned ${planResult.tasks.length} task${planResult.tasks.length !== 1 ? "s" : ""} via ${planResult.plannerUsed}`,
    payload: {
      planner: planResult.plannerUsed,
      taskCount: planResult.tasks.length,
      tasks: planResult.tasks.map(t => ({ id: t.id, type: t.type }))
    }
  });

  const initialWorldState = options.worldState
    ? attachWorldStateRunId(options.worldState, runId)
    : attachWorldStateRunId(createInitialWorldState(goal), runId);

  const context: RunContext = {
    runId,
    tenantId: options.tenantId ?? "default",
    plannerUsed: planResult.plannerUsed,
    plannerDecisionTrace: planResult.decisionTrace,
    plannerTieBreakerPolicy: tieBreakerPolicy,
    policy,
    usageLedger,
    escalationDecisions: [planResult.decisionTrace.escalationDecision],
    goal,
    tasks: planResult.tasks,
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: planResult.tasks.length,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    browserSession: options.browserSession,
    worldState: initialWorldState,
    worldStateHistory: [],
    observations: [],
    hypotheses: [],
    experimentResults: [],
    beliefUpdates: [],
    episodeEvents: [],
    verificationResults: [],
    cognitiveDecisions: [],
    limits,
    startedAt: new Date().toISOString()
  };

  // Attach parsed goal for criteria-based verification
  (context as RunContext & { parsedGoal?: Goal }).parsedGoal = parsedGoal;

  // Heartbeat: record run start
  recordRunStart(context.runId, goal);

  return {
    context,
    onlineAdapter,
    causalGraph,
    stateEmbeddingHistory: [],
    consecutiveLoopDetections: 0,
    tokenBudget,
    workingMemory: restoreWorkingMemory(context.runId) ?? createWorkingMemory(goal),
    reasoningTrace: createReasoningTrace(context.runId),
    summaries: [],
    index: 0
  };
}

/**
 * Load episode context for enriching LLM planner prompts.
 */
async function loadEpisodeContext(goal: string): Promise<string> {
  try {
    initEpisodesTable();
    const { buildInjectedContext, formatContextForPrompt } = await import("../memory/context-injector");
    const domain = goal.match(/https?:\/\/([^\/\s"]+)/)?.[1]?.replace(/^www\./, "");
    const injected = await buildInjectedContext(goal, domain);
    return formatContextForPrompt(injected);
  } catch (err) {
    logModuleError("context-injector", "optional", err, "rich context injection failed, trying basic");
    try {
      const similarEpisodes = await findSimilarEpisodes(goal, 3);
      return formatEpisodesAsContext(similarEpisodes);
    } catch (err2) {
      logModuleError("episode-search", "optional", err2, "basic episode retrieval failed");
      return "";
    }
  }
}

/**
 * Finalize a run: cleanup resources, persist results, record metrics.
 */
export async function finalizeRun(
  state: RuntimeState,
  options: RunOptions
): Promise<void> {
  const { context, causalGraph } = state;

  tryCritical("learning", () => persistAllLearning(), "persisting learned state");
  context.endedAt = new Date().toISOString();

  const { clearApprovals } = await import("../approval/gate");
  clearApprovals(context.runId);

  const { clearCancel } = await import("../api/run-control");
  clearCancel(context.runId);

  await context.screencastSession?.stop();
  context.screencastSession = undefined;

  if (options.keepBrowserAlive) {
    // Conversation mode: keep browser and app alive for next turn
  } else {
    await closeBrowserSession(context.browserSession);
    await stopApp(context.appProcess);
    context.browserSession = undefined;
    context.appProcess = undefined;
  }

  context.metrics = calculateRunMetrics(context);
  context.reflection = await reflectOnRun(context);
  finalizeUsageLedger(context);
  extractKnowledgeFromRun(context);

  // Thompson Sampling — record planner outcome
  tryOptional("thompson-sampling", () => {
    const goalCategory = "general";
    const success = context.result?.success ?? false;
    recordPlannerOutcome(context.plannerUsed ?? "template", goalCategory, success, context.usageLedger?.totalInputTokens ?? 0);
  }, "recording planner outcome");

  // Weight optimizer — update adaptive meta-cognition weights
  tryOptional("weight-optimizer", () => {
    const avgFamiliarity = 0.5;
    const failedTasks = context.tasks.filter(t => t.status === "failed").length;
    const selectorRisk = context.tasks.length > 0 ? failedTasks / context.tasks.length : 0;
    const stuckLevel = context.limits.maxReplansPerRun > 0 ? context.replanCount / context.limits.maxReplansPerRun : 0;
    const actualOutcome = context.result?.success ? 1.0 : 0.0;
    const predictedConfidence = computeAdaptiveMultiplier(avgFamiliarity, selectorRisk, stuckLevel);
    updateWeights(predictedConfidence, actualOutcome, { domainFamiliarity: avgFamiliarity, selectorRisk, stuckLevel });
  }, "updating adaptive weights");

  // Reflection loop — analyze failure patterns and evolve strategies
  tryOptional("reflection", () => {
    const reflectionInsight = runReflection();
    if (reflectionInsight.recommendations.length > 0) {
      const applied = applyInsights(reflectionInsight);
      appendEpisodeEvent(context, {
        kind: "observe",
        summary: `Reflection: ${reflectionInsight.recommendations.length} recommendations, ${applied} strategies updated`,
        metadata: {
          recommendations: reflectionInsight.recommendations.length,
          strategiesApplied: applied,
          dominantStrategies: reflectionInsight.dominantRecoveryStrategies.length
        }
      });
    }
  }, "running reflection loop");

  // Prompt evolution — mutate worst-performing prompts
  await tryOptionalAsync("prompt-evolver", async () => {
    const { mutatePrompt } = await import("../learning/prompt-evolver");
    await mutatePrompt("planner");
    await mutatePrompt("replanner");
  }, "evolving prompts");

  // Causal graph — extract state transitions and register for persistence
  tryOptional("causal-graph", () => {
    extractCausalTransitions(context, causalGraph);
    setActiveCausalGraph(causalGraph);
    // Also write JSON file for backward compatibility
    const { saveCausalGraph } = require("../world-model/persistence");
    saveCausalGraph(causalGraph);
  }, "persisting causal graph");

  await saveReflectionToFile(context.reflection);
  await saveRun(context);

  // Episode store — save semantic memory
  await tryOptionalAsync("episode-store", async () => {
    const summary = generateEpisodeSummary(context);
    const domain = extractDomainFromRun(context);
    const embedding = await computeEmbedding(summary);
    saveEpisode({
      runId: context.runId,
      goal: context.goal,
      domain,
      summary,
      outcome: context.result?.success ? "success" : "failure",
      taskCount: context.tasks.length,
      replanCount: context.replanCount,
      embedding
    });
  }, "saving episode");

  // Memory maintenance — prune old episodes and low-confidence knowledge
  await tryOptionalAsync("memory-maintenance", async () => {
    const { pruneEpisodes } = await import("../memory/episode-store");
    const { pruneKnowledge, enforceKnowledgeCapacity } = await import("../knowledge/store");
    const episodePruned = pruneEpisodes(90, 500);
    const knowledgePruned = pruneKnowledge(0.2, 60);
    const capacityPruned = enforceKnowledgeCapacity(200);
    if (episodePruned + knowledgePruned + capacityPruned > 0) {
      appendEpisodeEvent(context, {
        kind: "observe",
        summary: `Memory maintenance: pruned ${episodePruned} episodes, ${knowledgePruned + capacityPruned} knowledge entries`,
        metadata: { episodePruned, knowledgePruned, capacityPruned }
      });
    }
  }, "pruning memory");

  // Strategic learning: record outcome for cross-run analysis
  tryOptional("strategic-learning", () => {
    const { recordOutcome } = require("../learning/strategic/outcome-analyzer");
    const { recordRunOutcome: recordSelfOutcome } = require("../world-model/self-model");
    const domain = extractDomainFromRun(context);
    const failedTaskTypes = context.tasks.filter(t => t.status === "failed").map(t => t.type);
    const recoveryStrategies = (context.hypotheses ?? []).map(h => h.recoveryHint).filter(Boolean);
    const durationMs = context.endedAt && context.startedAt
      ? new Date(context.endedAt).getTime() - new Date(context.startedAt).getTime()
      : 0;

    recordOutcome({
      runId: context.runId,
      domain,
      goal: context.goal,
      success: context.result?.success ?? false,
      taskCount: context.tasks.length,
      replanCount: context.replanCount,
      failedTaskTypes,
      recoveryStrategiesUsed: recoveryStrategies as string[],
      durationMs,
      timestamp: context.endedAt ?? new Date().toISOString()
    });

    // Self-model: update domain capability profile
    const selfModel = require("../world-model/self-model");
    const model = selfModel.createSelfModel();
    selfModel.recordRunOutcome(
      model, domain, context.result?.success ?? false,
      context.tasks.length, context.replanCount, failedTaskTypes
    );
  }, "recording strategic outcome");

  // Store reasoning trace for explainability API
  try {
    const { storeReasoningTrace } = require("../api/routes/explain");
    storeReasoningTrace(context.runId, state.reasoningTrace);
  } catch { /* explain route may not be loaded */ }

  // Heartbeat: record run end
  recordRunEnd(context.runId, context.result?.success ?? false);

  // Clear working memory for completed runs (keep only if run failed, for resume)
  if (context.result?.success) {
    clearWorkingMemory(context.runId);
  }

  publishEvent({
    type: "run_complete",
    runId: context.runId,
    timestamp: new Date().toISOString(),
    success: context.result?.success ?? false,
    message: context.result?.message ?? ""
  });
  closeEmitter(context.runId);
}

// ── Shared helpers used across split modules ──────────────────────────────

export function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${randomPart}`;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function determineTerminationReason(message: string): TerminationReason {
  if (/cancelled by user/i.test(message)) return "cancelled";
  if (message.includes("Replan budget exceeded for run")) return "replan_budget_exceeded";
  if (message.includes("Replan budget exceeded for task")) return "task_replan_budget_exceeded";
  if (/timeout|timed out|did not become available/i.test(message)) return "timeout";
  if (message === "Unknown error") return "unknown";
  return "task_failure";
}

export function validateGoal(goal: string, tasks: RunContext["tasks"]): void {
  if (!goal.trim()) throw new Error("Goal is required.");
  if (tasks.length === 0) throw new Error("No executable tasks were planned from the goal.");
}

export function appendEpisodeEvent(
  context: RunContext,
  input: Omit<EpisodeEvent, "id" | "runId" | "timestamp">
): void {
  context.episodeEvents ??= [];
  context.episodeEvents.push({
    id: `evt-${context.runId}-${context.episodeEvents.length + 1}`,
    runId: context.runId,
    timestamp: new Date().toISOString(),
    ...input
  });
}

export function recordWorldState(
  context: RunContext,
  state: NonNullable<RunContext["worldState"]>,
  source: NonNullable<NonNullable<RunContext["worldState"]>["source"]>,
  reason: string
): void {
  const snapshot = { ...state, source, reason };
  context.worldState = snapshot;
  context.worldStateHistory ??= [];
  context.worldStateHistory.push(snapshot);
}

export function recordVerification(context: RunContext, verification: VerificationResult): void {
  context.verificationResults ??= [];
  context.verificationResults.push(verification);
  appendEpisodeEvent(context, {
    taskId: verification.taskId,
    kind: "verify",
    summary: `${verification.verifier} verification ${verification.passed ? "passed" : "failed"}: ${verification.rationale}`,
    verificationPassed: verification.passed,
    metadata: { confidence: verification.confidence }
  });
}

export function recordDecision(
  context: RunContext,
  taskId: string | undefined,
  summary: string,
  decision: { nextAction: string; rationale: string; confidence: number }
): void {
  context.cognitiveDecisions ??= [];
  context.cognitiveDecisions.push(decision as import("../cognition/types").CognitiveDecision);
  appendEpisodeEvent(context, {
    taskId,
    kind: decision.nextAction === "abort" ? "abort" : decision.nextAction === "replan" ? "recover" : "verify",
    summary,
    metadata: { nextAction: decision.nextAction, confidence: decision.confidence }
  });
}

export function createFailureVerification(
  context: RunContext,
  taskId: string,
  message: string
): VerificationResult {
  return {
    runId: context.runId,
    taskId,
    verifier: "state",
    passed: false,
    confidence: 0.95,
    rationale: message,
    evidence: [`taskFailure=${message}`]
  };
}

export function shouldRunGoalVerification(
  task: RunContext["tasks"][number],
  index: number,
  totalTasks: number
): boolean {
  return task.type === "assert_text" || task.type === "screenshot" || task.type === "stop_app" || index === totalTasks - 1;
}
