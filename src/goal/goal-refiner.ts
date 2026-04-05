/**
 * Goal Refiner — adjusts success criteria mid-run based on actual
 * observations.  Called after verification when criteria don't match
 * the reality observed in the browser / environment.
 */

import type { SuccessCriterion } from "./types";
import type { AgentObservation } from "../cognition/types";
import type { RunContext } from "../types";

// ── Public types ─────────────────────────────────────────────────────────────

export interface RefinementResult {
  refined: boolean;
  originalCriteria: SuccessCriterion[];
  updatedCriteria: SuccessCriterion[];
  reason: string;
}

// ── Core ─────────────────────────────────────────────────────────────────────

/**
 * Attempt to refine success criteria so they better fit current observations.
 *
 * Rules:
 *  - text_present("X") fails but similar text visible → add alternative
 *  - url_reached("…/dashboard") fails but current URL is close → relax
 *  - element_exists("#submit") fails but similar actionable element → update
 *
 * Only inferred (low-confidence) criteria are eligible for refinement;
 * user-stated criteria are never weakened.
 */
export function refineGoalCriteria(
  criteria: SuccessCriterion[],
  observation: AgentObservation,
  _context: RunContext
): RefinementResult {
  if (!criteria.length) {
    return {
      refined: false,
      originalCriteria: criteria,
      updatedCriteria: criteria,
      reason: "no criteria to refine",
    };
  }

  // Collect all visible text from the observation into a single searchable block.
  const visibleText = (observation.visibleText ?? []).join(" ");
  const pageUrl = observation.pageUrl ?? "";
  const actionable = observation.actionableElements ?? [];

  const updated: SuccessCriterion[] = [];
  const reasons: string[] = [];
  let anyRefined = false;

  for (const criterion of criteria) {
    const refined = refineSingle(criterion, visibleText, pageUrl, actionable);
    if (refined) {
      updated.push(refined.criterion);
      reasons.push(refined.reason);
      anyRefined = true;
    } else {
      updated.push(criterion);
    }
  }

  return {
    refined: anyRefined,
    originalCriteria: criteria,
    updatedCriteria: updated,
    reason: anyRefined ? reasons.join("; ") : "criteria unchanged",
  };
}

// ── Per-criterion refinement ─────────────────────────────────────────────────

interface SingleRefinement {
  criterion: SuccessCriterion;
  reason: string;
}

function refineSingle(
  criterion: SuccessCriterion,
  visibleText: string,
  pageUrl: string,
  actionable: Array<{ role?: string; text?: string; selector?: string; confidence: number }>
): SingleRefinement | undefined {
  // Never weaken user-stated criteria.
  if (criterion.source === "user") return undefined;

  switch (criterion.type) {
    case "text_present":
      return refineTextPresent(criterion, visibleText);
    case "url_reached":
      return refineUrlReached(criterion, pageUrl);
    case "element_exists":
      return refineElementExists(criterion, actionable);
    default:
      return undefined;
  }
}

// ── Text refinement ──────────────────────────────────────────────────────────

/**
 * If the exact text isn't visible but a plausible alternative is, update the
 * criterion to the alternative with lower confidence.
 *
 * Fallback terms: common synonyms of dashboard landing indicators.
 */
const TEXT_FALLBACKS: Record<string, string[]> = {
  dashboard: ["welcome", "home", "overview", "my account"],
  welcome: ["dashboard", "home", "hello"],
  success: ["confirmation", "thank you", "completed", "done"],
  confirmation: ["success", "thank you", "order confirmed", "completed"],
  "logged in": ["dashboard", "welcome", "my account", "profile"],
};

