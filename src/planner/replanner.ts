import {
  classifyFailureType,
  classifyGoalCategory,
  createEscalationDecisionTrace,
  decideEscalation
} from "../core/escalation-policy";
import { summarizeRecentRuns } from "../llm/diagnoser";
import { createReplannerFromEnv, validateLLMReplannerOutput } from "../llm/replanner";
import { FailurePattern } from "../memory";
import {
  recordLLMReplannerCall,
  recordReplannerFallback,
  recordReplannerTimeout,
  recordRuleReplannerAttempt
} from "../observability/usage-ledger";
import {
  AgentTask,
  EscalationPolicyDecision,
  PlanQualitySummary,
  ProviderCapabilityHealth,
  RunContext
} from "../types";
import { retrieveRecoveryPriors } from "../knowledge/store";
import type { FailureLessonEntry } from "../knowledge/types";
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

interface ReplanSignal {
  failureType: ReturnType<typeof classifyFailureType>;
  failureReason: string;
  failedVerification?: NonNullable<RunContext["verificationResults"]>[number];
  topHypothesisKind?: NonNullable<RunContext["hypotheses"]>[number]["kind"];
  topHypothesisConfidence?: number;
  topHypothesisHint?: string;
  topRecoveryPrior?: FailureLessonEntry;
  recoveryDomain?: string;
  worldStateAppState?: RunContext["worldState"] extends infer T
    ? T extends { appState: infer U }
      ? U
      : never
    : never;
  worldStatePageUrl?: string;
  observationAnomalies: string[];
  visibleText: string[];
}

export async function replanTasks(input: ReplanInput): Promise<ReplanDecision> {
  const provider = createReplannerFromEnv();
  const providerHealth = buildProviderHealth(provider, input.maxLLMReplannerCalls, input.maxLLMReplannerTimeouts, input.context);
  const repeatedTaskFailure = (input.failurePatterns.find((pattern) => pattern.taskType === input.task.type)?.count ?? 0) >= 3;
  const signal = deriveReplanSignal(input, repeatedTaskFailure);

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
  const ruleDecision = buildRuleDecision(input, signal);
  const plannerQuality: PlanQualitySummary["quality"] | "unknown" =
    input.context.plannerDecisionTrace?.qualitySummary.quality ?? "unknown";
  const escalationInput = {
    stage: "replanner" as const,
    goalCategory: classifyGoalCategory(input.context.goal),
    plannerQuality,
    currentFailureType: signal.failureType,
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
    const llmDecision = await tryLLMReplanner(input, escalationTrace, signal);
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
    reason: composeReason(`No safe replan strategy for ${input.task.type}: ${signal.failureReason}`, escalationDecision)
  };
}

