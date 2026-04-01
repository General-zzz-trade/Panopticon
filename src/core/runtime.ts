import { closeBrowserSession } from "../browser";
import { decideEscalation } from "../escalation-policy";
import { executeTask } from "../executor";
import { findFailurePatterns, loadRecentRuns, saveRun } from "../memory";
import { calculateRunMetrics } from "../metrics";
import { resolvePolicy } from "../policy";
import { PlannerMode, planTasks } from "../planner";
import { replanTasks } from "../planner/replanner";
import { reflectOnRun, saveReflectionToFile } from "../reflector";
import { stopApp } from "../shell";
import { createUsageLedger, finalizeUsageLedger, recordDiagnoserCall, recordPlannerFallback, recordPlannerTimeout, recordRulePlannerAttempt } from "../usage-ledger";
import { AgentPolicy, AgentTask, PlannerTieBreakerPolicy, RunContext, RunLimits, TerminationReason } from "../types";

export interface RunOptions {
  maxReplansPerRun?: number;
  maxReplansPerTask?: number;
  plannerMode?: PlannerMode;
  maxLLMPlannerCalls?: number;
  maxLLMReplannerCalls?: number;
  maxLLMReplannerTimeouts?: number;
  tieBreakerPolicy?: Partial<PlannerTieBreakerPolicy>;
  policy?: Partial<AgentPolicy>;
}

