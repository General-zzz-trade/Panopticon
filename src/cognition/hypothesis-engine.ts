import type { AgentTask, RunContext } from "../types";
import type { FailureHypothesis, BetaBelief } from "./types";
import { getLessonsForTaskType } from "../knowledge/store";
import { runReflection, getAdjustedPrior } from "../learning/reflection-loop";
import type { ReflectionInsight } from "../learning/reflection-loop";
import { callOpenAICompatible, callAnthropic, readProviderConfig, safeJsonParse } from "../llm/provider";
import type { LLMProviderConfig } from "../llm/provider";
import { logModuleError } from "../core/module-logger";

export async function generateFailureHypotheses(input: {
  context: RunContext;
  task: AgentTask;
  failureReason: string;
}): Promise<FailureHypothesis[]> {
  const { context, task, failureReason } = input;
  const visibleText = context.latestObservation?.visibleText?.join(" ") ?? "";
  const appState = context.worldState?.appState ?? "unknown";
  const hypotheses: FailureHypothesis[] = [];

  // Load learned priors from reflection (cached per call, not per hypothesis)
  let reflectionInsight: ReflectionInsight | null = null;
  try {
    reflectionInsight = runReflection();
  } catch (error) {
    logModuleError("hypothesis-engine", "optional", error, "running reflection for priors");
  }

  if (/timeout|loading|please wait/i.test(failureReason) || appState === "loading") {
    hypotheses.push(createHypothesis(task.id, "state_not_ready", adjustConfidence("state_not_ready", 0.72, reflectionInsight),
      "The environment still looks transitional, so the task may have executed before the page stabilized.",
      ["check appState and current visible text", "re-observe after a short wait"],
      "Prefer a wait plus retry before changing selectors."
    ));
  }

  if ((task.type === "click" || task.type === "type" || task.type === "select") &&
      (/selector|locator|not found|no node matched/i.test(failureReason) || hasSelectorPayload(task))) {
    hypotheses.push(createHypothesis(task.id, "selector_drift", adjustConfidence("selector_drift", 0.68, reflectionInsight),
      "The requested selector may no longer match the live DOM or the target element moved.",
      ["check whether the selector exists in the current DOM", "compare with visible actionable elements"],
      "Prefer visual fallback or selector recovery before repeating the same action."
    ));
  }

  if (task.type === "assert_text" && (/assert|expected text|text/i.test(failureReason) || Boolean(visibleText))) {
    hypotheses.push(createHypothesis(task.id, "assertion_phrase_changed", adjustConfidence("assertion_phrase_changed", 0.64, reflectionInsight),
      "The expected assertion text may have drifted while the underlying state transition still happened.",
      ["compare expected text against visible text for near-match overlap"],
      "Prefer near-match inspection and evidence capture before failing hard."
    ));
  }

  if ((task.type === "click" || task.type === "assert_text") &&
      (/login|sign in/i.test(visibleText) || appState === "ready")) {
    hypotheses.push(createHypothesis(task.id, "session_not_established", adjustConfidence("session_not_established", 0.58, reflectionInsight),
      "The workflow may still be unauthenticated, so downstream actions and assertions are premature.",
      ["check whether the page still shows login prompts", "look for authenticated-state markers"],
      "Prefer restoring session or re-running the auth transition."
    ));
  }

  if (!context.browserSession?.page && Boolean(context.worldState?.pageUrl)) {
    hypotheses.push(createHypothesis(task.id, "missing_page_context", adjustConfidence("missing_page_context", 0.74, reflectionInsight),
      "There is a remembered page URL but no live page context, so the executor likely lost browser attachment.",
      ["verify whether browser page is attached", "reopen the last known page URL"],
      "Prefer reopening the last known page before deeper recovery."
    ));
  }

  // Knowledge-driven hypotheses from past failure lessons
  try {
    const domain = extractDomainFromContext(context);
    const lessons = getLessonsForTaskType(task.type, domain);
    for (const lesson of lessons) {
      const alreadyCovered = hypotheses.some(
        (h) => h.recoveryHint.toLowerCase().includes(lesson.recovery.toLowerCase())
      );
      if (!alreadyCovered) {
        hypotheses.push(createHypothesis(
          task.id,
          "learned_pattern",
          Math.min(0.85, 0.5 + lesson.successCount * 0.05),
          `Learned from prior failure: ${lesson.errorPattern}`,
          ["apply learned recovery strategy"],
          lesson.recovery
        ));
      }
    }
  } catch (error) {
    logModuleError("hypothesis-engine", "optional", error, "loading knowledge-driven hypotheses");
  }

  // LLM-driven hypothesis generation: ALWAYS try when LLM is configured.
  // LLM hypotheses complement predefined ones — they may discover novel failure modes.
  try {
    const llmHypotheses = await generateLLMHypotheses(context, task, failureReason);
    hypotheses.push(...llmHypotheses);
  } catch (error) {
    logModuleError("hypothesis-engine", "optional", error, "generating LLM hypotheses");
  }

  if (hypotheses.length === 0) {
    hypotheses.push(createHypothesis(task.id, "unknown", adjustConfidence("unknown", 0.4, reflectionInsight),
      "The failure does not strongly match a known recovery pattern yet.",
      ["collect one more observation and preserve evidence"],
      "Prefer a conservative wait or screenshot before escalating."
    ));
  }

  return hypotheses.sort((left, right) => right.confidence - left.confidence);
}