function buildRuleDecision(input: ReplanInput, signal: ReplanSignal): ReplanDecision | undefined {
  const priorDecision = buildPriorDrivenDecision(input, signal);
  if (priorDecision) {
    return priorDecision;
  }

  if (input.task.type === "click") {
    if (signal.topHypothesisKind === "missing_page_context" && signal.worldStatePageUrl) {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "open_page", { url: signal.worldStatePageUrl }),
          createReplanTask(input.context, input.task, "wait", { durationMs: 500 }),
          createReplanTask(input.context, input.task, "click", { ...input.task.payload })
        ],
        replaceWith: [],
        abort: false,
        reason: "Rule replanner: top hypothesis is missing_page_context, so it reopens the last known page before retrying the click."
      };
    }

    // If selector_mismatch, escalate to visual_click as fallback
    if ((signal.topHypothesisKind === "selector_drift" || signal.failureType === "selector_mismatch") && input.task.payload["selector"]) {
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

    if (signal.worldStatePageUrl && signal.observationAnomalies.some((item) => /no browser page/i.test(item))) {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "open_page", { url: signal.worldStatePageUrl }),
          createReplanTask(input.context, input.task, "wait", { durationMs: 500 }),
          createReplanTask(input.context, input.task, "click", { ...input.task.payload })
        ],
        replaceWith: [],
        abort: false,
        reason: "Rule replanner: click failed without an attached page, reopening the last known page before retrying."
      };
    }

    return {
      insertTasks: [
        createReplanTask(input.context, input.task, "wait", {
          durationMs:
            signal.topHypothesisKind === "state_not_ready" ||
            signal.worldStateAppState === "loading" ||
            signal.failureType === "timeout"
              ? 1500
              : 1000
        }),
        createReplanTask(input.context, input.task, "click", { ...input.task.payload })
      ],
      replaceWith: [],
      abort: false,
      reason: "Rule replanner: click failed, inserted a wait and one more click attempt."
    };
  }

  if (input.task.type === "type") {
    if (signal.topHypothesisKind === "selector_drift" && typeof input.task.payload.text === "string") {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "visual_type", {
            description: describeTarget(input.task.payload.selector),
            text: input.task.payload.text
          })
        ],
        replaceWith: [],
        abort: false,
        reason: "Rule replanner: top hypothesis is selector_drift, so it falls back to visual_type."
      };
    }

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
    if (signal.topHypothesisKind === "state_not_ready") {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "wait", { durationMs: 1000 }),
          createReplanTask(input.context, input.task, "select", { ...input.task.payload })
        ],
        replaceWith: [],
        abort: false,
        reason: "Rule replanner: top hypothesis is state_not_ready, so it waits longer before retrying the selection."
      };
    }

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
    const timeoutMs = Number(input.task.payload.timeoutMs ?? 5000);
    const longerTimeoutMs = Math.max(timeoutMs + 1500, 3000);

    if (signal.topHypothesisKind === "session_not_established") {
      const priorAction = findRecentInteractiveTask(input.context, input.task.id);
      if (priorAction) {
        return {
          insertTasks: [
            createReplanTask(input.context, input.task, "wait", { durationMs: 1000 }),
            createReplanTask(input.context, input.task, priorAction.type, { ...priorAction.payload }),
            createReplanTask(input.context, input.task, "assert_text", {
              ...input.task.payload,
              timeoutMs: longerTimeoutMs
            })
          ],
          replaceWith: [],
          abort: false,
          reason: "Rule replanner: top hypothesis is session_not_established, so it retries the last interactive auth step before asserting again."
        };
      }
    }

    if (signal.topHypothesisKind === "assertion_phrase_changed") {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "screenshot", { outputPath: `artifacts/${input.task.id}-assert-phrase-shift.png` }),
          createReplanTask(input.context, input.task, "assert_text", {
            ...input.task.payload,
            timeoutMs: longerTimeoutMs
          })
        ],
        replaceWith: [],
        abort: false,
        reason: "Rule replanner: top hypothesis is assertion_phrase_changed, so it captures evidence and retries the assertion with a longer timeout."
      };
    }

    if (signal.worldStateAppState === "authenticated" && signal.visibleText.length > 0) {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "screenshot", { outputPath: `artifacts/${input.task.id}-assert-context.png` }),
          createReplanTask(input.context, input.task, "assert_text", {
            ...input.task.payload,
            timeoutMs: longerTimeoutMs
          })
        ],
        replaceWith: [],
        abort: false,
        reason: "Rule replanner: assertion failed after the app appeared authenticated, so a context screenshot and one longer assertion retry were inserted."
      };
    }

    return {
      insertTasks: [
        createReplanTask(input.context, input.task, "wait", { durationMs: 1500 }),
        createReplanTask(input.context, input.task, "assert_text", {
          ...input.task.payload,
          timeoutMs: longerTimeoutMs
        })
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
  escalationTrace: RunContext["escalationDecisions"][number],
  signal: ReplanSignal
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
      currentError: formatLLMRecoveryContext(signal),
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

function deriveReplanSignal(input: ReplanInput, repeatedTaskFailure: boolean): ReplanSignal {
  const failedVerification = [...(input.context.verificationResults ?? [])]
    .reverse()
    .find((verification) => verification.taskId === input.task.id && !verification.passed);
  const topHypothesis = [...(input.context.hypotheses ?? [])]
    .filter((hypothesis) => hypothesis.taskId === input.task.id)
    .sort((left, right) => right.confidence - left.confidence)[0];
  const failureReason = failedVerification?.rationale ?? input.error;
  const failureType = classifyFailureType(failureReason, { repeatedFailure: repeatedTaskFailure });
  const visibleText = input.context.latestObservation?.visibleText ?? [];
  const observationAnomalies = input.context.latestObservation?.anomalies ?? [];
  const recoveryDomain = deriveRecoveryDomain(input.context);
  const topRecoveryPrior = retrieveRecoveryPriors(input.task.type, {
    domain: recoveryDomain,
    hypothesisKind: topHypothesis?.kind,
    limit: 1
  })[0];

  return {
    failureType,
    failureReason,
    failedVerification,
    topHypothesisKind: topHypothesis?.kind,
    topHypothesisConfidence: topHypothesis?.confidence,
    topHypothesisHint: topHypothesis?.recoveryHint,
    topRecoveryPrior,
    recoveryDomain,
    worldStateAppState: input.context.worldState?.appState,
    worldStatePageUrl: input.context.worldState?.pageUrl,
    observationAnomalies,
    visibleText
  };
}

function formatLLMRecoveryContext(signal: ReplanSignal): string {
  const details = [
    `failure=${signal.failureReason}`,
    `failureType=${signal.failureType}`
  ];

  if (signal.topHypothesisKind) {
    details.push(`topHypothesis=${signal.topHypothesisKind}`);
  }

  if (signal.topHypothesisConfidence !== undefined) {
    details.push(`topHypothesisConfidence=${signal.topHypothesisConfidence.toFixed(2)}`);
  }

  if (signal.topHypothesisHint) {
    details.push(`recoveryHint=${signal.topHypothesisHint}`);
  }

  if (signal.topRecoveryPrior) {
    details.push(`recoveryPrior=${signal.topRecoveryPrior.recovery}`);
    if (signal.topRecoveryPrior.hypothesisKind) {
      details.push(`recoveryPriorHypothesis=${signal.topRecoveryPrior.hypothesisKind}`);
    }
    if (signal.topRecoveryPrior.recoverySequence?.length) {
      details.push(`recoveryPriorSteps=${signal.topRecoveryPrior.recoverySequence.join(" -> ")}`);
    }
  }

  if (signal.recoveryDomain) {
    details.push(`recoveryDomain=${signal.recoveryDomain}`);
  }

  if (signal.worldStateAppState) {
    details.push(`appState=${signal.worldStateAppState}`);
  }

  return details.join(" | ");
}

function findRecentInteractiveTask(
  context: RunContext,
  sourceTaskId: string
): AgentTask | undefined {
  const sourceIndex = context.tasks.findIndex((task) => task.id === sourceTaskId);
  if (sourceIndex <= 0) {
    return undefined;
  }

  for (let index = sourceIndex - 1; index >= 0; index -= 1) {
    const candidate = context.tasks[index];
    if (candidate.type === "click" || candidate.type === "type" || candidate.type === "visual_click" || candidate.type === "visual_type") {
      return candidate;
    }
  }

  return undefined;
}

function describeTarget(selector: string | number | boolean | undefined): string {
  if (typeof selector !== "string" || selector.length === 0) {
    return "target element";
  }

  if (selector.startsWith("#")) {
    return `element with id "${selector.slice(1)}"`;
  }

  if (selector.startsWith(".")) {
    return `element with class "${selector.slice(1)}"`;
  }

  return `element matching "${selector}"`;
}

function buildPriorDrivenDecision(input: ReplanInput, signal: ReplanSignal): ReplanDecision | undefined {
  const prior = signal.topRecoveryPrior;
  if (!prior) {
    return undefined;
  }

  const recoverySteps = [prior.recovery, ...(prior.recoverySequence ?? [])]
    .join(" | ")
    .toLowerCase();
  const waitDurationMs = parseWaitDurationMs(recoverySteps);

  if (input.task.type === "click") {
    if (recoverySteps.includes("use visual_click")) {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "visual_click", {
            description: describeTarget(input.task.payload.selector)
          })
        ],
        replaceWith: [],
        abort: false,
        reason: `Rule replanner: procedural prior matched ${describePrior(prior)}, so it reuses visual_click.`
      };
    }

    if ((recoverySteps.includes("reopen") || recoverySteps.includes("open_page")) && signal.worldStatePageUrl) {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "open_page", { url: signal.worldStatePageUrl }),
          createReplanTask(input.context, input.task, "wait", { durationMs: waitDurationMs ?? 500 }),
          createReplanTask(input.context, input.task, "click", { ...input.task.payload })
        ],
        replaceWith: [],
        abort: false,
        reason: `Rule replanner: procedural prior matched ${describePrior(prior)}, so it reopens the page before retrying the click.`
      };
    }

    if (waitDurationMs !== undefined) {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "wait", { durationMs: waitDurationMs }),
          createReplanTask(input.context, input.task, "click", { ...input.task.payload })
        ],
        replaceWith: [],
        abort: false,
        reason: `Rule replanner: procedural prior matched ${describePrior(prior)}, so it reuses a timed click retry.`
      };
    }
  }

  if (input.task.type === "type") {
    if (recoverySteps.includes("use visual_type") && typeof input.task.payload.text === "string") {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "visual_type", {
            description: describeTarget(input.task.payload.selector),
            text: input.task.payload.text
          })
        ],
        replaceWith: [],
        abort: false,
        reason: `Rule replanner: procedural prior matched ${describePrior(prior)}, so it reuses visual_type.`
      };
    }

    if (waitDurationMs !== undefined) {
      return {
        insertTasks: [
          createReplanTask(input.context, input.task, "click", { selector: input.task.payload.selector }),
          createReplanTask(input.context, input.task, "wait", { durationMs: waitDurationMs }),
          createReplanTask(input.context, input.task, "type", { ...input.task.payload })
        ],
        replaceWith: [],
        abort: false,
        reason: `Rule replanner: procedural prior matched ${describePrior(prior)}, so it refocuses and retries typing.`
      };
    }
  }

  if (input.task.type === "assert_text" && (recoverySteps.includes("retry assertion") || waitDurationMs !== undefined)) {
    const timeoutMs = Number(input.task.payload.timeoutMs ?? 5000);
    return {
      insertTasks: [
        createReplanTask(input.context, input.task, "wait", { durationMs: waitDurationMs ?? 1500 }),
        createReplanTask(input.context, input.task, "assert_text", {
          ...input.task.payload,
          timeoutMs: Math.max(timeoutMs + 1500, 3000)
        })
      ],
      replaceWith: [],
      abort: false,
      reason: `Rule replanner: procedural prior matched ${describePrior(prior)}, so it retries the assertion with the stored wait pattern.`
    };
  }

  return undefined;
}

function deriveRecoveryDomain(context: RunContext): string | undefined {
  const directUrl =
    context.worldState?.pageUrl ??
    context.latestObservation?.pageUrl ??
    context.tasks.find((task) => task.type === "open_page" && typeof task.payload.url === "string")?.payload.url;

  if (typeof directUrl !== "string" || directUrl.length === 0) {
    return undefined;
  }

  try {
    return new URL(directUrl).host;
  } catch {
    return undefined;
  }
}

function parseWaitDurationMs(recoverySteps: string): number | undefined {
  const match = recoverySteps.match(/wait\s+(\d+)ms/i);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function describePrior(prior: FailureLessonEntry): string {
  const parts = [prior.errorPattern];
  if (prior.hypothesisKind) {
    parts.push(`hypothesis=${prior.hypothesisKind}`);
  }
  if (prior.domain) {
    parts.push(`domain=${prior.domain}`);
  }
  return parts.join(", ");
}

function composeReason(baseReason: string, decision: EscalationPolicyDecision): string {
  const rationale = decision.useLLMReplanner
    ? decision.llmUsageRationale
    : decision.fallbackRationale ?? decision.rationale.at(-1);

  return rationale ? `${baseReason} Escalation: ${rationale}` : baseReason;
}
