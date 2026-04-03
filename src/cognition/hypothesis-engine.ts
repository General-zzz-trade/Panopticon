import type { AgentTask, RunContext } from "../types";
import type { FailureHypothesis } from "./types";
import { getLessonsForTaskType } from "../knowledge/store";
import { runReflection, getAdjustedPrior } from "../learning/reflection-loop";
import type { ReflectionInsight } from "../learning/reflection-loop";

export function generateFailureHypotheses(input: {
  context: RunContext;
  task: AgentTask;
  failureReason: string;
}): FailureHypothesis[] {
  const { context, task, failureReason } = input;
  const visibleText = context.latestObservation?.visibleText?.join(" ") ?? "";
  const appState = context.worldState?.appState ?? "unknown";
  const hypotheses: FailureHypothesis[] = [];

  // Load learned priors from reflection (cached per call, not per hypothesis)
  let reflectionInsight: ReflectionInsight | null = null;
  try {
    reflectionInsight = runReflection();
  } catch {
    // Reflection may not be available
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
  } catch {
    // Knowledge store may not be initialized — skip silently
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

function createHypothesis(
  taskId: string | undefined,
  kind: FailureHypothesis["kind"],
  confidence: number,
  explanation: string,
  suggestedExperiments: string[],
  recoveryHint: string
): FailureHypothesis {
  return {
    id: `hyp-${taskId ?? "run"}-${kind}-${Math.random().toString(36).slice(2, 7)}`,
    taskId,
    kind,
    explanation,
    confidence,
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
  } catch {
    return undefined;
  }
}
