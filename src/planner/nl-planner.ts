import { createPlannerFromEnv, validateLLMPlannerOutput } from "../llm/planner";
import { TaskBlueprint } from "./task-id";

/**
 * DSL markers that indicate a goal is written in the structured DSL format
 * rather than natural language.
 */
const DSL_PATTERNS: RegExp[] = [
  /\bstart app\b/i,
  /\brun app\b/i,
  /\blaunch app\b/i,
  /\bstart server\b/i,
  /\brun server\b/i,
  /\bopen page\b/i,
  /\bwait for server\b/i,
  /\bclick\s+"/i,
  /\bassert text\b/i,
  /\bverify text\b/i,
  /\band wait\b/i,
  /\band click\b/i,
  /\band assert\b/i,
  /\band type\b/i,
  /\band hover\b/i,
  /\band scroll\b/i,
  /\band screenshot\b/i,
  /\band select\b/i,
  /\bstop app\b/i,
  /\bopen\s+"/i,
  /\btype\s+"[^"]+"\s+into\s+"/i,
  /\bselect\s+"[^"]+"\s+from\s+"/i,
  /\bhttp_request\b/i,
  /\bread_file\b/i,
  /\bwrite_file\b/i,
  /\brun_code\b/i,
  /\bvisual_click\b/i,
  /\bvisual_type\b/i,
  /\bvisual_assert\b/i,
];

/**
 * Detect whether a goal string is natural language (not DSL).
 *
 * Returns true when the goal looks like a human sentence rather than a
 * structured DSL command string.
 */
export function isNaturalLanguageGoal(goal: string): boolean {
  const trimmed = goal.trim();
  if (!trimmed) return false;

  // Too long — likely a complex DSL chain or something else
  if (trimmed.length > 200) return false;

  // Contains DSL markers → not natural language
  for (const pattern of DSL_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Must look like a sentence: contains spaces (multi-word)
  if (!trimmed.includes(" ")) return false;

  // Contains quoted selectors (e.g. "#login-button") → DSL-style
  if (/#[a-zA-Z]/.test(trimmed) && /"/.test(trimmed)) return false;

  return true;
}

/**
 * Extract a URL from a natural language goal if present.
 */
export function extractUrlFromGoal(goal: string): string | undefined {
  const match = goal.match(/https?:\/\/[^\s"]+/i);
  return match?.[0];
}

/**
 * Plan tasks from a natural language goal by delegating to the LLM planner.
 *
 * Returns an empty array if no LLM provider is configured or if the LLM
 * fails to produce valid tasks — callers should fall through to other planners.
 */
export async function planFromNaturalLanguage(
  goal: string,
  context?: { appUrl?: string; episodeContext?: string }
): Promise<TaskBlueprint[]> {
  const provider = createPlannerFromEnv();
  if (!provider) {
    return [];
  }

  const enrichedGoal = context?.appUrl
    ? `${goal} (target application: ${context.appUrl})`
    : goal;

  const blueprints = await provider.plan({
    goal: enrichedGoal,
    recentRunsSummary: [],
    failurePatterns: [],
    episodeContext: context?.episodeContext,
  });

  if (!validateLLMPlannerOutput(blueprints)) {
    return [];
  }

  return blueprints;
}
