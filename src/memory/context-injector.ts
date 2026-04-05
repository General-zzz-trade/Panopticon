/**
 * Context Injector — builds rich context from past experience for new runs.
 *
 * Combines semantic episode search, knowledge-store lessons, selector hints,
 * and failure warnings into a structured context block that is injected into
 * the planner prompt for few-shot guidance.
 */

import { logModuleError } from "../core/module-logger";
import { findSimilarEpisodes } from "./semantic-search";
import {
  getLessonsForTaskType,
  getSelectorsForDomain,
  retrieveRelevantKnowledge,
} from "../knowledge/store";
import type { SelectorMapEntry, FailureLessonEntry } from "../knowledge/types";

export interface InjectedContext {
  episodeSummaries: string[];   // From similar past runs
  relevantLessons: string[];    // From knowledge store
  selectorHints: string[];      // Known good selectors for domain
  failureWarnings: string[];    // Common failure modes for this goal type
  injectedAt: string;
}

/**
 * Build a rich context from past experience for a new goal.
 * This is injected into the planner prompt for few-shot guidance.
 */
export async function buildInjectedContext(
  goal: string,
  domain?: string,
  options?: { maxEpisodes?: number; maxLessons?: number }
): Promise<InjectedContext> {
  const maxEpisodes = options?.maxEpisodes ?? 5;
  const maxLessons = options?.maxLessons ?? 10;

  // 1. Find similar past episodes via semantic search
  const episodeSummaries = await getEpisodeSummaries(goal, maxEpisodes);

  // 2. Get task-type-specific lessons from knowledge store
  const relevantLessons = getRelevantLessons(goal, domain, maxLessons);

  // 3. Get selector hints for this domain
  const selectorHints = getSelectorHints(domain);

  // 4. Get failure warnings from common failure patterns
  const failureWarnings = getFailureWarnings(goal, domain);

  return {
    episodeSummaries,
    relevantLessons,
    selectorHints,
    failureWarnings,
    injectedAt: new Date().toISOString(),
  };
}

/**
 * Format injected context as a string for LLM prompt injection.
 */
export function formatContextForPrompt(context: InjectedContext): string {
  const sections: string[] = [];

  if (context.episodeSummaries.length > 0) {
    sections.push(
      "## Past Experience\n" +
        context.episodeSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")
    );
  }

  if (context.relevantLessons.length > 0) {
    sections.push(
      "## Lessons Learned\n" +
        context.relevantLessons.map((l) => `- ${l}`).join("\n")
    );
  }

  if (context.selectorHints.length > 0) {
    sections.push(
      "## Known Selectors\n" +
        context.selectorHints.map((h) => `- ${h}`).join("\n")
    );
  }

  if (context.failureWarnings.length > 0) {
    sections.push(
      "## Failure Warnings\n" +
        context.failureWarnings.map((w) => `- WARNING: ${w}`).join("\n")
    );
  }

  if (sections.length === 0) {
    return "";
  }

  return `# Injected Context from Past Experience\n\n${sections.join("\n\n")}`;
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

async function getEpisodeSummaries(goal: string, maxEpisodes: number): Promise<string[]> {
  try {
    const matches = await findSimilarEpisodes(goal, maxEpisodes);
    return matches.map(
      (m) =>
        `[${m.episode.outcome}] ${m.episode.goal} — ${m.episode.summary} (similarity: ${m.similarity.toFixed(2)})`
    );
  } catch (error) {
    logModuleError("context-injector", "optional", error, "semantic episode search");
    return [];
  }
}

function getRelevantLessons(goal: string, domain: string | undefined, maxLessons: number): string[] {
  // Extract likely task types from the goal
  const taskTypes = inferTaskTypes(goal);
  const lessons: FailureLessonEntry[] = [];

  for (const taskType of taskTypes) {
    try {
      const found = getLessonsForTaskType(taskType, domain);
      lessons.push(...found);
    } catch (error) {
      logModuleError("context-injector", "optional", error, "knowledge store lesson lookup");
    }
  }

  // Deduplicate by recovery strategy and limit
  const seen = new Set<string>();
  return lessons
    .filter((l) => {
      if (seen.has(l.recovery)) return false;
      seen.add(l.recovery);
      return true;
    })
    .slice(0, maxLessons)
    .map((l) => `When "${l.taskType}" fails with "${l.errorPattern}": ${l.recovery}`);
}

function getSelectorHints(domain: string | undefined): string[] {
  if (!domain) return [];
  try {
    const selectors = getSelectorsForDomain(domain);
    return selectors
      .filter((s: SelectorMapEntry) => s.successCount > s.failureCount)
      .slice(0, 10)
      .map(
        (s: SelectorMapEntry) =>
          `"${s.description}" => ${s.selector} (${s.successCount} successes)`
      );
  } catch (error) {
    logModuleError("context-injector", "optional", error, "selector hints lookup");
    return [];
  }
}

function getFailureWarnings(goal: string, domain: string | undefined): string[] {
  try {
    const knowledge = retrieveRelevantKnowledge(goal, domain);
    return knowledge.lessons
      .filter((l) => l.successCount === 0 || l.errorPattern.length > 0)
      .slice(0, 5)
      .map((l) => `${l.taskType} on ${l.domain || "any domain"}: "${l.errorPattern}" — ${l.recovery}`);
  } catch (error) {
    logModuleError("context-injector", "optional", error, "failure warnings lookup");
    return [];
  }
}

/**
 * Infer likely task types from a natural-language goal.
 */
function inferTaskTypes(goal: string): string[] {
  const types: string[] = [];
  const lower = goal.toLowerCase();

  if (/click|press|tap|button/.test(lower)) types.push("click");
  if (/type|enter|fill|input|search/.test(lower)) types.push("type");
  if (/navigate|go to|open|visit|url/.test(lower)) types.push("navigate");
  if (/assert|check|verify|expect|see/.test(lower)) types.push("assert_text");
  if (/login|sign in|auth/.test(lower)) types.push("click", "type");
  if (/upload|file/.test(lower)) types.push("upload");
  if (/scroll/.test(lower)) types.push("scroll");

  // Always include generic types as fallback
  if (types.length === 0) {
    types.push("click", "type", "navigate");
  }

  return [...new Set(types)];
}
