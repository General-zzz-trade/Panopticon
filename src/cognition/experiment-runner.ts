import { waitForDuration } from "../browser";
import type { AgentTask, RunContext } from "../types";
import type { ExperimentResult, FailureHypothesis, ObservationPatch } from "./types";
import { logModuleError } from "../core/module-logger";

export async function runRecoveryExperiments(input: {
  context: RunContext;
  task: AgentTask;
  hypotheses: FailureHypothesis[];
}): Promise<ExperimentResult[]> {
  const results: ExperimentResult[] = [];

  for (const hypothesis of input.hypotheses) {
    switch (hypothesis.kind) {
      case "state_not_ready":
        results.push(await runStateReadinessExperiment(input.context, input.task, hypothesis));
        break;
      case "selector_drift":
        results.push(await runSelectorExperiment(input.context, input.task, hypothesis));
        break;
      case "assertion_phrase_changed":
        results.push(runAssertionTextExperiment(input.context, input.task, hypothesis));
        break;
      case "session_not_established":
        results.push(runSessionExperiment(input.context, input.task, hypothesis));
        break;
      case "missing_page_context":
        results.push(runMissingPageExperiment(input.context, input.task, hypothesis));
        break;
      default:
        results.push(createResult(
          input.context.runId,
          input.task.id,
          hypothesis.id,
          "collect supporting evidence",
          "collect non-destructive evidence only",
          "inconclusive",
          ["No targeted experiment available yet."],
          0
        ));
        break;
    }
  }

  return results;
}

async function runStateReadinessExperiment(
  context: RunContext,
  task: AgentTask,
  hypothesis: FailureHypothesis
) : Promise<ExperimentResult> {
  const beforeAppState = context.worldState?.appState ?? "unknown";
  const beforeVisibleText = context.latestObservation?.visibleText?.join(" ") ?? "";
  let afterVisibleText = beforeVisibleText;
  let performedAction = "inspect current loading signals";

  if (context.browserSession?.page) {
    performedAction = "wait 400ms and re-read body text";
    await waitForDuration(context.browserSession, 400);
    try {
      afterVisibleText = await context.browserSession.page.locator("body").innerText();
    } catch (error) {
      logModuleError("experiment-runner", "optional", error, "re-reading body text after wait");
      afterVisibleText = beforeVisibleText;
    }
  }

  const supporting =
    beforeAppState === "loading" ||
    /loading|starting|please wait/i.test(beforeVisibleText) ||
    /loading|starting|please wait/i.test(afterVisibleText);

  return createResult(
    context.runId,
    task.id,
    hypothesis.id,
    "wait briefly and inspect readiness signals",
    performedAction,
    supporting ? "support" : "refute",
    [
      `appState=${beforeAppState}`,
      `beforeVisibleText=${beforeVisibleText.slice(0, 120)}`,
      `afterVisibleText=${afterVisibleText.slice(0, 120)}`
    ],
    supporting ? 0.14 : -0.12,
    {
      visibleText: compactLines(afterVisibleText, 8),
      appStateGuess: supporting ? "loading" : inferObservationState(afterVisibleText),
      confidence: supporting ? 0.82 : 0.7
    },
    ["experiment:readiness_probe"]
  );
}

async function runSelectorExperiment(
  context: RunContext,
  task: AgentTask,
  hypothesis: FailureHypothesis
): Promise<ExperimentResult> {
  const selector = typeof task.payload.selector === "string" ? task.payload.selector : "";
  const page = context.browserSession?.page;

  if (!page || !selector) {
    return createResult(
      context.runId,
      task.id,
      hypothesis.id,
      "check selector presence in DOM",
      "probe selector count in DOM",
      "inconclusive",
      ["No live page or selector was available."],
      0,
      undefined,
      ["experiment:selector_probe_unavailable"]
    );
  }

  try {
    const count = await page.locator(selector).count();

    if (count === 0) {
      // Creative recovery: try alternative selectors
      let alternatives: Array<{ selector: string; strategy: string; confidence: number; description: string }> = [];
      try {
        const { findAlternativeSelectors } = await import("./selector-recovery");
        alternatives = await findAlternativeSelectors(context.browserSession!, selector, task.type);
      } catch (error) { logModuleError("experiment-runner", "optional", error, "finding alternative selectors"); }

      // If no DOM alternatives found, try visual fallback as last resort
      let visualFallbackAvailable = false;
      if (alternatives.length === 0) {
        try {
          const { tryVisualFallback } = await import("./selector-recovery");
          const fallbackResult = await tryVisualFallback(context, task, selector);
          if (fallbackResult.attempted && fallbackResult.output) {
            visualFallbackAvailable = true;
            return createResult(
              context.runId,
              task.id,
              hypothesis.id,
              "check selector presence in DOM",
              "visual fallback executed after selector exhaustion",
              "refute",
              [
                `selector=${selector}`,
                `count=0`,
                `visual_fallback=success`,
                `summary=${fallbackResult.output.summary}`
              ],
              -0.2,
              undefined,
              ["visual_fallback_used", ...(fallbackResult.output.stateHints ?? [])]
            );
          }
        } catch (error) { logModuleError("experiment-runner", "optional", error, "visual fallback attempt"); }
      }

      const stateHints = alternatives.length > 0
        ? alternatives.slice(0, 3).map(a => `alternative_selector:${a.selector}:${a.strategy}`)
        : visualFallbackAvailable
          ? ["visual_fallback_available"]
          : [`experiment:selector_count:0`];

      return createResult(
        context.runId,
        task.id,
        hypothesis.id,
        "check selector presence in DOM",
        "probe selector count in DOM and search alternatives",
        "support",
        [
          `selector=${selector}`,
          `count=0`,
          `alternatives_found=${alternatives.length}`,
          `visual_fallback=${visualFallbackAvailable ? "available" : "unavailable"}`,
          ...alternatives.slice(0, 3).map(a => `alt:${a.strategy}=${a.selector}`)
        ],
        0.18,
        undefined,
        stateHints
      );
    }

    return createResult(
      context.runId,
      task.id,
      hypothesis.id,
      "check selector presence in DOM",
      "probe selector count in DOM",
      "refute",
      [`selector=${selector}`, `count=${count}`],
      -0.16,
      undefined,
      [`experiment:selector_count:${count}`]
    );
  } catch (error) {
    return createResult(
      context.runId,
      task.id,
      hypothesis.id,
      "check selector presence in DOM",
      "probe selector count in DOM",
      "inconclusive",
      [error instanceof Error ? error.message : "Selector experiment failed."],
      0,
      undefined,
      ["experiment:selector_probe_error"]
    );
  }
}

