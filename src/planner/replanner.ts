import {
  classifyFailureType,
  classifyGoalCategory,
  createEscalationDecisionTrace,
  decideEscalation
} from "../escalation-policy";
import { summarizeRecentRuns } from "../llm-diagnoser";
import { createReplannerFromEnv, validateLLMReplannerOutput } from "../llm-replanner";
import { FailurePattern } from "../memory";
import {
  recordLLMReplannerCall,
  recordReplannerFallback,
  recordReplannerTimeout,
  recordRuleReplannerAttempt
} from "../usage-ledger";
import {
  AgentTask,
  EscalationPolicyDecision,
  PlanQualitySummary,
  ProviderCapabilityHealth,
  RunContext
} from "../types";
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
  const provider = createReplannerFromEnv();
  const providerHealth = buildProviderHealth(provider, input.maxLLMReplannerCalls, input.maxLLMReplannerTimeouts, input.context);
  const repeatedTaskFailure = (input.failurePatterns.find((pattern) => pattern.taskType === input.task.type)?.count ?? 0) >= 3;

  if (input.context.replanCount >= input.context.limits.maxReplansPerRun) {
    return abortWithTrace(input, providerHealth, "Replan budget exceeded for run.", "Replan budget exceeded for run.");
  }

  if (input.task.replanDepth >= input.context.limits.maxReplansPerTask) {
    return abortWithTrace(
      input,
      providerHealth,
      `Replan budget exceeded for task ${input.task.id}.`,
      `Replan budget exceeded for task ${input.task.id}.`
    );
  }

  recordRuleReplannerAttempt(input.context);
  const ruleDecision = buildRuleDecision(input);
  const plannerQuality: PlanQualitySummary["quality"] | "unknown" =
    input.context.plannerDecisionTrace?.qualitySummary.quality ?? "unknown";
  const escalationInput = {
    stage: "replanner" as const,
    goalCategory: classifyGoalCategory(input.context.goal),
    plannerQuality,
    currentFailureType: classifyFailureType(input.error, { repeatedFailure: repeatedTaskFailure }),
    failurePatterns: input.failurePatterns,
    usageLedger: input.context.usageLedger,
    policyMode: input.context.policy?.mode ?? "balanced",
    providerHealth
  };
  const escalationDecision = decideEscalation(escalationInput);
  const escalationTrace = createEscalationDecisionTrace({
    ...escalationInput,
    decision: escalationDecision,
    taskId: input.task.id
  });
  input.context.escalationDecisions.push(escalationTrace);

  if (escalationDecision.useLLMReplanner && provider) {
    const llmDecision = await tryLLMReplanner(input, escalationTrace);
    if (llmDecision) {
      return llmDecision;
    }
  }

  if (ruleDecision && escalationDecision.useRuleReplanner) {
    return {
      ...ruleDecision,
      reason: composeReason(ruleDecision.reason, escalationDecision)
    };
  }

  if (escalationDecision.abortEarly) {
    return {
      insertTasks: [],
      replaceWith: [],
      abort: true,
      reason: composeReason("Escalation policy aborted replanning early.", escalationDecision)
    };
  }

  return {
    insertTasks: [],
    replaceWith: [],
    abort: true,
    reason: composeReason(`No safe replan strategy for ${input.task.type}: ${input.error}`, escalationDecision)
  };
}

