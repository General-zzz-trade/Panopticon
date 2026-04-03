/**
 * LLM Decision Engine — uses a language model to decide the next action
 * instead of hardcoded if-else rules.
 *
 * When configured (LLM_DECISION_PROVIDER is set), this replaces the
 * rule-based executive controller for richer reasoning.
 * Falls back to rule-based decisions when LLM is unavailable.
 */

import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import type { AgentTask } from "../types";
import type { CognitiveDecision, VerificationResult } from "./types";
import { decideNextStep as ruleBasedDecision } from "./executive-controller";

export interface LLMDecisionInput {
  task: AgentTask;
  goal: string;
  actionVerification?: VerificationResult;
  stateVerification?: VerificationResult;
  goalVerification?: VerificationResult;
  replanCount: number;
  maxReplans?: number;
  visibleText?: string[];
  pageUrl?: string;
  completedTasks: string[];
  remainingTasks: string[];
  failureHistory: string[];
}

/**
 * Check if the LLM decision engine is configured.
 */
export function isLLMDecisionConfigured(): boolean {
  const config = readProviderConfig("LLM_DECISION", { maxTokens: 400, temperature: 0 });
  return Boolean(config.provider && config.apiKey);
}

/**
 * Use LLM to decide the next action. Falls back to rule-based if LLM fails.
 */
export async function llmDecideNextStep(input: LLMDecisionInput): Promise<CognitiveDecision> {
  const config = readProviderConfig("LLM_DECISION", { maxTokens: 400, temperature: 0 });

  if (!config.provider || !config.apiKey) {
    // Fall back to rule-based
    return ruleBasedDecision({
      task: input.task,
      actionVerification: input.actionVerification,
      stateVerification: input.stateVerification,
      goalVerification: input.goalVerification,
      replanCount: input.replanCount,
      maxReplans: input.maxReplans
    });
  }

  try {
    const messages = buildDecisionPrompt(input);
    const result = config.provider === "anthropic"
      ? await callAnthropic(config, messages, "LLM-Decision")
      : await callOpenAICompatible(config, messages, "LLM-Decision");

    const parsed = parseDecisionResponse(result.content);
    if (parsed) return parsed;
  } catch {
    // LLM call failed — fall back to rules
  }

  return ruleBasedDecision({
    task: input.task,
    actionVerification: input.actionVerification,
    stateVerification: input.stateVerification,
    goalVerification: input.goalVerification,
    replanCount: input.replanCount,
    maxReplans: input.maxReplans
  });
}

function buildDecisionPrompt(input: LLMDecisionInput): Array<{ role: "system" | "user"; content: string }> {
  const system = `You are a cognitive decision engine for a UI automation agent.

Given the current state, decide what to do next. Respond with JSON only:
{
  "nextAction": "continue" | "retry_task" | "replan" | "reobserve" | "abort",
  "rationale": "brief explanation of your reasoning",
  "confidence": 0.0-1.0
}

Rules:
- "continue": task succeeded, move to next task
- "retry_task": task failed but worth retrying (different approach)
- "replan": task failed, need a different strategy for remaining tasks
- "reobserve": unsure about state, observe again before deciding
- "abort": unrecoverable failure, stop the run

Be decisive. Prefer "continue" when verification passed. Prefer "replan" over "abort" when budget remains.`;

  const verificationSummary = [
    input.actionVerification ? `Action: ${input.actionVerification.passed ? "PASS" : "FAIL"} (${input.actionVerification.rationale})` : null,
    input.stateVerification ? `State: ${input.stateVerification.passed ? "PASS" : "FAIL"} (${input.stateVerification.rationale})` : null,
    input.goalVerification ? `Goal: ${input.goalVerification.passed ? "PASS" : "FAIL"} (${input.goalVerification.rationale})` : null
  ].filter(Boolean).join("\n");

  const user = `Goal: ${input.goal}

Current task: ${input.task.type} (${input.task.id})
Task payload: ${JSON.stringify(input.task.payload)}
Task attempts: ${input.task.attempts}, retries: ${input.task.retries}
${input.task.error ? `Last error: ${input.task.error}` : "No error"}

Verification results:
${verificationSummary || "No verification data"}

Page URL: ${input.pageUrl ?? "unknown"}
Visible text (first 5 lines): ${(input.visibleText ?? []).slice(0, 5).join(" | ")}

Completed tasks: ${input.completedTasks.join(", ") || "none"}
Remaining tasks: ${input.remainingTasks.join(", ") || "none"}
Replan budget: ${input.replanCount}/${input.maxReplans ?? 0} used
${input.failureHistory.length > 0 ? `Recent failures: ${input.failureHistory.slice(-3).join("; ")}` : ""}

What should we do next?`;

  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user }
  ];
}

function parseDecisionResponse(content: string): CognitiveDecision | null {
  const parsed = safeJsonParse(content);
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const validActions = ["continue", "retry_task", "replan", "reobserve", "abort"];

  if (typeof obj.nextAction !== "string" || !validActions.includes(obj.nextAction)) return null;
  if (typeof obj.rationale !== "string") return null;

  return {
    nextAction: obj.nextAction as CognitiveDecision["nextAction"],
    rationale: obj.rationale,
    confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0.7
  };
}
