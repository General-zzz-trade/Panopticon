/**
 * Intent Resolver — maps vague natural-language intents to known skill
 * patterns from the knowledge store.  Pure pattern matching + knowledge
 * lookup, no LLM calls.
 */

import type { SuccessCriterion } from "./types";
import { findTemplates } from "../knowledge/store";

// ── Public types ─────────────────────────────────────────────────────────────

export interface ResolvedIntent {
  originalGoal: string;
  resolvedGoal: string;
  matchedTemplate?: string;
  inferredCriteria: SuccessCriterion[];
  confidence: number;
}

// ── Intent patterns ──────────────────────────────────────────────────────────

interface IntentPattern {
  /** Keywords that signal this intent (matched case-insensitively). */
  keywords: RegExp;
  /** Human-readable label for the intent. */
  label: string;
  /** Default criteria to infer when the intent is recognised. */
  defaultCriteria: SuccessCriterion[];
  /** Try to extract a target from the goal string (e.g. the URL in "navigate to X"). */
  extractTarget?: (goal: string) => string | undefined;
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    keywords: /\b(?:log\s*in|sign\s*in|authenticate)\b/i,
    label: "login",
    defaultCriteria: [
      { type: "state_reached", value: "authenticated", confidence: 0.7, source: "dsl" },
    ],
  },
  {
    keywords: /\b(?:search(?:\s+for)?|find|look\s+up|query)\b/i,
    label: "search",
    defaultCriteria: [
      { type: "element_exists", value: "search results", confidence: 0.6, source: "dsl" },
    ],
    extractTarget(goal: string): string | undefined {
      const m = goal.match(/(?:search(?:\s+for)?|find|look\s+up|query)\s+(?:["']([^"']+)["']|(\S+(?:\s+\S+)*))/i);
      return m?.[1] ?? m?.[2];
    },
  },
  {
    keywords: /\b(?:navigate\s+to|go\s+to|open|visit)\b/i,
    label: "navigate",
    defaultCriteria: [],
    extractTarget(goal: string): string | undefined {
      const m = goal.match(/(?:navigate\s+to|go\s+to|open|visit)\s+(?:["']([^"']+)["']|(https?:\/\/\S+|\S+\.\S+))/i);
      return m?.[1] ?? m?.[2];
    },
  },
  {
    keywords: /\b(?:fill\s+(?:out\s+)?(?:\w+\s+)*form|register|sign\s*up|create\s+(?:an?\s+)?account)\b/i,
    label: "form",
    defaultCriteria: [
      { type: "state_reached", value: "form_submitted", confidence: 0.6, source: "dsl" },
    ],
  },
  {
    keywords: /\b(?:verify|check|confirm|ensure|validate)\b/i,
    label: "verify",
    defaultCriteria: [],
    extractTarget(goal: string): string | undefined {
      const m = goal.match(/(?:verify|check|confirm|ensure|validate)\s+(?:that\s+)?(?:["']([^"']+)["']|(.+?)(?:\s+(?:is|are|exists?|appears?|visible|present)|\s*$))/i);
      return m?.[1] ?? m?.[2]?.trim();
    },
  },
  {
    keywords: /\b(?:buy|purchase|checkout|check\s*out|add\s+to\s+cart|place\s+order)\b/i,
    label: "checkout",
    defaultCriteria: [
      { type: "state_reached", value: "order_placed", confidence: 0.6, source: "dsl" },
      { type: "text_present", value: "confirmation", confidence: 0.5, source: "dsl" },
    ],
  },
];

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Resolve a free-text goal into a structured intent.
 *
 * 1. Match against known intent patterns.
 * 2. Query the knowledge store for task templates in the given domain.
 * 3. Expand / enrich success criteria from the template.
 * 4. If nothing matched, return the original goal unchanged.
 */