function buildRuleDecision(input: ReplanInput): ReplanDecision | undefined {
  if (input.task.type === "click") {
    const failureType = classifyFailureType(input.error, { repeatedFailure: false });
    // If selector_mismatch, escalate to visual_click as fallback
    if (failureType === "selector_mismatch" && input.task.payload["selector"]) {
      const selectorStr = String(input.task.payload["selector"]);
      const description = selectorStr.startsWith("#")
        ? `element with id "${selectorStr.slice(1)}"`
        : selectorStr.startsWith(".")
          ? `element with class "${selectorStr.slice(1)}"`
          : `element matching "${selectorStr}"`;
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "visual_click", { description })
        ],
        replaceWith: [],
        abort: false,
        reason: `Rule replanner: click selector failed, falling back to visual_click for "${description}".`
      };
    }
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

  if (input.task.type === "type") {
    return {
      insertTasks: [
        createReplanTask(input.context, input.task, "click", { selector: input.task.payload.selector }),
        createReplanTask(input.context, input.task, "wait", { durationMs: 300 }),
        createReplanTask(input.context, input.task, "type", { ...input.task.payload })
      ],
      replaceWith: [],
      abort: false,
      reason: "Rule replanner: type failed, inserted click+wait to focus element before retrying."
    };
  }

  if (input.task.type === "select") {
    return {
      insertTasks: [
        createReplanTask(input.context, input.task, "wait", { durationMs: 500 }),
        createReplanTask(input.context, input.task, "select", { ...input.task.payload })
      ],
      replaceWith: [],
      abort: false,
      reason: "Rule replanner: select failed, inserted a wait before retrying option selection."
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

async function tryLLMReplanner(
  input: ReplanInput,
  escalationTrace: RunContext["escalationDecisions"][number]
): Promise<ReplanDecision | undefined> {
  const replanner = createReplannerFromEnv();
  if (!replanner) {
    escalationTrace.decision.fallbackRationale = "LLM replanner is unavailable.";
    return undefined;
  }

  input.context.llmReplannerInvocations += 1;
  recordLLMReplannerCall(input.context);

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
      escalationTrace.decision.fallbackRationale = "LLM replanner returned invalid task types.";
      return undefined;
    }

    const insertTasks = materializeReplanTasks(input.context, input.task, blueprints);
    const validation = validateInsertedTasks(input.context, input.task, insertTasks);
    if (!validation.accepted) {
      input.context.llmReplannerFallbackCount += 1;
      recordReplannerFallback(input.context);
      escalationTrace.decision.fallbackRationale = validation.reason;
      return undefined;
    }

    return {
      insertTasks,
      replaceWith: [],
      abort: false,
      reason: composeReason(`LLM replanner: ${validation.reason}`, escalationTrace.decision)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM replanner error.";
    if (/timed out/i.test(message)) {
      input.context.llmReplannerTimeoutCount += 1;
      recordReplannerTimeout(input.context);
    }
    input.context.llmReplannerFallbackCount += 1;
    recordReplannerFallback(input.context);
    escalationTrace.decision.fallbackRationale = message;
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

  const retriesFailingTaskType = insertTasks.some((task) => task.type === sourceTask.type);
  if (!retriesFailingTaskType) {
    return {
      accepted: false,
      reason: `LLM replanner did not include a recovery step for the failing ${sourceTask.type} task.`
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

function buildProviderHealth(
  replanner: ReturnType<typeof createReplannerFromEnv> | undefined,
  maxLLMReplannerCalls: number,
  maxLLMReplannerTimeouts: number,
  context: RunContext
): {
  planner: ProviderCapabilityHealth;
  replanner: ProviderCapabilityHealth;
  diagnoser: ProviderCapabilityHealth;
} {
  const unavailable = {
    configured: false,
    healthy: false,
    rationale: "Not evaluated in this replanner stage."
  };

  return {
    planner: unavailable,
    replanner: buildReplannerCapabilityHealth(replanner, maxLLMReplannerCalls, maxLLMReplannerTimeouts, context),
    diagnoser: unavailable
  };
}

function buildReplannerCapabilityHealth(
  replanner: ReturnType<typeof createReplannerFromEnv> | undefined,
  maxLLMReplannerCalls: number,
  maxLLMReplannerTimeouts: number,
  context: RunContext
): ProviderCapabilityHealth {
  if (!replanner) {
    return {
      configured: false,
      healthy: false,
      rationale: "Replanner provider is not configured."
    };
  }

  if (maxLLMReplannerCalls <= 0) {
    return {
      configured: true,
      healthy: false,
      rationale: "Replanner LLM usage cap is zero."
    };
  }

  if (context.llmReplannerInvocations >= maxLLMReplannerCalls) {
    return {
      configured: true,
      healthy: false,
      rationale: "Replanner LLM call budget is exhausted."
    };
  }

  if (context.llmReplannerTimeoutCount >= maxLLMReplannerTimeouts) {
    return {
      configured: true,
      healthy: false,
      rationale: "Replanner LLM timeout budget is exhausted."
    };
  }

  return {
    configured: true,
    healthy: true,
    rationale: `Replanner provider ${replanner.config.provider} is available.`
  };
}

function abortWithTrace(
  input: ReplanInput,
  providerHealth: {
    planner: ProviderCapabilityHealth;
    replanner: ProviderCapabilityHealth;
    diagnoser: ProviderCapabilityHealth;
  },
  reason: string,
  shortReason: string
): ReplanDecision {
  const decision: EscalationPolicyDecision = {
    useRulePlanner: false,
    useLLMPlanner: false,
    useRuleReplanner: false,
    useLLMReplanner: false,
    useRuleDiagnoser: false,
    useLLMDiagnoser: false,
    fallbackToRules: false,
    abortEarly: true,
    rationale: [reason],
    fallbackRationale: shortReason
  };
  input.context.escalationDecisions.push(
    createEscalationDecisionTrace({
      stage: "replanner",
      taskId: input.task.id,
      goalCategory: classifyGoalCategory(input.context.goal),
      plannerQuality: input.context.plannerDecisionTrace?.qualitySummary.quality ?? "unknown",
      currentFailureType: classifyFailureType(input.error),
      failurePatterns: input.failurePatterns,
      usageLedger: input.context.usageLedger,
      policyMode: input.context.policy?.mode ?? "balanced",
      providerHealth,
      decision
    })
  );

  return {
    insertTasks: [],
    replaceWith: [],
    abort: true,
    reason
  };
}

function composeReason(baseReason: string, decision: EscalationPolicyDecision): string {
  const rationale = decision.useLLMReplanner
    ? decision.llmUsageRationale
    : decision.fallbackRationale ?? decision.rationale.at(-1);

  return rationale ? `${baseReason} Escalation: ${rationale}` : baseReason;
}
