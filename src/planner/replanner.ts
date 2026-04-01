import { decideEscalation, FailureType } from "../escalation-policy";
import { createReplannerFromEnv, validateLLMReplannerOutput } from "../llm-replanner";
import { summarizeRecentRuns } from "../llm-diagnoser";
import { FailurePattern } from "../memory";
import { AgentTask, RunContext } from "../types";
import { recordReplannerCall, recordReplannerFallback, recordReplannerTimeout, recordRuleReplannerAttempt } from "../usage-ledger";
import { evaluateTaskSequenceQuality } from "./quality";
import { createTaskFromBlueprint, TaskBlueprint } from "./task-id";
import { validateTaskShape } from "./validation";

export interface ReplanInput {
  context: RunContext;
  task: AgentTask;
  error: string;
  recentRuns: RunContext[];
  failurePatterns: FailurePattern[];
  maxLLMReplannerCalls: number;
  maxLLMReplannerTimeouts: number;
}

export interface ReplanDecision {
  insertTasks: AgentTask[];
  replaceWith: AgentTask[];
  abort: boolean;
  reason: string;
}

export async function replanTasks(input: ReplanInput): Promise<ReplanDecision> {
  if (input.context.replanCount >= input.context.limits.maxReplansPerRun) {
    return {
      insertTasks: [],
      replaceWith: [],
      abort: true,
      reason: `Replan budget exceeded for run. Limit: ${input.context.limits.maxReplansPerRun}`
    };
  }

  if (input.task.replanDepth >= input.context.limits.maxReplansPerTask) {
    return {
      insertTasks: [],
      replaceWith: [],
      abort: true,
      reason: `Replan budget exceeded for task ${input.task.id}. Limit: ${input.context.limits.maxReplansPerTask}`
    };
  }

  recordRuleReplannerAttempt(input.context);
  const ruleDecision = buildRuleDecision(input);
  const escalation = decideEscalation({
    goalCategory: "ambiguous",
    plannerQuality: input.context.plannerDecisionTrace?.qualitySummary,
    currentFailureType: classifyFailureType(input.error),
    failurePatterns: input.failurePatterns,
    usageLedger: input.context.usageLedger ?? { rulePlannerAttempts: 0, llmPlannerCalls: 0, ruleReplannerAttempts: 0, llmReplannerCalls: 0, llmDiagnoserCalls: 0, plannerCalls: 0, replannerCalls: 0, diagnoserCalls: 0, plannerTimeouts: 0, replannerTimeouts: 0, fallbackCounts: 0, plannerFallbacks: 0, replannerFallbacks: 0, totalLLMInteractions: 0 },
    policyMode: input.context.policy?.replannerCostMode ?? "balanced",
    providerHealth: { plannerHealthy: true, replannerHealthy: Boolean(createReplannerFromEnv()), diagnoserHealthy: true }
  });
  input.context.escalationTrace = [...(input.context.escalationTrace ?? []), { stage: "replanner", decision: escalation, llmUsageRationale: escalation.llmUsageRationale, fallbackRationale: escalation.fallbackRationale }];
  const shouldTryLLM = escalation.useLLMReplanner && shouldUseLLMReplanner(input, ruleDecision);

  if (shouldTryLLM) {
    const llmDecision = await tryLLMReplanner(input);
    if (llmDecision) {
      return llmDecision;
    }
  }

  if (ruleDecision) {
    return ruleDecision;
  }

  return {
    insertTasks: [],
    replaceWith: [],
    abort: true,
    reason: `No safe replan strategy for ${input.task.type}: ${input.error}`
  };
}

function buildRuleDecision(input: ReplanInput): ReplanDecision | undefined {
  if (input.task.type === "click") {
    return {
      insertTasks: [
        createReplanTask(input.context, input.task, "wait", { durationMs: 1000 }),
        createReplanTask(input.context, input.task, "click", { ...input.task.payload })
      ],
      replaceWith: [],
      abort: false,
      reason: "Rule replanner: click failed, inserted a wait and one more click attempt."
    };
  }

  if (input.task.type === "assert_text") {
    return {
      insertTasks: [
        createReplanTask(input.context, input.task, "wait", { durationMs: 1500 }),
        createReplanTask(input.context, input.task, "assert_text", { ...input.task.payload })
      ],
      replaceWith: [],
      abort: false,
      reason: "Rule replanner: assert_text failed, inserted a short wait and a follow-up assertion."
    };
  }

  if (input.task.type === "wait_for_server") {
    const repeatedTimeouts = input.recentRuns
      .flatMap((run) => run.tasks)
      .filter((task) => task.type === "wait_for_server" && task.errorHistory?.some((entry) => entry.includes("did not become available")))
      .length;

    if (repeatedTimeouts >= 2) {
      return {
        insertTasks: [],
        replaceWith: [],
        abort: true,
        reason: "Rule replanner: wait_for_server has timed out repeatedly in recent runs."
      };
    }

    return {
      insertTasks: [
        createReplanTask(
          input.context,
          input.task,
          "wait_for_server",
          {
            ...input.task.payload,
            timeoutMs: Math.max(Number(input.task.payload.timeoutMs ?? 30000) + 5000, 35000)
          }
        )
      ],
      replaceWith: [],
      abort: false,
      reason: "Rule replanner: server wait failed, inserted one longer wait_for_server retry."
    };
  }

  const frequentFailure = input.failurePatterns.find(
    (pattern) => pattern.taskType === input.task.type && pattern.count >= 3
  );

  if (frequentFailure) {
    return {
      insertTasks: [],
      replaceWith: [],
      abort: true,
      reason: `Rule replanner: ${input.task.type} is failing repeatedly across runs.`
    };
  }

  return undefined;
}

