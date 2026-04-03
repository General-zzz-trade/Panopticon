import type { AgentTask, RunContext } from "../types";
import type { AgentObservation, ObservationInput } from "./types";
import { analyzeSceneFromText } from "../vision/scene-analyzer";

export async function observeEnvironment(
  context: RunContext,
  task?: AgentTask
): Promise<AgentObservation> {
  const page = context.browserSession?.page;
  const payload: ObservationInput = {
    runId: context.runId,
    taskId: task?.id,
    anomalies: [],
    confidence: 0.45
  };

  if (!page) {
    payload.anomalies?.push("No browser page is attached to the current run.");
    return materializeObservation(payload);
  }

  try {
    payload.pageUrl = page.url();
    payload.title = await page.title();
    payload.visibleText = await page.locator("body").innerText().then((text) => compactLines(text, 8));
    payload.actionableElements = await collectActionableElements(page);
    payload.appStateGuess = inferAppStateGuess(payload);
    payload.confidence = 0.75;

    // Visual scene analysis — heuristic-based (no screenshot needed)
    try {
      const textForScene = payload.visibleText ?? [];
      const scene = analyzeSceneFromText(textForScene);
      payload.sceneDescription = {
        pageType: scene.pageType,
        keyElements: scene.keyElements,
        stateIndicators: scene.stateIndicators,
        confidence: scene.confidence
      };
    } catch {
      // Scene analysis is optional
    }
  } catch (error) {
    payload.anomalies?.push(error instanceof Error ? error.message : "Observation failed.");
    payload.confidence = 0.3;
  }

  return materializeObservation(payload);
}

export function materializeObservation(input: ObservationInput): AgentObservation {
  return {
    id: createObservationId(input.runId),
    runId: input.runId,
    taskId: input.taskId,
    timestamp: new Date().toISOString(),
    source: input.source ?? "task_observe",
    pageUrl: input.pageUrl,
    title: input.title,
    visibleText: input.visibleText ?? [],
    actionableElements: input.actionableElements ?? [],
    appStateGuess: input.appStateGuess,
    sceneDescription: input.sceneDescription,
    anomalies: input.anomalies ?? [],
    confidence: input.confidence ?? 0.5
  };
}

async function collectActionableElements(
  page: NonNullable<RunContext["browserSession"]>["page"]
): Promise<AgentObservation["actionableElements"]> {
  const candidates = page.locator("button, a, input, textarea, select");
  const count = await candidates.count();
  const max = Math.min(count, 8);
  const elements: NonNullable<AgentObservation["actionableElements"]> = [];

  for (let index = 0; index < max; index += 1) {
    const item = candidates.nth(index);
    const text = (await item.textContent())?.trim() || undefined;
    const tagName = await item.evaluate((node) => node.tagName.toLowerCase());
    const role = (await item.getAttribute("role")) ?? inferRoleFromTag(tagName);
    const selector = await item.getAttribute("id").then((id) => (id ? `#${id}` : undefined));
    elements.push({
      role,
      text,
      selector,
      confidence: selector ? 0.85 : 0.6
    });
  }

  return elements;
}

function inferAppStateGuess(input: ObservationInput): string {
  const haystack = [input.title, input.visibleText?.join(" ")].filter(Boolean).join(" ");

  if (/dashboard|logout|signed in/i.test(haystack)) {
    return "authenticated";
  }

  if (/loading|starting|please wait/i.test(haystack)) {
    return "loading";
  }

  if (/login|sign in/i.test(haystack)) {
    return "ready";
  }

  return "unknown";
}

function compactLines(text: string, maxLines: number): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function inferRoleFromTag(tagName: string): string {
  if (tagName === "a") {
    return "link";
  }

  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return "input";
  }

  return "button";
}

function createObservationId(runId: string): string {
  return `obs-${runId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