export function resolveIntent(goal: string, domain?: string): ResolvedIntent {
  if (!goal || !goal.trim()) {
    return {
      originalGoal: goal ?? "",
      resolvedGoal: goal ?? "",
      inferredCriteria: [],
      confidence: 0,
    };
  }

  const trimmedGoal = goal.trim();

  // 1. Pattern matching
  const matchedPattern = matchIntent(trimmedGoal);

  // 2. Knowledge-store lookup
  const templates = safeTemplateLookup(trimmedGoal, domain);
  const bestTemplate = templates.length > 0 ? templates[0] : undefined;

  // No pattern, no template → return unchanged
  if (!matchedPattern && !bestTemplate) {
    return {
      originalGoal: trimmedGoal,
      resolvedGoal: trimmedGoal,
      inferredCriteria: [],
      confidence: 0,
    };
  }

  // Build criteria from intent pattern
  const criteria: SuccessCriterion[] = [];
  let resolvedGoal = trimmedGoal;
  let confidence = 0;

  if (matchedPattern) {
    // Add default criteria from pattern
    criteria.push(...matchedPattern.pattern.defaultCriteria);

    // Handle target-specific criteria
    if (matchedPattern.target) {
      if (matchedPattern.pattern.label === "navigate") {
        criteria.push({
          type: "url_reached",
          value: matchedPattern.target,
          confidence: 0.8,
          source: "dsl",
        });
      } else if (matchedPattern.pattern.label === "verify") {
        criteria.push({
          type: "text_present",
          value: matchedPattern.target,
          confidence: 0.7,
          source: "dsl",
        });
      } else if (matchedPattern.pattern.label === "search" && matchedPattern.target) {
        // Enrich the search results criterion with the query term
        const idx = criteria.findIndex(
          (c) => c.type === "element_exists" && c.value === "search results"
        );
        if (idx >= 0) {
          criteria[idx] = {
            ...criteria[idx],
            value: `search results for ${matchedPattern.target}`,
          };
        }
      }
    }

    confidence = 0.6;
  }

  // Merge template criteria (higher confidence if template found)
  if (bestTemplate) {
    const templateCriteria = extractCriteriaFromTemplate(bestTemplate);
    for (const tc of templateCriteria) {
      if (!criteria.some((c) => c.type === tc.type && c.value === tc.value)) {
        criteria.push(tc);
      }
    }
    resolvedGoal = enrichGoalFromTemplate(trimmedGoal, bestTemplate);
    confidence = Math.max(confidence, 0.75);
  }

  return {
    originalGoal: trimmedGoal,
    resolvedGoal,
    matchedTemplate: bestTemplate?.goalPattern,
    inferredCriteria: criteria,
    confidence,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface MatchedIntent {
  pattern: IntentPattern;
  target?: string;
}

function matchIntent(goal: string): MatchedIntent | undefined {
  for (const pattern of INTENT_PATTERNS) {
    if (pattern.keywords.test(goal)) {
      const target = pattern.extractTarget?.(goal);
      return { pattern, target };
    }
  }
  return undefined;
}

function safeTemplateLookup(goal: string, domain?: string): import("../knowledge/types").TaskTemplateEntry[] {
  const words = goal
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (words.length === 0) return [];
  try {
    return findTemplates(words, domain);
  } catch {
    // Knowledge store may not be initialized (e.g. in unit tests without DB).
    return [];
  }
}

function extractCriteriaFromTemplate(
  template: import("../knowledge/types").TaskTemplateEntry
): SuccessCriterion[] {
  const criteria: SuccessCriterion[] = [];

  // Try to parse the tasks JSON and infer criteria from action types
  try {
    const tasks = JSON.parse(template.tasksJson) as Array<{
      type?: string;
      payload?: Record<string, string>;
    }>;

    for (const task of tasks) {
      if (task.type === "assert_text" && task.payload?.text) {
        criteria.push({
          type: "text_present",
          value: task.payload.text,
          confidence: 0.7,
          source: "dsl",
        });
      }
      if (task.type === "open_page" && task.payload?.url) {
        criteria.push({
          type: "url_reached",
          value: task.payload.url,
          confidence: 0.7,
          source: "dsl",
        });
      }
    }
  } catch {
    // Malformed template JSON — ignore.
  }

  return criteria;
}

function enrichGoalFromTemplate(
  originalGoal: string,
  template: import("../knowledge/types").TaskTemplateEntry
): string {
  if (template.tasksSummary) {
    return `${originalGoal} [template: ${template.tasksSummary}]`;
  }
  return originalGoal;
}