export async function runGoal(goal: string, options: RunOptions = {}): Promise<RunContext> {
  const limits: RunLimits = {
    maxReplansPerRun: options.maxReplansPerRun ?? 3,
    maxReplansPerTask: options.maxReplansPerTask ?? 1
  };
  const runId = createRunId();
  const policy = resolvePolicy(options.policy);
  const tieBreakerPolicy: PlannerTieBreakerPolicy = {
    preferStablePlannerOnTie: options.tieBreakerPolicy?.preferStablePlannerOnTie ?? true,
    preferRulePlannerOnTie: options.tieBreakerPolicy?.preferRulePlannerOnTie ?? true,
    preferLowerTaskCountOnTie: options.tieBreakerPolicy?.preferLowerTaskCountOnTie ?? true
  };
  const usageLedger = createUsageLedger();
  usageLedger.rulePlannerAttempts += 1;
  const planResult = await planTasks(goal, {
    runId,
    mode: options.plannerMode ?? "auto",
    maxLLMPlannerCalls: options.maxLLMPlannerCalls ?? 1,
    tieBreakerPolicy,
    policy
  });

  const context: RunContext = {
    runId,
    plannerUsed: planResult.plannerUsed,
    plannerDecisionTrace: planResult.decisionTrace,
    plannerTieBreakerPolicy: tieBreakerPolicy,
    policy,
    usageLedger,
    escalationTrace: [
      {
        stage: "planner",
        decision: decideEscalation({
          goalCategory: "ambiguous",
          plannerQuality: planResult.qualitySummary,
          currentFailureType: "none",
          failurePatterns: [],
          usageLedger,
          policyMode: policy.plannerCostMode,
          providerHealth: { plannerHealthy: true, replannerHealthy: true, diagnoserHealthy: Boolean(process.env.LLM_DIAGNOSER_PROVIDER) }
        }),
        llmUsageRationale: planResult.fallbackReason ?? "planner trace recorded",
        fallbackRationale: planResult.fallbackReason ?? "none"
      }
    ],
    goal,
    tasks: planResult.tasks,
    artifacts: [],
    replanCount: 0,
    nextTaskSequence: planResult.tasks.length,
    insertedTaskCount: 0,
    llmReplannerInvocations: 0,
    llmReplannerTimeoutCount: 0,
    llmReplannerFallbackCount: 0,
    limits,
    startedAt: new Date().toISOString()
  };
  recordRulePlannerAttempt(context);
  const usageLedgerRef = context.usageLedger!;
  usageLedgerRef.llmPlannerCalls = planResult.decisionTrace.llmInvocations;
  usageLedgerRef.plannerTimeouts = planResult.decisionTrace.timeoutCount;
  if (planResult.decisionTrace.fallbackReason) {
    recordPlannerFallback(context);
  }

  const summaries: string[] = [];
  let index = 0;

  try {
    validateGoal(goal, context.tasks);

    while (index < context.tasks.length) {
      const task = context.tasks[index];

      try {
        const output = await executeTask(context, task);
        summaries.push(output.summary);

        if (output.artifacts) {
          context.artifacts.push(...output.artifacts);
        }

        index += 1;
      } catch (error) {
        const message = getErrorMessage(error);
        const recentRuns = await loadRecentRuns(5);
        const failurePatterns = await findFailurePatterns();
        const decision = await replanTasks({
          context,
          task,
          error: message,
          recentRuns,
          failurePatterns,
          maxLLMReplannerCalls: options.maxLLMReplannerCalls ?? 1,
          maxLLMReplannerTimeouts: options.maxLLMReplannerTimeouts ?? 1
        });

        summaries.push(`Observed failure in ${task.id}: ${message}`);
        summaries.push(`Replan decision: ${decision.reason}`);

        if (decision.abort && decision.reason.includes("budget exceeded")) {
          throw new Error(decision.reason);
        }

        if (decision.replaceWith.length > 0) {
          context.replanCount += 1;
          context.tasks.splice(index, 1, ...decision.replaceWith);
          continue;
        }

        if (decision.insertTasks.length > 0) {
          context.replanCount += 1;
          context.insertedTaskCount += decision.insertTasks.length;
          context.tasks.splice(index + 1, 0, ...decision.insertTasks);
        }

        if (decision.abort) {
          throw error;
        }

        index += 1;
      }
    }

    context.result = {
      success: true,
      message: `Goal: ${goal}\n${summaries.join("\n")}`
    };
    context.terminationReason = "success";
  } catch (error) {
    const message = getErrorMessage(error);
    context.result = {
      success: false,
      message: `Task failed: ${message}`,
      error: message
    };
    context.terminationReason = determineTerminationReason(message);
  } finally {
    context.endedAt = new Date().toISOString();
    await closeBrowserSession(context.browserSession);
    await stopApp(context.appProcess);
    context.browserSession = undefined;
    context.appProcess = undefined;

    context.metrics = calculateRunMetrics(context);
    const diagnoserEscalation = decideEscalation({
      goalCategory: "ambiguous",
      plannerQuality: context.plannerDecisionTrace?.qualitySummary,
      currentFailureType: context.result?.success ? "none" : "unknown",
      failurePatterns: [],
      usageLedger: context.usageLedger ?? createUsageLedger(),
      policyMode: context.policy?.plannerCostMode ?? "balanced",
      providerHealth: { plannerHealthy: true, replannerHealthy: true, diagnoserHealthy: Boolean(process.env.LLM_DIAGNOSER_PROVIDER) }
    });
    context.escalationTrace = [...(context.escalationTrace ?? []), { stage: "diagnoser", decision: diagnoserEscalation, llmUsageRationale: diagnoserEscalation.llmUsageRationale, fallbackRationale: diagnoserEscalation.fallbackRationale }];
    if (process.env.LLM_DIAGNOSER_PROVIDER && diagnoserEscalation.useDiagnoser) {
      recordDiagnoserCall(context);
    }
    context.reflection = await reflectOnRun(context);
    finalizeUsageLedger(context);
    await saveReflectionToFile(context.reflection);
    await saveRun(context);
  }

  return context;
}

function validateGoal(goal: string, tasks: AgentTask[]): void {
  if (!goal.trim()) {
    throw new Error("Goal is required.");
  }

  if (tasks.length === 0) {
    throw new Error("No executable tasks were planned from the goal.");
  }
}

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${randomPart}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function determineTerminationReason(message: string): TerminationReason {
  if (message.includes("Replan budget exceeded for run")) {
    return "replan_budget_exceeded";
  }

  if (message.includes("Replan budget exceeded for task")) {
    return "task_replan_budget_exceeded";
  }

  if (/timeout|timed out|did not become available/i.test(message)) {
    return "timeout";
  }

  if (message === "Unknown error") {
    return "unknown";
  }

  return "task_failure";
}