function adjustConfidence(
  kind: FailureHypothesis["kind"],
  base: number,
  insight: ReflectionInsight | null
): number {
  if (!insight) return base;
  return getAdjustedPrior(kind, base, insight);
}

function defaultBeliefForKind(kind: FailureHypothesis["kind"], confidence?: number): BetaBelief {
  if (kind === "learned_pattern") {
    // For learned patterns, derive alpha from success count approximation
    // The confidence passed in is min(0.85, 0.5 + successCount * 0.05)
    // so successCount ≈ (confidence - 0.5) / 0.05, but we use a simpler heuristic:
    const approxSuccessCount = confidence != null ? Math.max(0, Math.round((confidence - 0.5) / 0.05)) : 0;
    return { alpha: 1 + approxSuccessCount, beta: 1 };
  }
  if (kind === "unknown") {
    return { alpha: 1, beta: 1 };
  }
  if (kind === "discovered") {
    return { alpha: 1, beta: 1 };
  }
  // Predefined hypotheses
  return { alpha: 2, beta: 1 };
}

function createHypothesis(
  taskId: string | undefined,
  kind: FailureHypothesis["kind"],
  confidence: number,
  explanation: string,
  suggestedExperiments: string[],
  recoveryHint: string,
  belief?: BetaBelief
): FailureHypothesis {
  return {
    id: `hyp-${taskId ?? "run"}-${kind}-${Math.random().toString(36).slice(2, 7)}`,
    taskId,
    kind,
    explanation,
    confidence,
    belief: belief ?? defaultBeliefForKind(kind, confidence),
    suggestedExperiments,
    recoveryHint
  };
}

function hasSelectorPayload(task: AgentTask): boolean {
  return typeof task.payload.selector === "string" && task.payload.selector.length > 0;
}

function extractDomainFromContext(context: RunContext): string | undefined {
  const url = context.worldState?.pageUrl
    ?? context.latestObservation?.pageUrl;
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    logModuleError("hypothesis-engine", "optional", error, "extracting domain from URL");
    return undefined;
  }
}

/**
 * Generates novel failure hypotheses using an LLM when predefined patterns
 * have low confidence. Reads config from LLM_HYPOTHESIS_* env vars.
 * Returns an empty array if no LLM is configured or the call fails.
 */
async function generateLLMHypotheses(
  context: RunContext,
  task: AgentTask,
  failureReason: string
): Promise<FailureHypothesis[]> {
  const config = readProviderConfig("LLM_HYPOTHESIS", {
    maxTokens: 512,
    temperature: 0.4
  });

  // If no provider configured, skip silently
  if (!config.provider) {
    return [];
  }

  const systemPrompt = `You are a failure diagnosis engine for a UI automation agent.
Given a failed task and its context, generate 1-3 novel hypotheses about why the failure occurred.
Each hypothesis should be distinct from common patterns (selector drift, state not ready, session issues).
Respond with JSON: { "hypotheses": [{ "name": string, "explanation": string, "experiment": string, "recovery": string }] }`;

  const userPrompt = `Task type: ${task.type}
Task payload: ${JSON.stringify(task.payload)}
Failure reason: ${failureReason}
Page URL: ${context.worldState?.pageUrl ?? "unknown"}
App state: ${context.worldState?.appState ?? "unknown"}
Visible text: ${(context.latestObservation?.visibleText ?? []).slice(0, 5).join(", ")}
Error history: ${(task.errorHistory ?? []).slice(-3).join("; ")}`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt }
  ];

  const callLLM = config.provider === "anthropic" ? callAnthropic : callOpenAICompatible;
  const result = await callLLM(config, messages, "HypothesisEngine", {
    maxRetries: 1,
    baseDelayMs: 500,
    maxDelayMs: 2000,
    jitterFactor: 0.2
  });

  const parsed = safeJsonParse(result.content) as {
    hypotheses?: Array<{
      name?: string;
      explanation?: string;
      experiment?: string;
      recovery?: string;
    }>;
  } | undefined;

  if (!parsed?.hypotheses || !Array.isArray(parsed.hypotheses)) {
    return [];
  }

  return parsed.hypotheses
    .filter((h) => h.name && h.explanation)
    .slice(0, 3)
    .map((h) =>
      createHypothesis(
        task.id,
        "discovered",
        0.5,
        `[LLM] ${h.name}: ${h.explanation}`,
        h.experiment ? [h.experiment] : ["investigate further"],
        h.recovery ?? "Apply LLM-suggested recovery strategy.",
        { alpha: 1, beta: 1 }
      )
    );
}
