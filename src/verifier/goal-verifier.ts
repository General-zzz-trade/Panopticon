import { logModuleError } from "../core/module-logger";
import type { RunContext } from "../types";
import type { AgentObservation, VerificationResult } from "../cognition/types";
import { readProviderConfig, callOpenAICompatible, callAnthropic } from "../llm/provider";
import { verifyCriteria } from "../goal/criteria-verifier";
import type { Goal } from "../goal/types";

export async function verifyGoalProgress(
  context: RunContext,
  observation: AgentObservation
): Promise<VerificationResult> {
  // Strategy 0: Structured criteria verification (if goal was parsed)
  const parsedGoal = (context as RunContext & { parsedGoal?: Goal }).parsedGoal;
  if (parsedGoal && parsedGoal.successCriteria.length > 0) {
    const criteriaResult = verifyCriteria(parsedGoal.successCriteria, observation, context);
    if (criteriaResult.total > 0) {
      const confidence = 0.5 + criteriaResult.confidence * 0.4; // Map to [0.5, 0.9]
      const result: VerificationResult = {
        runId: context.runId,
        verifier: "goal",
        passed: criteriaResult.passed,
        confidence,
        rationale: `Criteria: ${criteriaResult.met}/${criteriaResult.total} met. ${criteriaResult.details.map(d => d.evidence).join("; ")}`,
        evidence: [`strategy=criteria`, `met=${criteriaResult.met}`, `total=${criteriaResult.total}`]
      };
      if (result.confidence >= 0.7) return result;
      // If criteria verification is inconclusive, fall through to other strategies
    }
  }

  // Strategy 1: Quoted text extraction
  const strategy1 = verifyByQuotedText(context, observation);
  if (strategy1.confidence >= 0.7) {
    return strategy1;
  }

  // Strategy 2: Task completion heuristic
  const strategy2 = verifyByTaskCompletion(context);
  if (strategy2.confidence >= 0.65) {
    return strategy2;
  }

  // Pick the better of strategy 1 and 2
  const bestSoFar = strategy1.confidence >= strategy2.confidence ? strategy1 : strategy2;

  // Strategy 3: LLM semantic verification (only if configured and confidence still low)
  if (bestSoFar.confidence < 0.6) {
    const strategy3 = await verifyByLLM(context, observation);
    if (strategy3) {
      return strategy3;
    }
  }

  return bestSoFar;
}

function verifyByQuotedText(
  context: RunContext,
  observation: AgentObservation
): VerificationResult {
  const goal = context.goal.toLowerCase();
  const visible = observation.visibleText?.join(" ").toLowerCase() ?? "";
  const evidence = [
    `goal=${context.goal.slice(0, 160)}`,
    `appStateGuess=${observation.appStateGuess ?? "unknown"}`
  ];

  const quotedText = extractQuotedText(context.goal);
  const expectsText = quotedText.length > 0;
  const matchedText = quotedText.find((text) => visible.includes(text.toLowerCase()));

  const passed = expectsText ? Boolean(matchedText) : !/failed|error/i.test(goal);
  const rationale = expectsText
    ? passed
      ? `Observed goal text "${matchedText}" in the current page content.`
      : "None of the quoted goal texts were observed yet."
    : "Goal verifier did not find a quoted assertion target, so it used a weak heuristic.";

  return {
    runId: context.runId,
    verifier: "goal",
    passed,
    confidence: expectsText ? (passed ? 0.8 : 0.55) : 0.35,
    rationale,
    evidence
  };
}

function verifyByTaskCompletion(context: RunContext): VerificationResult {
  const tasks = context.tasks;
  if (tasks.length === 0) {
    return {
      runId: context.runId,
      verifier: "goal",
      passed: false,
      confidence: 0.3,
      rationale: "No tasks to evaluate completion against.",
      evidence: ["taskCount=0"]
    };
  }

  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const completionRatio = doneTasks / tasks.length;

  const verifications = context.verificationResults ?? [];
  const actionVerifications = verifications.filter((v) => v.verifier === "action");
  const passedVerifications = actionVerifications.filter((v) => v.passed).length;
  const verificationPassRate = actionVerifications.length > 0
    ? passedVerifications / actionVerifications.length
    : 0.5;

  const combinedScore = completionRatio * 0.6 + verificationPassRate * 0.4;
  const passed = combinedScore >= 0.7;
  const confidence = 0.45 + combinedScore * 0.3; // Maps [0,1] → [0.45, 0.75]

  return {
    runId: context.runId,
    verifier: "goal",
    passed,
    confidence,
    rationale: passed
      ? `${doneTasks}/${tasks.length} tasks completed, ${(verificationPassRate * 100).toFixed(0)}% verifications passed.`
      : `Only ${doneTasks}/${tasks.length} tasks completed, ${(verificationPassRate * 100).toFixed(0)}% verifications passed.`,
    evidence: [
      `completionRatio=${completionRatio.toFixed(2)}`,
      `verificationPassRate=${verificationPassRate.toFixed(2)}`,
      `combinedScore=${combinedScore.toFixed(2)}`
    ]
  };
}

async function verifyByLLM(
  context: RunContext,
  observation: AgentObservation
): Promise<VerificationResult | null> {
  const config = readProviderConfig("LLM_VERIFIER", {
    maxTokens: 200,
    temperature: 0
  });

  if (!config.provider || !config.apiKey) {
    return null;
  }

  const visibleSnippet = (observation.visibleText ?? []).join("\n").slice(0, 500);
  const taskSummary = context.tasks
    .map((t) => `${t.id}(${t.type}): ${t.status}`)
    .join(", ")
    .slice(0, 300);

  const messages = [
    {
      role: "system" as const,
      content: "You are an OSINT goal verification assistant. Given an investigation objective, current reconnaissance findings, and task execution status, determine whether the goal has been achieved. Respond with JSON: {\"achieved\": true/false, \"rationale\": \"brief explanation\"}"
    },
    {
      role: "user" as const,
      content: `Goal: ${context.goal}\n\nVisible page content:\n${visibleSnippet}\n\nTask status: ${taskSummary}`
    }
  ];

  try {
    const { content: raw } = config.provider === "anthropic"
      ? await callAnthropic(config, messages, "GoalVerifier")
      : await callOpenAICompatible(config, messages, "GoalVerifier");

    const parsed = JSON.parse(raw) as { achieved?: boolean; rationale?: string };
    const achieved = parsed.achieved === true;

    return {
      runId: context.runId,
      verifier: "goal",
      passed: achieved,
      confidence: achieved ? 0.85 : 0.7,
      rationale: parsed.rationale ?? (achieved ? "LLM confirmed goal achieved." : "LLM determined goal not yet achieved."),
      evidence: ["strategy=llm_semantic"]
    };
  } catch (error) {
    logModuleError("goal-verifier", "optional", error, "LLM semantic goal verification");
    return null;
  }
}

function extractQuotedText(goal: string): string[] {
  return Array.from(goal.matchAll(/"([^"]+)"/g))
    .map((match) => match[1])
    .filter(Boolean);
}
