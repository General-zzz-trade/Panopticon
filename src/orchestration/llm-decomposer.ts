/**
 * LLM Goal Decomposer — decomposes a complex goal into a DAG of sub-goals
 * using LLM reasoning instead of regex pattern matching.
 *
 * Falls back to regex extraction if no LLM is configured.
 */

import { readProviderConfig, callOpenAICompatible, callAnthropic, safeJsonParse } from "../llm/provider";
import { logModuleError } from "../core/module-logger";

export interface SubGoal {
  id: string;
  goal: string;
  dependsOn: string[];
}

export interface DecompositionResult {
  subGoals: SubGoal[];
  strategy: "llm" | "regex";
  rationale: string;
}

const SYSTEM_PROMPT = `You are an OSINT task decomposition agent. Given a complex reconnaissance goal, break it into independent or dependent sub-goals.

Rules:
- Each sub-goal should be self-contained and executable independently (when dependencies are met)
- Use dependsOn to express ordering constraints (e.g., "login" must happen before "navigate to dashboard")
- Keep sub-goals at a high level — don't break into individual clicks
- If the goal is already simple (single action), return it as a single sub-goal
- Return valid JSON only

Output format:
{
  "subGoals": [
    { "id": "sg-1", "goal": "...", "dependsOn": [] },
    { "id": "sg-2", "goal": "...", "dependsOn": ["sg-1"] }
  ],
  "rationale": "..."
}`;

/**
 * Decompose a goal using LLM, with regex fallback.
 */
export async function decomposeGoal(goal: string): Promise<DecompositionResult> {
  const config = readProviderConfig("LLM_DECOMPOSER", { maxTokens: 500 });

  if (config.provider && config.apiKey) {
    try {
      return await llmDecompose(goal, config);
    } catch (error) {
      logModuleError("llm-decomposer", "optional", error, "LLM decomposition failed, falling back to regex");
    }
  }

  return regexDecompose(goal);
}

async function llmDecompose(
  goal: string,
  config: ReturnType<typeof readProviderConfig>
): Promise<DecompositionResult> {
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: `Decompose this goal into sub-goals:\n\n${goal}` }
  ];

  const result = config.provider === "anthropic"
    ? await callAnthropic(config, messages, "GoalDecomposer")
    : await callOpenAICompatible(config, messages, "GoalDecomposer");

  const parsed = safeJsonParse(result.content);
  if (!parsed || !Array.isArray((parsed as { subGoals?: unknown }).subGoals)) {
    throw new Error("LLM returned invalid decomposition format");
  }

  const data = parsed as { subGoals: SubGoal[]; rationale?: string };

  // Validate structure
  for (const sg of data.subGoals) {
    if (!sg.id || !sg.goal) {
      throw new Error(`Invalid sub-goal: missing id or goal`);
    }
    sg.dependsOn = sg.dependsOn ?? [];
  }

  // Validate dependency references
  const ids = new Set(data.subGoals.map(sg => sg.id));
  for (const sg of data.subGoals) {
    for (const dep of sg.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(`Sub-goal ${sg.id} depends on unknown ${dep}`);
      }
    }
  }

  return {
    subGoals: data.subGoals,
    strategy: "llm",
    rationale: data.rationale ?? "LLM decomposition"
  };
}

/**
 * Regex-based decomposition fallback (same logic as existing extractParallelSubGoals).
 */
function regexDecompose(goal: string): DecompositionResult {
  const subGoals = extractParallelSubGoals(goal);

  if (subGoals.length <= 1) {
    return {
      subGoals: [{ id: "sg-0", goal, dependsOn: [] }],
      strategy: "regex",
      rationale: "Single goal, no decomposition needed"
    };
  }

  const deps = detectSequentialDependencies(subGoals);

  return {
    subGoals: subGoals.map((g, i) => ({
      id: `sg-${i}`,
      goal: g,
      dependsOn: deps.get(`sg-${i}`) ?? []
    })),
    strategy: "regex",
    rationale: `Regex decomposition: ${subGoals.length} sub-goals`
  };
}

function extractParallelSubGoals(goal: string): string[] {
  // "Do X, Y, and Z" or "Test A and B and C"
  const andPattern = /\b(?:test|check|verify|run|do|perform|validate)\s+(.+)/i;
  const match = goal.match(andPattern);
  if (!match) return [goal];

  const rest = match[1];
  const parts = rest.split(/\s*(?:,\s*(?:and\s+)?|(?:\s+and\s+))\s*/i).filter(Boolean);
  if (parts.length <= 1) return [goal];

  const prefix = goal.slice(0, match.index! + match[0].indexOf(match[1]));
  return parts.map(p => `${prefix.trim()} ${p.trim()}`);
}

function detectSequentialDependencies(subGoals: string[]): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  const loginPatterns = /\b(login|sign in|authenticate)\b/i;
  const postLoginPatterns = /\b(dashboard|profile|settings|account)\b/i;

  let loginIndex = -1;
  for (let i = 0; i < subGoals.length; i++) {
    if (loginPatterns.test(subGoals[i])) loginIndex = i;
  }

  for (let i = 0; i < subGoals.length; i++) {
    const taskDeps: string[] = [];
    if (loginIndex >= 0 && i !== loginIndex && postLoginPatterns.test(subGoals[i])) {
      taskDeps.push(`sg-${loginIndex}`);
    }
    deps.set(`sg-${i}`, taskDeps);
  }

  return deps;
}

/**
 * Topological sort of sub-goals by dependency order.
 * Returns sub-goals in execution order; throws if cycle detected.
 */
export function topologicalSort(subGoals: SubGoal[]): SubGoal[] {
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  const goalMap = new Map<string, SubGoal>();

  for (const sg of subGoals) {
    goalMap.set(sg.id, sg);
    inDegree.set(sg.id, sg.dependsOn.length);
    for (const dep of sg.dependsOn) {
      const existing = adjList.get(dep) ?? [];
      existing.push(sg.id);
      adjList.set(dep, existing);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: SubGoal[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(goalMap.get(id)!);
    for (const neighbor of adjList.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== subGoals.length) {
    throw new Error("Cycle detected in sub-goal dependencies");
  }

  return sorted;
}

/**
 * Get groups of sub-goals that can be executed in parallel.
 * Each group contains sub-goals whose dependencies are all in previous groups.
 */
export function getParallelGroups(subGoals: SubGoal[]): SubGoal[][] {
  const completed = new Set<string>();
  const remaining = new Map(subGoals.map(sg => [sg.id, sg]));
  const groups: SubGoal[][] = [];

  while (remaining.size > 0) {
    const group: SubGoal[] = [];
    for (const [id, sg] of remaining) {
      if (sg.dependsOn.every(dep => completed.has(dep))) {
        group.push(sg);
      }
    }

    if (group.length === 0) {
      throw new Error("Cycle detected: no sub-goals can be scheduled");
    }

    for (const sg of group) {
      remaining.delete(sg.id);
      completed.add(sg.id);
    }
    groups.push(group);
  }

  return groups;
}