function refineTextPresent(
  criterion: SuccessCriterion,
  visibleText: string
): SingleRefinement | undefined {
  const lower = visibleText.toLowerCase();
  const target = criterion.value.toLowerCase();

  // Already present — no refinement needed.
  if (lower.includes(target)) return undefined;

  // Check known fallbacks.
  const fallbacks = TEXT_FALLBACKS[target] ?? [];
  for (const fb of fallbacks) {
    if (lower.includes(fb)) {
      return {
        criterion: {
          type: "text_present",
          value: fb,
          confidence: Math.max(0.3, criterion.confidence - 0.2),
          source: "dsl",
        },
        reason: `text "${criterion.value}" not found; "${fb}" visible instead`,
      };
    }
  }

  // Substring / fuzzy: if visible text contains a word from the target that is
  // >= 5 chars, try that as a partial match.
  const targetWords = target.split(/\s+/).filter((w) => w.length >= 5);
  for (const word of targetWords) {
    if (lower.includes(word)) {
      return {
        criterion: {
          type: "text_present",
          value: word,
          confidence: Math.max(0.3, criterion.confidence - 0.25),
          source: "dsl",
        },
        reason: `text "${criterion.value}" not found; partial match "${word}" visible`,
      };
    }
  }

  return undefined;
}

// ── URL refinement ───────────────────────────────────────────────────────────

function refineUrlReached(
  criterion: SuccessCriterion,
  pageUrl: string
): SingleRefinement | undefined {
  if (!pageUrl) return undefined;

  const target = criterion.value;

  // Already matches — no refinement needed.
  if (pageUrl.includes(target) || target.includes(pageUrl)) return undefined;

  // Check for partial overlap: same origin, different path.
  try {
    const targetUrl = normaliseUrl(target);
    const currentUrl = normaliseUrl(pageUrl);

    // Same host → relax to current path.
    if (targetUrl.host === currentUrl.host) {
      return {
        criterion: {
          type: "url_reached",
          value: pageUrl,
          confidence: Math.max(0.3, criterion.confidence - 0.2),
          source: "dsl",
        },
        reason: `url "${target}" not reached; relaxed to current "${pageUrl}"`,
      };
    }
  } catch {
    // Not valid URLs — try simple string distance.
  }

  // Path suffix match: if the target ends with "/dashboard" but actual is "/home",
  // and they share a common prefix.
  const commonPrefix = sharedPrefix(target, pageUrl);
  if (commonPrefix.length > 8) {
    return {
      criterion: {
        type: "url_reached",
        value: pageUrl,
        confidence: Math.max(0.3, criterion.confidence - 0.25),
        source: "dsl",
      },
      reason: `url "${target}" not reached; common prefix with "${pageUrl}"`,
    };
  }

  return undefined;
}

function normaliseUrl(raw: string): URL {
  if (!/^https?:\/\//i.test(raw)) {
    return new URL(`https://${raw}`);
  }
  return new URL(raw);
}

function sharedPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

// ── Element refinement ───────────────────────────────────────────────────────

function refineElementExists(
  criterion: SuccessCriterion,
  actionable: Array<{ role?: string; text?: string; selector?: string; confidence: number }>
): SingleRefinement | undefined {
  if (actionable.length === 0) return undefined;

  const target = criterion.value.toLowerCase();

  // Extract meaningful words from the selector (strip CSS syntax).
  const selectorWords = target
    .replace(/[#.\[\]=>:()\-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  for (const el of actionable) {
    const elText = (el.text ?? "").toLowerCase();
    const elSelector = (el.selector ?? "").toLowerCase();
    const elRole = (el.role ?? "").toLowerCase();

    // Direct selector match — not a refinement.
    if (elSelector === target) return undefined;

    // Check if any meaningful word from the target selector appears in this
    // element's text, selector, or role.
    for (const word of selectorWords) {
      if (elText.includes(word) || elSelector.includes(word) || elRole.includes(word)) {
        const newSelector = el.selector ?? elText;
        return {
          criterion: {
            type: "element_exists",
            value: newSelector,
            confidence: Math.max(0.3, criterion.confidence - 0.2),
            source: "dsl",
          },
          reason: `element "${criterion.value}" not found; similar element "${newSelector}" detected`,
        };
      }
    }
  }

  return undefined;
}
