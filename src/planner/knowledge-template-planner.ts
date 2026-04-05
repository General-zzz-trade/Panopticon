import { findTemplates } from "../knowledge/store";
import { logModuleError } from "../core/module-logger";
import type { TaskBlueprint } from "./task-id";

export interface KnowledgeTemplatePlanResult {
  matched: boolean;
  blueprints: TaskBlueprint[];
  templatePattern?: string;
  confidence: number;
}

export function planFromKnowledge(goal: string): KnowledgeTemplatePlanResult {
  // Extract meaningful keywords (>3 chars, not stop words)
  const stopWords = new Set(["open", "then", "and", "the", "for", "with", "that", "this", "from"]);
  const keywords = goal
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 8);

  if (keywords.length === 0) {
    return { matched: false, blueprints: [], confidence: 0 };
  }

  const domain = goal.match(/https?:\/\/([^/"\s]+)/i)?.[1];
  const templates = findTemplates(keywords, domain);

  if (templates.length === 0) {
    return { matched: false, blueprints: [], confidence: 0 };
  }

  // Pick highest-confidence template
  const best = templates[0];

  let blueprints: TaskBlueprint[] = [];
  try {
    blueprints = JSON.parse(best.tasksJson) as TaskBlueprint[];
  } catch (error) {
    logModuleError("knowledge-template-planner", "optional", error, "Failed to parse knowledge template tasks JSON");
    return { matched: false, blueprints: [], confidence: 0 };
  }

  if (blueprints.length === 0) {
    return { matched: false, blueprints: [], confidence: 0 };
  }

  // Confidence: keyword overlap ratio
  const overlapCount = keywords.filter(kw =>
    best.goalPattern.toLowerCase().includes(kw)
  ).length;
  const confidence = overlapCount / keywords.length;

  // Only use template if confidence is high enough
  if (confidence < 0.5) {
    return { matched: false, blueprints: [], confidence };
  }

  return {
    matched: true,
    blueprints,
    templatePattern: best.goalPattern,
    confidence
  };
}