function shouldUseLLMReplanner(input: ReplanInput, ruleDecision?: ReplanDecision): boolean {
  if (input.maxLLMReplannerCalls <= 0) {
    return false;
  }

  if (input.context.llmReplannerInvocations >= input.maxLLMReplannerCalls) {
    return false;
  }

  if (input.context.llmReplannerTimeoutCount >= input.maxLLMReplannerTimeouts) {
    return false;
  }

  if (!createReplannerFromEnv()) {
    return false;
  }

  const taskFailures = input.failurePatterns.find((pattern) => pattern.taskType === input.task.type)?.count ?? 0;
  const complexFailure = taskFailures >= 2 || input.task.attempts >= 2 || /selector|visible|not found|timeout/i.test(input.error);
  const simpleFailure = /timeout|visible/i.test(input.error);

  if (!ruleDecision) {
    return true;
  }

  if (!input.context.policy?.allowLLMReplannerForSimpleFailures && simpleFailure && !complexFailure) {
    return false;
  }

  if (input.context.policy?.replannerCostMode === "conservative" && !complexFailure) {
    return false;
  }

  return complexFailure;
}

async function tryLLMReplanner(input: ReplanInput): Promise<ReplanDecision | undefined> {
  const replanner = createReplannerFromEnv();
  if (!replanner) {
    return undefined;
  }

  input.context.llmReplannerInvocations += 1;
  recordReplannerCall(input.context);

  try {
    const blueprints = await replanner.replan({
      goal: input.context.goal,
      currentTask: input.task,
      currentError: input.error,
      recentRunsSummary: summarizeRecentRuns(input.recentRuns),
      failurePatterns: input.failurePatterns,
      currentTaskListSnapshot: input.context.tasks
    });

    if (!validateLLMReplannerOutput(blueprints)) {
      input.context.llmReplannerFallbackCount += 1;
      recordReplannerFallback(input.context);
      return undefined;
    }

    const insertTasks = materializeReplanTasks(input.context, input.task, blueprints);
    const validation = validateInsertedTasks(input.context, input.task, insertTasks);
    if (!validation.accepted) {
      input.context.llmReplannerFallbackCount += 1;
      recordReplannerFallback(input.context);
      return undefined;
    }

    return {
      insertTasks,
      replaceWith: [],
      abort: false,
      reason: `LLM replanner: ${validation.reason}`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM replanner error.";
    if (/timed out/i.test(message)) {
      input.context.llmReplannerTimeoutCount += 1;
      recordReplannerTimeout(input.context);
    }
    input.context.llmReplannerFallbackCount += 1;
    recordReplannerFallback(input.context);
    return undefined;
  }
}

function materializeReplanTasks(context: RunContext, sourceTask: AgentTask, blueprints: TaskBlueprint[]): AgentTask[] {
  return blueprints.map((blueprint) => {
    context.nextTaskSequence += 1;
    return createTaskFromBlueprint(
      context.runId,
      context.nextTaskSequence,
      blueprint,
      sourceTask.replanDepth + 1
    );
  });
}

function validateInsertedTasks(
  context: RunContext,
  sourceTask: AgentTask,
  insertTasks: AgentTask[]
): { accepted: boolean; reason: string } {
  if (insertTasks.length === 0) {
    return {
      accepted: false,
      reason: "LLM replanner returned no tasks."
    };
  }

  const shapeValidation = validateTaskShape(insertTasks);
  if (!shapeValidation.valid) {
    return {
      accepted: false,
      reason: `LLM replanner failed payload validation: ${shapeValidation.issues.join("; ")}`
    };
  }

  const sourceIndex = context.tasks.findIndex((task) => task.id === sourceTask.id);
  const snapshot = [
    ...context.tasks.slice(0, sourceIndex + 1),
    ...insertTasks,
    ...context.tasks.slice(sourceIndex + 1)
  ];
  const quality = evaluateTaskSequenceQuality(context.goal, snapshot);
  if (!quality.complete || quality.quality === "low" || quality.score < 70) {
    return {
      accepted: false,
      reason: `LLM replanner failed quality gate: score=${quality.score}, issues=${quality.issues.join("; ")}`
    };
  }

  return {
    accepted: true,
    reason: `inserted ${insertTasks.length} validated task(s) with quality score ${quality.score}`
  };
}

function createReplanTask(
  context: RunContext,
  sourceTask: AgentTask,
  type: AgentTask["type"],
  payload: AgentTask["payload"]
): AgentTask {
  context.nextTaskSequence += 1;
  return createTaskFromBlueprint(
    context.runId,
    context.nextTaskSequence,
    { type, payload },
    sourceTask.replanDepth + 1
  );
}


function classifyFailureType(error: string): FailureType {
  if (/timeout|timed out|did not become available/i.test(error)) return "timeout";
  if (/selector|not found|not visible/i.test(error)) return "selector_mismatch";
  if (/assert|expected|text/i.test(error)) return "assert_mismatch";
  return "unknown";
}
