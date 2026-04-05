import { buildPlanningPriors, extractDomainFromGoal } from "../knowledge/planner-context";
import { logModuleError } from "../core/module-logger";
import type { PlanningPriorHit } from "../types";
import type { TaskBlueprint } from "./task-id";

export interface PriorAwarePlanResult {
  blueprints: TaskBlueprint[];
  notes: string[];
  matchedPriors: PlanningPriorHit[];
}

export function applyPlanningPriors(goal: string, blueprints: TaskBlueprint[]): PriorAwarePlanResult {
  const domain = extractDomainFromGoal(goal);
  const planningPriors = buildPlanningPriors(goal, domain);
  const notes: string[] = [];
  const matchedPriors: PlanningPriorHit[] = [];
  const next = [...blueprints];

  const clickPrior = planningPriors.find((prior) => prior.taskType === "click");
  if (clickPrior && !next.some((task) => task.type === "click" || task.type === "visual_click")) {
    const description = inferVisualClickDescription(goal);
    if (description && hasRecoveryHint(clickPrior.lessons, "use visual_click")) {
      insertAfterOpenPage(next, { type: "visual_click", payload: { description } });
      notes.push(`planning prior inserted visual_click for "${description}"`);
      matchedPriors.push(...toPriorHits(clickPrior.taskType, clickPrior.lessons));
    }
  }

  const typePrior = planningPriors.find((prior) => prior.taskType === "type");
  if (typePrior && !next.some((task) => task.type === "type" || task.type === "visual_type")) {
    const visualTypeInput = inferVisualTypeInput(goal);
    if (visualTypeInput && hasRecoveryHint(typePrior.lessons, "use visual_type")) {
      insertAfterOpenPage(next, {
        type: "visual_type",
        payload: { description: visualTypeInput.description, text: visualTypeInput.text }
      });
      notes.push(`planning prior inserted visual_type for "${visualTypeInput.description}"`);
      matchedPriors.push(...toPriorHits(typePrior.taskType, typePrior.lessons));
    }
  }

  const assertPrior = planningPriors.find((prior) => prior.taskType === "assert_text");
  const assertWaitMs = assertPrior ? extractRecommendedWait(assertPrior.lessons) : undefined;
  if (assertWaitMs !== undefined) {
    for (let index = 0; index < next.length; index += 1) {
      const task = next[index];
      if (task.type !== "assert_text") {
        continue;
      }

      const previous = next[index - 1];
      if (previous?.type === "wait") {
        continue;
      }

      next.splice(index, 0, { type: "wait", payload: { ms: assertWaitMs, durationMs: assertWaitMs } });
      index += 1;
      notes.push(`planning prior inserted wait ${assertWaitMs}ms before assert_text`);
      matchedPriors.push(...toPriorHits(assertPrior!.taskType, assertPrior!.lessons));
    }
  }

  // Auto-switch tasks with high-failure selectors to visual variants
  for (let i = 0; i < next.length; i++) {
    const task = next[i];
    const selector = task.payload?.selector as string | undefined;
    if (!selector) continue;
    if (task.type !== "click" && task.type !== "type" && task.type !== "select") continue;

    // Check if this selector has failure history across domains
    try {
      const { getSelectorsAcrossDomains } = require("../knowledge/store");
      const selectorHistory = getSelectorsAcrossDomains(selector);
      const failedEntries = selectorHistory.filter((s: any) => s.failureCount > s.successCount);

      if (failedEntries.length > 0) {
        const visualType = task.type === "select" ? "visual_click" : `visual_${task.type}`;
        const description = (task.payload?.description as string | undefined) ?? selector;
        next[i] = {
          ...task,
          type: visualType as any,
          payload: { ...task.payload, description }
        };
        notes.push(`auto-switched ${task.type} "${selector}" to ${visualType} (selector has ${failedEntries.length} failure record(s))`);
      }
    } catch (error) {
      logModuleError("prior-aware-planner", "optional", error, "Failed to check selector failure history from knowledge store");
    }
  }

  return { blueprints: next, notes, matchedPriors: dedupePriorHits(matchedPriors) };
}

function insertAfterOpenPage(blueprints: TaskBlueprint[], task: TaskBlueprint): void {
  const openPageIndex = blueprints.map((item) => item.type).lastIndexOf("open_page");
  const insertIndex = openPageIndex >= 0 ? openPageIndex + 1 : blueprints.length;
  blueprints.splice(insertIndex, 0, task);
}

function hasRecoveryHint(
  lessons: Array<{ recovery: string; recoverySequence?: string[] }>,
  hint: string
): boolean {
  const normalizedHint = hint.toLowerCase();
  return lessons.some((lesson) => {
    if (lesson.recovery.toLowerCase().includes(normalizedHint)) {
      return true;
    }

    return lesson.recoverySequence?.some((step) => step.toLowerCase().includes(normalizedHint)) ?? false;
  });
}

function extractRecommendedWait(
  lessons: Array<{ recovery: string; recoverySequence?: string[] }>
): number | undefined {
  for (const lesson of lessons) {
    const allText = [lesson.recovery, ...(lesson.recoverySequence ?? [])].join(" | ");
    const match = allText.match(/wait\s+(\d+)ms/i);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }
  }

  return undefined;
}

function inferVisualClickDescription(goal: string): string | undefined {
  const quoted = goal.match(/\bclick\s+"([^"]+)"/i)?.[1];
  if (quoted && !looksLikeSelector(quoted)) {
    return quoted;
  }

  const natural = goal.match(/\bclick\s+([a-z0-9][a-z0-9 _-]{1,40}?)(?:\s+\band\b|\s+\bthen\b|$)/i)?.[1]?.trim();
  if (!natural || looksLikeSelector(natural)) {
    return undefined;
  }

  return natural;
}

function inferVisualTypeInput(goal: string): { text: string; description: string } | undefined {
  const match = goal.match(/\btype\s+"([^"]+)"\s+(?:into|in)\s+"([^"]+)"/i);
  if (match && !looksLikeSelector(match[2])) {
    return { text: match[1], description: match[2] };
  }

  const natural = goal.match(/\btype\s+"([^"]+)"\s+(?:into|in)\s+([a-z0-9][a-z0-9 _-]{1,40}?)(?:\s+\band\b|\s+\bthen\b|$)/i);
  if (!natural || looksLikeSelector(natural[2])) {
    return undefined;
  }

  return { text: natural[1], description: natural[2].trim() };
}

function looksLikeSelector(value: string): boolean {
  return /^(#|\.|\[|text=|data-testid=)/i.test(value.trim());
}

function toPriorHits(
  taskType: string,
  lessons: Array<{
    recovery: string;
    hypothesisKind?: string;
    domain?: string;
    recoverySequence?: string[];
  }>
): PlanningPriorHit[] {
  return lessons.map((lesson) => ({
    taskType,
    recovery: lesson.recovery,
    hypothesisKind: lesson.hypothesisKind,
    domain: lesson.domain,
    recoverySequence: lesson.recoverySequence
  }));
}

function dedupePriorHits(priors: PlanningPriorHit[]): PlanningPriorHit[] {
  const seen = new Set<string>();
  return priors.filter((prior) => {
    const key = [
      prior.taskType,
      prior.recovery,
      prior.hypothesisKind ?? "",
      prior.domain ?? ""
    ].join("::");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
