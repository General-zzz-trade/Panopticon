/**
 * Goal Parser — transforms raw goal strings into structured Goal objects.
 *
 * Two parsing strategies:
 * 1. DSL parsing: regex extraction for structured goals ("open page X and assert text Y")
 * 2. LLM parsing: for natural language goals ("make sure the login works")
 *
 * Falls back gracefully: DSL first, LLM only if DSL produces no criteria.
 */

import type { Goal, GoalDifficulty, SuccessCriterion, GoalConstraint } from "./types";
import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import { logModuleError } from "../core/module-logger";

/**
 * Parse a raw goal string into a structured Goal.
 */
export async function parseGoal(raw: string): Promise<Goal> {
  const trimmed = raw.trim();
  const dslCriteria = extractDSLCriteria(trimmed);
  const constraints = extractConstraints(trimmed);
  const difficulty = estimateDifficulty(trimmed, dslCriteria);

  // If DSL extraction found criteria, use them directly
  if (dslCriteria.length > 0) {
    return {
      raw: trimmed,
      intent: trimmed,
      successCriteria: dslCriteria,
      constraints,
      difficulty
    };
  }

  // For natural language goals, try LLM extraction
  const llmCriteria = await extractLLMCriteria(trimmed);
  return {
    raw: trimmed,
    intent: trimmed,
    successCriteria: llmCriteria,
    constraints,
    difficulty: llmCriteria.length === 0 ? "open-ended" : difficulty
  };
}

/**
 * Synchronous DSL-only parsing (no LLM call). Used when async is not available.
 */
export function parseGoalSync(raw: string): Goal {
  const trimmed = raw.trim();
  const dslCriteria = extractDSLCriteria(trimmed);
  const constraints = extractConstraints(trimmed);
  const difficulty = estimateDifficulty(trimmed, dslCriteria);

  return {
    raw: trimmed,
    intent: trimmed,
    successCriteria: dslCriteria,
    constraints,
    difficulty
  };
}

// ── DSL Extraction ─────────────────────────────────────────────────────

function extractDSLCriteria(goal: string): SuccessCriterion[] {
  const criteria: SuccessCriterion[] = [];

  // assert text "X" → text_present
  for (const match of goal.matchAll(/assert\s+text\s+"([^"]+)"/gi)) {
    criteria.push({
      type: "text_present",
      value: match[1],
      confidence: 1.0,
      source: "dsl"
    });
  }

  // visual_assert "X" → text_present
  for (const match of goal.matchAll(/visual_assert\s+"([^"]+)"/gi)) {
    criteria.push({
      type: "text_present",
      value: match[1],
      confidence: 0.9,
      source: "dsl"
    });
  }

  // open page "URL" → url_reached
  for (const match of goal.matchAll(/open\s+page\s+"([^"]+)"/gi)) {
    criteria.push({
      type: "url_reached",
      value: match[1],
      confidence: 1.0,
      source: "dsl"
    });
  }

  // click "selector" → element_exists (the target must exist)
  for (const match of goal.matchAll(/click\s+"([^"]+)"/gi)) {
    criteria.push({
      type: "element_exists",
      value: match[1],
      confidence: 0.7,
      source: "dsl"
    });
  }

  // http_request "URL" → url_reached (API call)
  for (const match of goal.matchAll(/http_request\s+"([^"]+)"/gi)) {
    criteria.push({
      type: "http_status",
      value: match[1],
      confidence: 0.9,
      source: "dsl"
    });
  }

  // screenshot → no success criterion (it's a side effect)
  // stop app → no criterion

  return criteria;
}

function extractConstraints(goal: string): GoalConstraint[] {
  const constraints: GoalConstraint[] = [];

  // "within N seconds/minutes"
  const timeMatch = goal.match(/within\s+(\d+)\s*(seconds?|minutes?|ms)/i);
  if (timeMatch) {
    let ms = parseInt(timeMatch[1], 10);
    if (/minute/i.test(timeMatch[2])) ms *= 60000;
    else if (/second/i.test(timeMatch[2])) ms *= 1000;
    constraints.push({ type: "max_duration_ms", value: ms });
  }

  // "max N steps"
  const stepsMatch = goal.match(/max\s+(\d+)\s+steps/i);
  if (stepsMatch) {
    constraints.push({ type: "max_steps", value: parseInt(stepsMatch[1], 10) });
  }

  // "safely" or "without side effects"
  if (/safely|without side effects|read.only/i.test(goal)) {
    constraints.push({ type: "safe_only", value: "true" });
  }

  return constraints;
}

function estimateDifficulty(goal: string, criteria: SuccessCriterion[]): GoalDifficulty {
  const actionCount = (goal.match(/\band\b/gi) ?? []).length + 1;
  const hasLogin = /login|sign in|authenticate/i.test(goal);
  const hasNavigation = /navigate|open page|click/i.test(goal);
  const isNaturalLanguage = !/\b(and|then)\b.*\b(click|type|assert|open|screenshot)\b/i.test(goal);

  if (isNaturalLanguage && criteria.length === 0) return "open-ended";
  if (actionCount <= 2 && !hasLogin) return "trivial";
  if (actionCount <= 4 && !hasLogin) return "simple";
  if (actionCount <= 6 || hasLogin) return "medium";
  return "complex";
}

// ── LLM Extraction ─────────────────────────────────────────────────────

const CRITERIA_EXTRACTION_PROMPT = `You are a goal analysis agent. Given a user's goal, extract verifiable success criteria.

For each criterion, determine:
- type: "text_present" (text should appear), "url_reached" (should be at URL), "state_reached" (app state like "authenticated"), "custom" (other)
- value: the specific thing to check
- confidence: 0.0-1.0 how sure you are this is a real criterion

Return JSON:
{"criteria": [{"type": "...", "value": "...", "confidence": 0.8}]}

If the goal is too vague for any criteria, return: {"criteria": []}`;

async function extractLLMCriteria(goal: string): Promise<SuccessCriterion[]> {
  const config = readProviderConfig("LLM_PLANNER", { maxTokens: 300 });
  if (!config.provider || !config.apiKey) return [];

  try {
    const messages = [
      { role: "system" as const, content: CRITERIA_EXTRACTION_PROMPT },
      { role: "user" as const, content: `Goal: ${goal}` }
    ];

    const result = config.provider === "anthropic"
      ? await callAnthropic(config, messages, "GoalParser")
      : await callOpenAICompatible(config, messages, "GoalParser");

    const parsed = safeJsonParse(result.content) as { criteria?: Array<{ type: string; value: string; confidence: number }> } | null;
    if (!parsed?.criteria) return [];

    return parsed.criteria.map(c => ({
      type: (c.type as SuccessCriterion["type"]) || "custom",
      value: c.value,
      confidence: Math.min(1, Math.max(0, c.confidence)),
      source: "llm" as const
    }));
  } catch (error) {
    logModuleError("goal-parser", "optional", error, "LLM criteria extraction");
    return [];
  }
}