function runAssertionTextExperiment(
  context: RunContext,
  task: AgentTask,
  hypothesis: FailureHypothesis
): ExperimentResult {
  const expectedText = String(task.payload.text ?? "");
  const visibleLines = context.latestObservation?.visibleText ?? [];
  const bestOverlap = visibleLines
    .map((line) => sharedTokenCount(expectedText, line))
    .sort((left, right) => right - left)[0] ?? 0;
  const supports = bestOverlap >= 1 && !visibleLines.join(" ").toLowerCase().includes(expectedText.toLowerCase());

  return createResult(
    context.runId,
    task.id,
    hypothesis.id,
    "compare expected assertion text with visible text",
    "compare expected text tokens against current visible text",
    supports ? "support" : "refute",
    [`expected=${expectedText}`, `bestTokenOverlap=${bestOverlap}`],
    supports ? 0.16 : -0.1,
    undefined,
    [`experiment:assert_overlap:${bestOverlap}`]
  );
}

function runSessionExperiment(
  context: RunContext,
  task: AgentTask,
  hypothesis: FailureHypothesis
): ExperimentResult {
  const visibleText = context.latestObservation?.visibleText?.join(" ") ?? "";
  const cookieSignal = context.worldState?.facts.some((fact) => /session_restored:true/.test(fact)) ?? false;
  const supports = /login|sign in|logged out/i.test(visibleText) && !cookieSignal;

  return createResult(
    context.runId,
    task.id,
    hypothesis.id,
    "look for unauthenticated markers in the page content",
    "probe page text for unauthenticated markers",
    supports ? "support" : "refute",
    [`visibleText=${visibleText.slice(0, 140)}`, `sessionRestored=${cookieSignal}`],
    supports ? 0.12 : -0.08,
    {
      appStateGuess: supports ? "ready" : context.latestObservation?.appStateGuess,
      confidence: 0.72
    },
    [supports ? "experiment:session_marker:unauthenticated" : "experiment:session_marker:no_match"]
  );
}

function runMissingPageExperiment(
  context: RunContext,
  task: AgentTask,
  hypothesis: FailureHypothesis
): ExperimentResult {
  const supports = !context.browserSession?.page && Boolean(context.worldState?.pageUrl);
  return createResult(
    context.runId,
    task.id,
    hypothesis.id,
    "check whether a remembered page exists without a live page handle",
    "probe remembered page url against live page handle",
    supports ? "support" : "refute",
    [`hasPage=${Boolean(context.browserSession?.page)}`, `worldUrl=${context.worldState?.pageUrl ?? "none"}`],
    supports ? 0.2 : -0.14,
    {
      pageUrl: context.worldState?.pageUrl,
      anomalies: supports ? ["Experiment confirmed missing live page context."] : []
    },
    [supports ? "experiment:page_context_missing" : "experiment:page_context_attached"]
  );
}

function createResult(
  runId: string,
  taskId: string | undefined,
  hypothesisId: string,
  experiment: string,
  performedAction: string | undefined,
  outcome: ExperimentResult["outcome"],
  evidence: string[],
  confidenceDelta: number,
  observationPatch?: ObservationPatch,
  stateHints?: string[]
): ExperimentResult {
  return {
    id: `exp-${runId}-${Math.random().toString(36).slice(2, 8)}`,
    runId,
    taskId,
    hypothesisId,
    experiment,
    performedAction,
    outcome,
    evidence,
    confidenceDelta,
    observationPatch,
    stateHints
  };
}

function compactLines(text: string, maxLines: number): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function inferObservationState(text: string): string {
  if (/dashboard|logout|signed in/i.test(text)) {
    return "authenticated";
  }

  if (/loading|starting|please wait/i.test(text)) {
    return "loading";
  }

  if (/login|sign in/i.test(text)) {
    return "ready";
  }

  return "unknown";
}

function sharedTokenCount(expected: string, actual: string): number {
  const left = new Set(expected.toLowerCase().split(/\s+/).filter((token) => token.length > 2));
  const right = new Set(actual.toLowerCase().split(/\s+/).filter((token) => token.length > 2));
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}
